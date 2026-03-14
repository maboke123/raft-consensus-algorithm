import { NodeId, RaftConfig } from "./Config";
import { RequestVoteRequest, RequestVoteResponse, AppendEntriesRequest, AppendEntriesResponse, InstallSnapshotRequest, InstallSnapshotResponse } from "../rpc/RPCTypes";
import { LeaderState } from "../state/LeaderState";
import { PersistentState } from "../state/PersistentState";
import { VolatileState } from "../state/VolatileState";
import { LogManager } from "../log/LogManager";
import { RPCHandler } from "../rpc/RPCHandler";
import { TimerManager } from "../timing/TimerManager";
import { Logger } from "../util/Logger";
import { RaftError } from "../util/Error";
import { AsyncLock } from "../lock/AsyncLock";
import { RaftEventBus, BaseEvent } from "../events/RaftEvents";
import { NoOpEventBus } from "../events/EventBus";
import { SnapshotManager } from "../snapshot/SnapshotManager";
import { ApplicationStateMachine } from "./RaftNode";
import { ConfigManager } from "../config/ConfigManager";
import { LogEntryType } from "../log/LogEntry";

function baseEvent(nodeId: NodeId): BaseEvent {
    return {
        eventId: crypto.randomUUID(),
        timestamp: performance.now(),
        wallTime: Date.now(),
        nodeId
    };
}


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
    handleInstallSnapshot(from: NodeId, request: InstallSnapshotRequest): Promise<InstallSnapshotResponse>;
}

export class StateMachine implements StateMachineInterface {
    private currentState: RaftState = RaftState.Follower;
    private currentLeader: NodeId | null = null;

    private votesReceived: Set<NodeId> = new Set();
    private votesNeeded: number = 0;

    private leaderState: LeaderState | null = null;

    private stateLock = new AsyncLock();

    private lastLeaderContactAt: number = 0;
    private preVoteInProgress: boolean = false;
    private preVoteTerm: number = 0;
    private preVotesReceived: Set<NodeId> = new Set();

    private onPeerDiscovered?: (peerId: NodeId, lastLogIndex: number) => void;

    constructor(
        private nodeId: NodeId,
        private configManager: ConfigManager,
        private config: RaftConfig,
        private persistentState: PersistentState,
        private volatileState: VolatileState,
        private logManager: LogManager,
        private snapshotManager: SnapshotManager,
        private applicationStateMachine: ApplicationStateMachine,
        private rpcHandler: RPCHandler,
        private timerManager: TimerManager,
        private logger: Logger,
        private applyLock: AsyncLock,
        private onCommitIndexAdvanced?: (newCommitIndex: number) => void,
        private eventBus: RaftEventBus = new NoOpEventBus(),
        onPeerDiscovered?: (peerId: NodeId, lastLogIndex: number) => void
    ) {
        this.onPeerDiscovered = onPeerDiscovered;
    }

    async start(): Promise<void> {
        this.logger.info(`Node ${this.nodeId} starting as ${this.currentState}`);
        await this.becomeFollower( this.persistentState.getCurrentTerm(), null);
    }

    async stop(): Promise<void> {
        this.logger.info(`Node ${this.nodeId} stopping`);
        this.timerManager.stopAllTimers();
        this.currentState = RaftState.Follower;
        this.currentLeader = null;
        this.votesReceived.clear();
        this.leaderState = null;
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
            await this.becomeFollowerUnlocked(term, leaderId);
        });
    }

    async becomeCandidate(): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            await this.becomeCandidateUnlocked();
        });
    }

    async becomeLeader(): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            await this.becomeLeaderUnlocked();
        });
    }

    async handleRequestVote(from: NodeId, request: RequestVoteRequest): Promise<RequestVoteResponse> {
        return await this.stateLock.runExclusive(async () => {
            const currentTerm = this.persistentState.getCurrentTerm();
            const selfIsVoter = this.configManager.isVoter(this.nodeId);
            const candidateIsVoter = this.configManager.isVoter(request.candidateId);

            if (request.preVote) {
                if (request.term < currentTerm) {
                    return { term: currentTerm, voteGranted: false };
                }
                if (!selfIsVoter || !candidateIsVoter) {
                    return { term: currentTerm, voteGranted: false };
                }
                const noRecentLeader = this.lastLeaderContactAt === 0 ||
                    performance.now() - this.lastLeaderContactAt >= this.config.electionTimeoutMinMs;
                const isLogUpToDate = this.isLogUpToDate(request.lastLogIndex, request.lastLogTerm);
                const granted = noRecentLeader && isLogUpToDate;
                this.logger.info(`Node ${this.nodeId} ${granted ? 'granting' : 'denying'} pre-vote to ${request.candidateId} (noRecentLeader=${noRecentLeader}, logUpToDate=${isLogUpToDate})`);
                return { term: currentTerm, voteGranted: granted };
            }

            if (request.term < currentTerm) {
                this.logger.info(`Node ${this.nodeId} received RequestVote from ${from} with stale term ${request.term}, current term is ${currentTerm}`);

                this.eventBus.emit({
                    ...baseEvent(this.nodeId),
                    type: "VoteDenied",
                    term: currentTerm,
                    voterId: this.nodeId,
                    candidateId: request.candidateId,
                    reason: "outdated term"
                });

                return {
                    term: currentTerm,
                    voteGranted: false
                };
            }

            if (request.term > currentTerm) {
                this.logger.info(`Node ${this.nodeId} received RequestVote from ${from} with higher term ${request.term}, updating term and becoming Follower`);
                await this.becomeFollowerUnlocked(request.term, null);

            }

            if (!selfIsVoter || !candidateIsVoter) {
                this.logger.info(`Node ${this.nodeId} cannot grant vote to ${request.candidateId} because voter membership check failed (selfIsVoter=${selfIsVoter}, candidateIsVoter=${candidateIsVoter})`);
                return {
                    term: this.persistentState.getCurrentTerm(),
                    voteGranted: false
                };
            }

            /* no step down ?
            else if (request.term === currentTerm && this.currentState !== RaftState.Follower) {
                this.logger.info(`Node ${this.nodeId} received RequestVote from ${from} with current term ${request.term} but is not a Follower, becoming Follower`);
                await this.becomeFollowerUnlocked(request.term, null);
            }
            */

            const votedFor = this.persistentState.getVotedFor();

            const canGrantVote = votedFor === null || votedFor === request.candidateId;

            if (!canGrantVote) {
                this.logger.info(`Node ${this.nodeId} cannot grant vote to ${request.candidateId} because it has already voted for ${votedFor}`);

                this.eventBus.emit({
                    ...baseEvent(this.nodeId),
                    type: "VoteDenied",
                    term: this.persistentState.getCurrentTerm(),
                    voterId: this.nodeId,
                    candidateId: request.candidateId,
                    reason: "already voted"
                });

                return {
                    term: this.persistentState.getCurrentTerm(),
                    voteGranted: false
                };
            }

            const isLogUpToDate = this.isLogUpToDate(request.lastLogIndex, request.lastLogTerm);

            if (!isLogUpToDate) {
                this.logger.info(`Node ${this.nodeId} cannot grant vote to ${request.candidateId} because its log is not up-to-date`);

                this.eventBus.emit({
                    ...baseEvent(this.nodeId),
                    type: "VoteDenied",
                    term: this.persistentState.getCurrentTerm(),
                    voterId: this.nodeId,
                    candidateId: request.candidateId,
                    reason: "log not up-to-date"
                });

                return {
                    term: this.persistentState.getCurrentTerm(),
                    voteGranted: false
                };
            }

            await this.persistentState.updateTermAndVote(request.term, request.candidateId);
            this.logger.info(`Node ${this.nodeId} granted vote to ${request.candidateId} for term ${request.term}`);

            this.eventBus.emit({
                ...baseEvent(this.nodeId),
                type: "VoteGranted",
                term: request.term,
                voterId: this.nodeId,
                candidateId: request.candidateId
            });

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

            this.logger.info(`Node ${this.nodeId} received AppendEntries from ${from} with higher term ${request.term}, updating term and becoming Follower`);
            this.lastLeaderContactAt = performance.now();
            await this.becomeFollowerUnlocked(request.term, request.leaderId);

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

                for (const entry of request.entries) {
                    if (entry.type === LogEntryType.CONFIG && entry.config) {
                        this.configManager.applyConfigEntry(entry.config);
                        this.logger.info(`Node ${this.nodeId} processing configuration entry from ${from}, new config: ${JSON.stringify(entry.config)}`);
                    }
                }
            }

            const leaderCommit = request.leaderCommit;
            const currentCommitIndex = this.volatileState.getCommitIndex();

            if (leaderCommit > currentCommitIndex) {
                const lastNewEntryIndex = request.prevLogIndex + request.entries.length;
                const newCommitIndex = Math.min(leaderCommit, lastNewEntryIndex);

                for (let i = currentCommitIndex + 1; i <= newCommitIndex; i++) {
                    const entry = await this.logManager.getEntry(i);
                    if (entry && entry.type == LogEntryType.CONFIG && entry.config) {
                        await this.configManager.commitConfig(entry.config);
                        this.logger.info(`Node ${this.nodeId} committed configuration entry at index ${i} from ${from}, new config: ${JSON.stringify(entry.config)}`);
                    }
                }

                this.volatileState.setCommitIndex(newCommitIndex);
                this.logger.info(`Node ${this.nodeId} updated commit index to ${newCommitIndex} based on leader ${from}`);

                this.eventBus.emit({
                    ...baseEvent(this.nodeId),
                    type: "CommitIndexAdvanced",
                    oldCommitIndex: currentCommitIndex,
                    newCommitIndex,
                    term: this.persistentState.getCurrentTerm()
                });

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

    async handleInstallSnapshot(from: NodeId, request: InstallSnapshotRequest): Promise<InstallSnapshotResponse> {
        return await this.stateLock.runExclusive(async () => {
            const currentTerm = this.persistentState.getCurrentTerm();

            if (request.term < currentTerm) {
                return { term: currentTerm, success: false };
            }

            if (request.term > currentTerm) {
                await this.persistentState.updateTermAndVote(request.term, null);
            }

            await this.snapshotManager.saveSnapshot({
                lastIncludedIndex: request.lastIncludedIndex,
                lastIncludedTerm: request.lastIncludedTerm,
                data: request.data,
                config: request.config
            });

            await this.applyLock.runExclusive(async () => {
                if (request.lastIncludedIndex <= this.logManager.getLastIndex()) {
                    await this.logManager.discardEntriesUpTo(request.lastIncludedIndex, request.lastIncludedTerm);
                } else {
                    await this.logManager.resetToSnapshot(request.lastIncludedIndex, request.lastIncludedTerm);
                }

                await this.applicationStateMachine.installSnapshot(request.data);

                this.volatileState.setCommitIndex(request.lastIncludedIndex);
                this.volatileState.setLastApplied(request.lastIncludedIndex);
            });

            if (request.config.voters.length > 0) {
                this.configManager.applyConfigEntry(request.config);
                await this.configManager.commitConfig(request.config);
                this.logger.info(`Node ${this.nodeId} applied new configuration from snapshot sent by ${from}, new config: ${JSON.stringify(request.config)}`);
            }

            await this.becomeFollowerUnlocked(request.term, request.leaderId);

            this.logger.info(`Installed snapshot from leader ${from} with last included index ${request.lastIncludedIndex} and term ${request.lastIncludedTerm}`);

            this.eventBus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.nodeId,
                type: "SnapshotInstalled",
                lastIncludedIndex: request.lastIncludedIndex,
                lastIncludedTerm: request.lastIncludedTerm,
                senderId: from,
            });

            return { term: this.persistentState.getCurrentTerm(), success: true };
        });
    }

    private async handleElectionTimeoutlocked(): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            await this.handleElectionTimeoutUnlocked();
        });
    }

    private async handleElectionTimeoutUnlocked(): Promise<void> {
        if (!this.configManager.isVoter(this.nodeId)) {
            this.logger.info(`Node ${this.nodeId} is not a voter, ignoring election timeout`);
            return;
        }

        if (this.currentState === RaftState.Leader) {
            return;
        }

        if (this.preVoteInProgress) {
            this.logger.info(`Node ${this.nodeId} pre-vote timed out, restarting pre-vote`);
            this.preVoteInProgress = false;
            this.preVotesReceived.clear();
            await this.startPreVoteUnlocked();
            return;
        }

        if (this.currentState === RaftState.Candidate) {
            this.logger.info(`Node ${this.nodeId} election timed out as candidate, restarting election`);
            await this.becomeCandidateUnlocked();
            return;
        }

        this.logger.info(`Node ${this.nodeId} election timeout, starting pre-vote phase`);
        await this.startPreVoteUnlocked();
    }

    private async becomeFollowerUnlocked(term: number, leaderId: NodeId | null): Promise<void> {
        this.logger.info(`Node ${this.nodeId} becoming Follower for term ${term}, leader: ${leaderId}`);

        const currentTerm = this.persistentState.getCurrentTerm();
        if (term > currentTerm) {
            await this.persistentState.updateTermAndVote(term, null);
            this.logger.info(`Node ${this.nodeId} updated term to ${term} and cleared votes`);
            this.eventBus.emit({
                ...baseEvent(this.nodeId),
                type: "TermChanged",
                oldTerm: currentTerm,
                newTerm: term,
                reason: "higher term"
            });
        }

        const wasLeader = this.currentState === RaftState.Leader;

        const oldState = this.currentState;
        this.currentState = RaftState.Follower;

        if (oldState !== RaftState.Follower) {
            this.eventBus.emit({
                ...baseEvent(this.nodeId),
                type: "NodeStateChanged",
                oldState,
                newState: RaftState.Follower,
                term: this.persistentState.getCurrentTerm()
            });
        }

        this.votesReceived.clear();
        this.preVoteInProgress = false;
        this.preVotesReceived.clear();
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
        if (!this.configManager.isVoter(this.nodeId)) {
            this.logger.info(`Node ${this.nodeId} is not a voter, refusing transition to Candidate`);
            await this.becomeFollowerUnlocked(this.persistentState.getCurrentTerm(), null);
            return;
        }

        const oldState = this.currentState;

        this.currentState = RaftState.Candidate;
        this.currentLeader = null;

        this.leaderState = null;

        const newTerm = (this.persistentState.getCurrentTerm() + 1);

        await this.persistentState.updateTermAndVote(newTerm, this.nodeId);

        this.eventBus.emit({
            ...baseEvent(this.nodeId),
            type: "TermChanged",
            oldTerm: newTerm - 1,
            newTerm: newTerm,
            reason: "election"
        });

        this.eventBus.emit({
            ...baseEvent(this.nodeId),
            type: "NodeStateChanged",
            oldState: oldState,
            newState: RaftState.Candidate,
            term: newTerm
        });

        this.eventBus.emit({
            ...baseEvent(this.nodeId),
            type: "ElectionStarted",
            term: newTerm
        });

        this.votesReceived.clear();

        if (this.configManager.isVoter(this.nodeId)) {
            this.votesReceived.add(this.nodeId);
        }

        this.votesNeeded = this.configManager.getQuorumSize();

        this.logger.info(`Node ${this.nodeId} became Candidate for term ${newTerm}, votes needed: ${this.votesNeeded}`);

        this.timerManager.startElectionTimer(() => this.handleElectionTimeoutlocked());

        await this.requestVotes();
    }

    private async becomeLeaderUnlocked(): Promise<void> {
        if (!this.configManager.isVoter(this.nodeId)) {
            this.logger.warn(`Node ${this.nodeId} is not a voter, refusing transition to Leader`);
            await this.becomeFollowerUnlocked(this.persistentState.getCurrentTerm(), null);
            return;
        }
        
        const oldState = this.currentState;

        this.currentState = RaftState.Leader;
        this.currentLeader = this.nodeId;

        const currentTerm = this.persistentState.getCurrentTerm();
        const lastLogIndex = this.logManager.getLastIndex();

        this.logger.info(`Node ${this.nodeId} became Leader for term ${currentTerm}, last log index: ${lastLogIndex}`);

        this.eventBus.emit({
            ...baseEvent(this.nodeId),
            type: "NodeStateChanged",
            oldState: oldState,
            newState: RaftState.Leader,
            term: currentTerm
        });

        this.eventBus.emit({
            ...baseEvent(this.nodeId),
            type: "LeaderElected",
            term: currentTerm,
            leaderId: this.nodeId,
            voteCount: this.votesReceived.size,
            clusterSize: this.configManager.getVoters().length
        });

        this.leaderState = new LeaderState(this.configManager.getAllPeers(this.nodeId), lastLogIndex);

        try {
            await this.logManager.appendNoOpEntry(currentTerm);
            this.logger.info(`Node ${this.nodeId} appended initial no-op entry for term ${currentTerm}`);
        } catch (err) {
            this.logger.error(`Node ${this.nodeId} failed to append initial no-op entry as Leader: ${err instanceof Error ? err.message : String(err)}`);
        }

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

        this.logger.info(`Node ${this.nodeId} sending RequestVote to peers: ${this.configManager.getAllPeers(this.nodeId).join(", ")}`);

        const voters = this.configManager.getVoters().filter(peerId => peerId !== this.nodeId);

        for (const peer of voters) {
            this.sendRequestVote(peer, request)
        }
    }

    private async startPreVoteUnlocked(): Promise<void> {
        this.preVoteInProgress = true;
        this.preVoteTerm = this.persistentState.getCurrentTerm();
        this.preVotesReceived.clear();

        if (this.configManager.isVoter(this.nodeId)) {
            this.preVotesReceived.add(this.nodeId);
        }

        const quorumSize = this.configManager.getQuorumSize();
        if (this.preVotesReceived.size >= quorumSize) {
            this.preVoteInProgress = false;
            await this.becomeCandidateUnlocked();
            return;
        }

        this.timerManager.startElectionTimer(() => this.handleElectionTimeoutlocked());
        await this.requestPreVotes();
    }

    private async requestPreVotes(): Promise<void> {
        const currentTerm = this.persistentState.getCurrentTerm();
        const lastLogIndex = this.logManager.getLastIndex();
        const lastLogTerm = this.logManager.getLastTerm();

        const request: RequestVoteRequest = {
            term: currentTerm + 1,
            candidateId: this.nodeId,
            lastLogIndex,
            lastLogTerm,
            preVote: true
        };

        this.logger.info(`Node ${this.nodeId} sending pre-vote requests for term ${currentTerm + 1} to peers: ${this.configManager.getVoters().filter(p => p !== this.nodeId).join(", ")}`);

        const voters = this.configManager.getVoters().filter(peerId => peerId !== this.nodeId);

        for (const peer of voters) {
            this.sendPreVote(peer, request);
        }
    }

    private async sendPreVote(peer: NodeId, request: RequestVoteRequest): Promise<void> {
        try {
            const response = await this.rpcHandler.sendRequestVote(peer, request);
            await this.handlePreVoteResponse(peer, response);
        } catch (err) {
            if (err instanceof Error) {
                this.logger.error(`Node ${this.nodeId} error sending pre-vote to ${peer}: ${err.message}`);
            } else {
                this.logger.error(`Node ${this.nodeId} error sending pre-vote to ${peer}: ${String(err)}`);
            }
        }
    }

    private async handlePreVoteResponse(from: NodeId, response: RequestVoteResponse): Promise<void> {
        await this.stateLock.runExclusive(async () => {
            if (!this.preVoteInProgress) {
                return;
            }

            if (this.currentState !== RaftState.Follower) {
                this.preVoteInProgress = false;
                return;
            }

            if (response.term > this.persistentState.getCurrentTerm()) {
                this.logger.info(`Node ${this.nodeId} received higher term ${response.term} from ${from} during pre-vote, becoming Follower`);
                await this.becomeFollowerUnlocked(response.term, null);
                return;
            }

            if (this.persistentState.getCurrentTerm() !== this.preVoteTerm) {
                this.preVoteInProgress = false;
                return;
            }

            if (response.voteGranted) {
                this.preVotesReceived.add(from);
                this.logger.info(`Node ${this.nodeId} received pre-vote from ${from}, total pre-votes: ${this.preVotesReceived.size}/${this.configManager.getQuorumSize()}`);
                if (this.preVotesReceived.size >= this.configManager.getQuorumSize()) {
                    this.logger.info(`Node ${this.nodeId} received pre-vote quorum, starting actual election`);
                    this.preVoteInProgress = false;
                    await this.becomeCandidateUnlocked();
                }
            } else {
                this.logger.info(`Node ${this.nodeId} received pre-vote denial from ${from}`);
            }
        });
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

        const allPeers = this.configManager.getAllPeers(this.nodeId);

        for (const peer of allPeers) {
            if (!this.leaderState.getPeers().includes(peer)) {
                this.leaderState.addPeer(peer, this.logManager.getLastIndex());
                this.onPeerDiscovered?.(peer, this.logManager.getLastIndex());
                this.logger.info(`Node ${this.nodeId} added new peer ${peer} to LeaderState with nextIndex ${this.leaderState.getNextIndex(peer)}`);
            }
        }

        for (const peer of allPeers) {
            this.sendAppendEntries(peer);
        }
    }

    private async sendAppendEntries(peer: NodeId): Promise<void> {

        let request: AppendEntriesRequest | null = null;
        let shouldSendSnapshot = false;
        
        try {
            await this.stateLock.runExclusive(async () => {
                if (!this.leaderState) {
                    // throw new RaftError("LeaderState is required to handle AppendEntriesResponse", "LEADER_STATE_REQUIRED");
                    this.logger.debug(`Node ${this.nodeId} is not a leader but trying to send AppendEntries to ${peer}`);
                    return;
                }
                
                const nextIndex = this.leaderState!.getNextIndex(peer);
                const snapshotIndex = this.snapshotManager.getSnapshotMetadata()?.lastIncludedIndex ?? 0;

                if (nextIndex <= snapshotIndex) {
                    shouldSendSnapshot = true;
                    this.logger.debug(`Node ${this.nodeId} needs to send snapshot to ${peer} because nextIndex ${nextIndex} is <= snapshotIndex ${snapshotIndex}`);
                    return;
                }

                const currentTerm = this.persistentState.getCurrentTerm();
                const prevLogIndex = nextIndex - 1;
                const prevLogTerm = await this.logManager.getTermAtIndex(prevLogIndex) ?? 0;

                const entries = await this.logManager.getEntriesFromIndex(nextIndex);
                // error: getentriesfromindex() -> getentries(): invalid index range: from 1 to 2

                request = {
                    term: currentTerm,
                    leaderId: this.nodeId,
                    prevLogIndex,
                    prevLogTerm,
                    entries,
                    leaderCommit: this.volatileState.getCommitIndex()
                };
            });

            if (shouldSendSnapshot) {
                await this.sendSnapshot(peer);
                return;
            }

            if (!request) {
                return;
            }

            const response: AppendEntriesResponse = await this.rpcHandler.sendAppendEntries(peer, request);
            
            await this.handleAppendEntriesResponse(peer, response);

        } catch (err) {

            if (err instanceof Error) {
                this.logger.error(`Node ${this.nodeId} error sending AppendEntries to ${peer}: ${err.message}`);
            } else {
                this.logger.error(`Node ${this.nodeId} error sending AppendEntries to ${peer}: ${String(err)}`);
            }

            await this.stateLock.runExclusive(async () => {
                if (this.leaderState) {
                    this.leaderState.decrementNextIndex(peer);
                    this.logger.debug(`Node ${this.nodeId} decremented nextIndex for ${peer} to ${this.leaderState.getNextIndex(peer)} after failed AppendEntries`);
                }
            });
        }
    }
    
    private async sendSnapshot(peer: NodeId): Promise<void> {
        let request : InstallSnapshotRequest | null = null;

        await this.stateLock.runExclusive(async () => {
            const snapshot = await this.snapshotManager.loadSnapshot();

            if (!snapshot) {
                this.logger.error(`Node ${this.nodeId} has no snapshot to send to ${peer}`);
                return;
            }

            request = {
                term: this.persistentState.getCurrentTerm(),
                leaderId: this.nodeId,
                lastIncludedIndex: snapshot.lastIncludedIndex,
                lastIncludedTerm: snapshot.lastIncludedTerm,
                data: snapshot.data,
                config: snapshot.config
            };
        });

        if (!request) {
            return;
        }

        try {
            const response = await this.rpcHandler.sendInstallSnapshot(peer, request);

            await this.stateLock.runExclusive(async () => {
                if (!this.leaderState) {
                    this.logger.debug(`Node ${this.nodeId} received InstallSnapshotResponse from ${peer} but has no LeaderState`);
                    return;
                }

                if (response.term > this.persistentState.getCurrentTerm()) {
                    this.logger.info(`Node ${this.nodeId} received higher term ${response.term} from ${peer} in InstallSnapshotResponse, becoming Follower`);
                    await this.becomeFollowerUnlocked(response.term, null);
                    return;
                }

                if (response.success) {
                    this.leaderState.updateMatchIndex(peer, request!.lastIncludedIndex);
                    this.logger.info(`Node ${this.nodeId} successfully sent snapshot to ${peer}, updated matchIndex to ${request!.lastIncludedIndex}`);
                }
            });
        } catch (err) {
            if (err instanceof Error) {
                this.logger.error(`Node ${this.nodeId} error sending snapshot to ${peer}: ${err.message}`);
            } else {
                this.logger.error(`Node ${this.nodeId} error sending snapshot to ${peer}: ${String(err)}`);
            }
        }
    }

    private async handleAppendEntriesResponse(from: NodeId, response: AppendEntriesResponse): Promise<void> {
        await this.stateLock.runExclusive(async () => {

            if (!this.leaderState) {
                // throw new RaftError("LeaderState is required to handle AppendEntriesResponse", "LEADER_STATE_REQUIRED");
                this.logger.debug(`Node ${this.nodeId} received AppendEntriesResponse from ${from} but has no LeaderState`);
                return;
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

                const prevMatchIndex = this.leaderState.getMatchIndex(from);

                this.leaderState.updateMatchIndex(from, response.matchIndex);
                this.logger.info(`Node ${this.nodeId} received successful AppendEntriesResponse from ${from}, matchIndex: ${response.matchIndex}`);

                this.eventBus.emit({
                    ...baseEvent(this.nodeId),
                    type: "MatchIndexUpdated",
                    followerId: from,
                    prevMatchIndex: prevMatchIndex,
                    newMatchIndex: response.matchIndex,
                    term: currentTerm
                });

                await this.tryAdvanceCommitIndex();
            } else {

                const prevNextIndex = this.leaderState.getNextIndex(from);

                if (response.conflictTerm !== undefined && response.conflictIndex !== undefined) {
                    this.logger.debug('using conflict info to backtrack nextIndex for peer', { peer: from, conflictTerm: response.conflictTerm, conflictIndex: response.conflictIndex, oldNextIndex: this.leaderState.getNextIndex(from) });

                    this.leaderState.updateNextIndexWithConflict(from, response.conflictIndex, response.conflictTerm, this.logManager);

                    this.logger.debug('updated nextIndex for peer after conflict', { peer: from, newNextIndex: this.leaderState.getNextIndex(from) });

                } else {
                    this.logger.debug('no conflict info provided, simply decrementing nextIndex for peer', { peer: from, oldNextIndex: this.leaderState.getNextIndex(from) });

                    this.leaderState.decrementNextIndex(from);
                    this.logger.debug('decremented nextIndex for peer', { peer: from, newNextIndex: this.leaderState.getNextIndex(from) });
                }

                this.eventBus.emit({
                    ...baseEvent(this.nodeId),
                    type: "NextIndexDecremented",
                    followerId: from,
                    prevNextIndex: prevNextIndex,
                    newNextIndex: this.leaderState.getNextIndex(from),
                    term: currentTerm
                });
            }
        });
    }

    private async tryAdvanceCommitIndex(): Promise<void> {

        if (!this.leaderState) {
            throw new RaftError("LeaderState is required to advance commit index", "LEADER_STATE_REQUIRED");
        }

        const currentTerm = this.persistentState.getCurrentTerm();

        const voters = this.configManager.getVoters();

        const newCommitIndex = await this.leaderState.calculateCommitIndex(currentTerm, this.logManager, voters);

        const currentCommitIndex = this.volatileState.getCommitIndex();

        if (newCommitIndex > currentCommitIndex) {

            for (let i = currentCommitIndex + 1; i <= newCommitIndex; i++) {
                const entry = await this.logManager.getEntry(i);
                if (entry && entry.type === LogEntryType.CONFIG && entry.config) {
                    await this.configManager.commitConfig(entry.config);
                    this.logger.info(`Node ${this.nodeId} committed configuration entry at index ${i} while advancing commit index, new config: ${JSON.stringify(entry.config)}`);

                    if (this.leaderState) {
                        const allPeers = this.configManager.getAllPeers(this.nodeId);
                        for (const peer of allPeers) {
                            this.leaderState.addPeer(peer, this.logManager.getLastIndex());
                        }
                    }
                }
            }

            this.volatileState.setCommitIndex(newCommitIndex);
            this.logger.info(`Node ${this.nodeId} advanced commit index to ${newCommitIndex}`);

            this.eventBus.emit({
                ...baseEvent(this.nodeId),
                type: "CommitIndexAdvanced",
                oldCommitIndex: currentCommitIndex,
                newCommitIndex: newCommitIndex,
                term: currentTerm
            });

            this.onCommitIndexAdvanced?.(newCommitIndex);

            if (!this.configManager.isVoter(this.nodeId)) {
                this.logger.info(`Node ${this.nodeId} is not a voter, skipping check for configuration changes at new commit index ${newCommitIndex}`);
                await this.becomeFollowerUnlocked(currentTerm, null);
            }
        }
    }
}