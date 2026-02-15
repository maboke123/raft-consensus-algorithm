import { NodeId, RaftConfig } from "./Config";
import { RequestVoteRequest, RequestVoteResponse, AppendEntriesRequest, AppendEntriesResponse } from "../rpc/RPCTypes";
import { LeaderState } from "../state/LeaderState";
import { PersistentState } from "../state/PersistentState";
import { VolatileState } from "../state/VolatileState";
import { LogManager } from "../log/LogManager";
import { RPCHandler } from "../rpc/RPCHandler";
import { TimerManager } from "../timing/TimerManager";
import { Logger } from "../util/Logger";
import { RaftError } from "../util/Error";
import { AsyncLock } from "../lock/AsyncLock";


export enum RaftState {
    Follower = "Follower",
    Candidate = "Candidate",
    Leader = "Leader"
}

export interface StateMachineInterface {
    start(): Promise<void>;
    stop(): Promise<void>;
    getCurrentState(): RaftState;
    getCurrentLeader(): NodeId | null;
    isLeader(): boolean;
    becomeFollower(term: number, leaderId: NodeId | null): Promise<void>;
    becomeCandidate(): Promise<void>;
    becomeLeader(): Promise<void>;
    handleRequestVote(from: NodeId, request: RequestVoteRequest): Promise<RequestVoteResponse>;
    handleAppendEntries(from: NodeId, request: AppendEntriesRequest): Promise<AppendEntriesResponse>;
}

export class StateMachine implements StateMachineInterface {
    private currentState: RaftState = RaftState.Follower;
    private currentLeader: NodeId | null = null;

    private votesReceived: Set<NodeId> = new Set();
    private votesNeeded: number = 0;

    private leaderState: LeaderState | null = null;

    private stateLock = new AsyncLock();

    constructor(
        private nodeId: NodeId,
        private peers: NodeId[],
        private config: RaftConfig,
        private persistentState: PersistentState,
        private volatileState: VolatileState,
        private logManager: LogManager,
        private rpcHandler: RPCHandler,
        private timerManager: TimerManager,
        private logger: Logger,
        private onCommitIndexAdvanced?: (newCommitIndex: number) => void
    ) {}

    async start(): Promise<void> {
        this.logger.info(`Node ${this.nodeId} starting as ${this.currentState}`);
        await this.becomeFollower( this.persistentState.getCurrentTerm(), null);
    }

    async stop(): Promise<void> {
        this.logger.info(`Node ${this.nodeId} stopping`);
        this.timerManager.stopAllTimers();
    }

    getCurrentState(): RaftState {
        return this.currentState;
    }

    getCurrentLeader(): NodeId | null {
        return this.currentLeader;
    }

    isLeader(): boolean {
        return this.currentState === RaftState.Leader;
    }

    async becomeFollower(term: number, leaderId: NodeId | null): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            this.logger.info(`Node ${this.nodeId} becoming Follower for term ${term}, leader: ${leaderId}`);

            const currentTerm = this.persistentState.getCurrentTerm();
            if (term > currentTerm) {
                await this.persistentState.updateTermAndVote(term, null);
                this.logger.info(`Node ${this.nodeId} updated term to ${term} and cleared votes`);
            }

            const wasLeader = this.currentState === RaftState.Leader;

            this.currentState = RaftState.Follower;
            this.votesReceived.clear();
            this.currentLeader = leaderId;

            if (wasLeader) {
                this.leaderState = null;
                this.timerManager.stopHeartbeatTimer();
                this.logger.info(`Node ${this.nodeId} was previously a Leader, now a Follower`);
            }

            this.timerManager.startElectionTimer(() => this.handleElectionTimeoutlocked());

            this.logger.info(`Node ${this.nodeId} is now a Follower with term ${this.persistentState.getCurrentTerm()}`);
        });
    }

    async becomeCandidate(): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            this.currentState = RaftState.Candidate;
            this.currentLeader = null;

            this.leaderState = null;

            const newTerm = (this.persistentState.getCurrentTerm() + 1);

            await this.persistentState.updateTermAndVote(newTerm, this.nodeId);

            this.votesReceived.clear();
            this.votesReceived.add(this.nodeId);

            const clusterSize = this.peers.length + 1;
            this.votesNeeded = Math.floor(clusterSize / 2) + 1;

            this.logger.info(`Node ${this.nodeId} became Candidate for term ${newTerm}, votes needed: ${this.votesNeeded}`);

            this.timerManager.startElectionTimer(() => this.handleElectionTimeoutlocked());

            await this.requestVotes();
        });
    }

    async becomeLeader(): Promise<void> {
        await this.stateLock.runExclusive(async () => {

            this.currentState = RaftState.Leader;
            this.currentLeader = this.nodeId;

            const currentTerm = this.persistentState.getCurrentTerm();
            const lastLogIndex = this.logManager.getLastIndex();

            this.logger.info(`Node ${this.nodeId} became Leader for term ${currentTerm}, last log index: ${lastLogIndex}`);

            this.leaderState = new LeaderState(this.peers, lastLogIndex);

            this.timerManager.startHeartbeatTimer(() => this.sendHeartbeatsLocked());

            await this.sendHeartbeatsUnlocked();
        });
    }

    async handleRequestVote(from: NodeId, request: RequestVoteRequest): Promise<RequestVoteResponse> {
        return await this.stateLock.runExclusive(async () => {
            const currentTerm = this.persistentState.getCurrentTerm();

            if (request.term < currentTerm) {
                this.logger.info(`Node ${this.nodeId} received RequestVote from ${from} with stale term ${request.term}, current term is ${currentTerm}`);
                return {
                    term: currentTerm,
                    voteGranted: false
                };
            }

            if (request.term > currentTerm) {
                this.logger.info(`Node ${this.nodeId} received RequestVote from ${from} with higher term ${request.term}, updating term and becoming Follower`);
                await this.becomeFollowerUnlocked(request.term, null);

            } else if (request.term === currentTerm && this.currentState !== RaftState.Follower) {
                this.logger.info(`Node ${this.nodeId} received RequestVote from ${from} with current term ${request.term} but is not a Follower, becoming Follower`);
                await this.becomeFollowerUnlocked(request.term, null);
            }

            const votedFor = this.persistentState.getVotedFor();

            const canGrantVote = votedFor === null || votedFor === request.candidateId;

            if (!canGrantVote) {
                this.logger.info(`Node ${this.nodeId} cannot grant vote to ${request.candidateId} because it has already voted for ${votedFor}`);
                return {
                    term: this.persistentState.getCurrentTerm(),
                    voteGranted: false
                };
            }

            const isLogUpToDate = this.isLogUpToDate(request.lastLogIndex, request.lastLogTerm);

            if (!isLogUpToDate) {
                this.logger.info(`Node ${this.nodeId} cannot grant vote to ${request.candidateId} because its log is not up-to-date`);
                return {
                    term: this.persistentState.getCurrentTerm(),
                    voteGranted: false
                };
            }

            await this.persistentState.updateTermAndVote(request.term, request.candidateId);
            this.logger.info(`Node ${this.nodeId} granted vote to ${request.candidateId} for term ${request.term}`);

            this.timerManager.resetElectionTimer();

            return {
                term: this.persistentState.getCurrentTerm(),
                voteGranted: true
            };
        });
    }

    async triggerReplication(): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            if (this.currentState === RaftState.Leader) {
                await this.sendHeartbeatsUnlocked();
            }
        });
    }

    private isLogUpToDate(candidateLastLogIndex: number, candidateLastLogTerm: number): boolean {
        const lastLogIndex = this.logManager.getLastIndex();
        const lastLogTerm = this.logManager.getLastTerm();

        if (candidateLastLogTerm > lastLogTerm) {
            return true;
        }

        if (candidateLastLogTerm < lastLogTerm) {
            return false;
        }

        return candidateLastLogIndex >= lastLogIndex;
    }

    async handleAppendEntries(from: NodeId, request: AppendEntriesRequest): Promise<AppendEntriesResponse> {
        return await this.stateLock.runExclusive(async () => {
            const currentTerm = this.persistentState.getCurrentTerm();

            if (request.term < currentTerm) {
                this.logger.info(`Node ${this.nodeId} received AppendEntries from ${from} with stale term ${request.term}, current term is ${currentTerm}`);
                return {
                    term: currentTerm,
                    success: false
                };
            }

            if (request.term >= currentTerm) {
                this.logger.info(`Node ${this.nodeId} received AppendEntries from ${from} with higher term ${request.term}, updating term and becoming Follower`);
                await this.becomeFollowerUnlocked(request.term, request.leaderId);
            }

            if(!(await this.logManager.matchesPrevLog(request.prevLogIndex, request.prevLogTerm))) {
                this.logger.info(`Node ${this.nodeId} log does not match prevLogIndex ${request.prevLogIndex} and prevLogTerm ${request.prevLogTerm} from ${from}`);

                const conflictInfo = await this.logManager.getConflictInfo(request.prevLogIndex);

                return {
                    term: this.persistentState.getCurrentTerm(),
                    success: false,
                    conflictIndex: conflictInfo.conflictIndex,
                    conflictTerm: conflictInfo.conflictTerm
                };
            }

            if (request.entries.length > 0) {
                await this.logManager.appendEntriesFrom(request.prevLogIndex, request.entries);
                this.logger.info(`Node ${this.nodeId} appended ${request.entries.length} entries from ${from}`);
            }

            const leaderCommit = request.leaderCommit;
            const currentCommitIndex = this.volatileState.getCommitIndex();

            if (leaderCommit > currentCommitIndex) {
                const lastNewEntryIndex = request.prevLogIndex + request.entries.length;
                const newCommitIndex = Math.min(leaderCommit, lastNewEntryIndex);
                this.volatileState.setCommitIndex(newCommitIndex);
                this.logger.info(`Node ${this.nodeId} updated commit index to ${newCommitIndex} based on leader ${from}`);

                this.onCommitIndexAdvanced?.(newCommitIndex);
            }

            const matchIndex = request.prevLogIndex + request.entries.length;

            this.logger.info(`Node ${this.nodeId} successfully processed AppendEntries from ${from}, matchIndex: ${matchIndex}`);

            return {
                term: this.persistentState.getCurrentTerm(),
                success: true,
                matchIndex
            };
        });
    }

    private async handleElectionTimeoutlocked(): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            await this.handleElectionTimeoutUnlocked();
        });
    }

    private async handleElectionTimeoutUnlocked(): Promise<void> {
        if (this.currentState === RaftState.Leader) {
            return;
        }

        this.logger.info(`Node ${this.nodeId} election timeout, starting new election`);
        await this.becomeCandidateUnlocked();
    }

    private async becomeFollowerUnlocked(term: number, leaderId: NodeId | null): Promise<void> {
        this.logger.info(`Node ${this.nodeId} becoming Follower for term ${term}, leader: ${leaderId}`);

        const currentTerm = this.persistentState.getCurrentTerm();
        if (term > currentTerm) {
            await this.persistentState.updateTermAndVote(term, null);
            this.logger.info(`Node ${this.nodeId} updated term to ${term} and cleared votes`);
        }

        const wasLeader = this.currentState === RaftState.Leader;

        this.currentState = RaftState.Follower;
        this.votesReceived.clear();
        this.currentLeader = leaderId;

        if (wasLeader) {
            this.leaderState = null;
            this.timerManager.stopHeartbeatTimer();
            this.logger.info(`Node ${this.nodeId} was previously a Leader, now a Follower`);
        }

        this.timerManager.startElectionTimer(() => this.handleElectionTimeoutlocked());

        this.logger.info(`Node ${this.nodeId} is now a Follower with term ${this.persistentState.getCurrentTerm()}`);
    }

    private async becomeCandidateUnlocked(): Promise<void> {
        this.currentState = RaftState.Candidate;
        this.currentLeader = null;

        this.leaderState = null;

        const newTerm = (this.persistentState.getCurrentTerm() + 1);

        await this.persistentState.updateTermAndVote(newTerm, this.nodeId);

        this.votesReceived.clear();
        this.votesReceived.add(this.nodeId);

        const clusterSize = this.peers.length + 1;
        this.votesNeeded = Math.floor(clusterSize / 2) + 1;

        this.logger.info(`Node ${this.nodeId} became Candidate for term ${newTerm}, votes needed: ${this.votesNeeded}`);

        this.timerManager.startElectionTimer(() => this.handleElectionTimeoutlocked());

        await this.requestVotes();
    }

    private async becomeLeaderUnlocked(): Promise<void> {
        this.currentState = RaftState.Leader;
        this.currentLeader = this.nodeId;

        const currentTerm = this.persistentState.getCurrentTerm();
        const lastLogIndex = this.logManager.getLastIndex();

        this.logger.info(`Node ${this.nodeId} became Leader for term ${currentTerm}, last log index: ${lastLogIndex}`);

        this.leaderState = new LeaderState(this.peers, lastLogIndex);

        this.timerManager.startHeartbeatTimer(() => this.sendHeartbeatsLocked());

        await this.sendHeartbeatsUnlocked();
    }

    private async requestVotes(): Promise<void> {
        const currentTerm = this.persistentState.getCurrentTerm();
        const lastLogIndex = this.logManager.getLastIndex();
        const lastLogTerm = this.logManager.getLastTerm();

        const request: RequestVoteRequest = {
            term: currentTerm,
            candidateId: this.nodeId,
            lastLogIndex,
            lastLogTerm
        };

        this.logger.info(`Node ${this.nodeId} sending RequestVote to peers: ${this.peers.join(", ")}`);

        for (const peer of this.peers) {
            this.sendRequestVote(peer, request)
        }
    }

    private async sendRequestVote(peer: NodeId, request: RequestVoteRequest): Promise<void> {
        try {
            const response = await this.rpcHandler.sendRequestVote(peer, request);
            await this.handleRequestVoteResponse(peer, response);
        } catch (err) {

            if (err instanceof Error) {
                this.logger.error(`Node ${this.nodeId} error sending RequestVote to ${peer}: ${err.message}`);

            } else { 
                this.logger.error(`Node ${this.nodeId} error sending RequestVote to ${peer}: ${String(err)}`);
            }
        }
    }

    private async handleRequestVoteResponse(from: NodeId, response: RequestVoteResponse): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            const currentTerm = this.persistentState.getCurrentTerm();

            if (response.term > currentTerm) {
                this.logger.info(`Node ${this.nodeId} received higher term ${response.term} from ${from}, becoming Follower`);
                await this.becomeFollowerUnlocked(response.term, null);
                return;
            }

            if (this.currentState !== RaftState.Candidate) {
                this.logger.info(`Node ${this.nodeId} received RequestVoteResponse from ${from} but is no longer a Candidate`);
                return;
            }

            if (response.term !== currentTerm) {
                this.logger.info(`Node ${this.nodeId} received RequestVoteResponse from ${from} with term ${response.term} but current term is ${currentTerm}`);
                return;
            }

            if (response.voteGranted) {
                this.votesReceived.add(from);
                this.logger.info(`Node ${this.nodeId} received vote from ${from}, total votes: ${this.votesReceived.size}/${this.votesNeeded}`);

                if (this.votesReceived.size >= this.votesNeeded) {
                    this.logger.info(`Node ${this.nodeId} received majority votes, becoming Leader`);
                    await this.becomeLeaderUnlocked();
                }

            } else {
                this.logger.info(`Node ${this.nodeId} received vote denial from ${from}`);
            }
        });
    }

    private async sendHeartbeatsLocked(): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            await this.sendHeartbeatsUnlocked();
        });
    }

    private async sendHeartbeatsUnlocked(): Promise<void> {
        if (this.currentState !== RaftState.Leader) {
            return;
        }

        if (!this.leaderState) {
            throw new RaftError("LeaderState is required to send heartbeats", "LEADER_STATE_REQUIRED");
        }

        for (const peer of this.peers) {
            this.sendAppendEntries(peer);
        }
    }

    private async sendAppendEntries(peer: NodeId): Promise<void> {

        let request: AppendEntriesRequest;

        try {
            await this.stateLock.runExclusive(async () => {
                if (!this.leaderState) {
                    throw new RaftError("LeaderState is required to handle AppendEntriesResponse", "LEADER_STATE_REQUIRED");
                }

                const currentTerm = this.persistentState.getCurrentTerm();
                const nextIndex = this.leaderState!.getNextIndex(peer);
                const prevLogIndex = nextIndex - 1;
                const prevLogTerm = await this.logManager.getTermAtIndex(prevLogIndex) ?? 0;

                const entries = await this.logManager.getEntriesFromIndex(nextIndex);

                request = {
                    term: currentTerm,
                    leaderId: this.nodeId,
                    prevLogIndex,
                    prevLogTerm,
                    entries,
                    leaderCommit: this.volatileState.getCommitIndex()
                };
            });

            const response: AppendEntriesResponse = await this.rpcHandler.sendAppendEntries(peer, request!);
            
            await this.handleAppendEntriesResponse(peer, response);

        } catch (err) {
            if (err instanceof Error) {
                this.logger.error(`Node ${this.nodeId} error sending AppendEntries to ${peer}: ${err.message}`);
            } else {
                this.logger.error(`Node ${this.nodeId} error sending AppendEntries to ${peer}: ${String(err)}`);
            }
        }
    }

    private async handleAppendEntriesResponse(from: NodeId, response: AppendEntriesResponse): Promise<void> {
        await this.stateLock.runExclusive(async () => {

            if (!this.leaderState) {
                throw new RaftError("LeaderState is required to handle AppendEntriesResponse", "LEADER_STATE_REQUIRED");
            }

            const currentTerm = this.persistentState.getCurrentTerm();

            if (response.term > currentTerm) {
                this.logger.info(`Node ${this.nodeId} received higher term ${response.term} from ${from}, becoming Follower`);
                await this.becomeFollowerUnlocked(response.term, null);
                return;
            }

            if (response.term !== currentTerm) {
                this.logger.info(`Node ${this.nodeId} received AppendEntriesResponse from ${from} with term ${response.term} but current term is ${currentTerm}`);
                return;
            }

            if(this.currentState !== RaftState.Leader) {
                this.logger.info(`Node ${this.nodeId} received AppendEntriesResponse from ${from} but is no longer a Leader`);
                return;
            }

            if (response.success) {
                if(response.matchIndex === undefined) {
                    this.logger.error(`Node ${this.nodeId} received AppendEntriesResponse from ${from} with undefined matchIndex`);
                    return;
                }

                this.leaderState.updateMatchIndex(from, response.matchIndex);
                this.logger.info(`Node ${this.nodeId} received successful AppendEntriesResponse from ${from}, matchIndex: ${response.matchIndex}`);
                await this.tryAdvanceCommitIndex();
            } else {
                if (response.conflictTerm !== undefined && response.conflictIndex !== undefined) {
                    this.logger.debug('using conflict info to backtrack nextIndex for peer', { peer: from, conflictTerm: response.conflictTerm, conflictIndex: response.conflictIndex, oldNextIndex: this.leaderState.getNextIndex(from) });

                    this.leaderState.updateNextIndexWithConflict(from, response.conflictTerm, response.conflictIndex, this.logManager);

                    this.logger.debug('updated nextIndex for peer after conflict', { peer: from, newNextIndex: this.leaderState.getNextIndex(from) });
                } else {
                    this.logger.debug('no conflict info provided, simply decrementing nextIndex for peer', { peer: from, oldNextIndex: this.leaderState.getNextIndex(from) });
                    this.leaderState.decrementNextIndex(from);
                    this.logger.debug('decremented nextIndex for peer', { peer: from, newNextIndex: this.leaderState.getNextIndex(from) });
                }
            }
        });
    }

    private async tryAdvanceCommitIndex(): Promise<void> {

        if (!this.leaderState) {
            throw new RaftError("LeaderState is required to advance commit index", "LEADER_STATE_REQUIRED");
        }

        const currentTerm = this.persistentState.getCurrentTerm();
        const newCommitIndex = await this.leaderState.calculateCommitIndex(currentTerm, this.logManager);

        const currentCommitIndex = this.volatileState.getCommitIndex();

        if (newCommitIndex > currentCommitIndex) {
            this.volatileState.setCommitIndex(newCommitIndex);
            this.logger.info(`Node ${this.nodeId} advanced commit index to ${newCommitIndex}`);

            this.onCommitIndexAdvanced?.(newCommitIndex);
        }
    }
}