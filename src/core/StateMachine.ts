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
        private leaderState?: LeaderState,
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
            this.timerManager.stopHeartbeatTimer();
            this.logger.info(`Node ${this.nodeId} was previously a Leader, now a Follower`);
        }

        this.timerManager.startElectionTimer(() => this.handleElectionTimeout());

        this.logger.info(`Node ${this.nodeId} is now a Follower with term ${this.persistentState.getCurrentTerm()}`);
    }

    async becomeCandidate(): Promise<void> {
        this.currentState = RaftState.Candidate;
        this.currentLeader = null;

        const newTerm = (this.persistentState.getCurrentTerm() + 1);

        await this.persistentState.updateTermAndVote(newTerm, this.nodeId);

        this.votesReceived.clear();
        this.votesReceived.add(this.nodeId);

        const clusterSize = this.peers.length + 1;
        this.votesNeeded = Math.floor(clusterSize / 2) + 1;

        this.logger.info(`Node ${this.nodeId} became Candidate for term ${newTerm}, votes needed: ${this.votesNeeded}`);

        this.timerManager.startElectionTimer(() => this.handleElectionTimeout());

        await this.requestVotes();
    }

    async becomeLeader(): Promise<void> {
        if (!this.leaderState) {
            throw new RaftError("LeaderState is required to become Leader", "LEADER_STATE_REQUIRED");
        }

        this.currentState = RaftState.Leader;
        this.currentLeader = this.nodeId;

        const currentTerm = this.persistentState.getCurrentTerm();
        const lastLogIndex = this.logManager.getLastIndex();

        this.logger.info(`Node ${this.nodeId} became Leader for term ${currentTerm}, last log index: ${lastLogIndex}`);

        this.leaderState.initialize(lastLogIndex);

        this.timerManager.startHeartbeatTimer(() => this.sendHeartbeats());

        await this.sendHeartbeats();
    }

    async handleRequestVote(from: NodeId, request: RequestVoteRequest): Promise<RequestVoteResponse> {
        // TODO
        throw new Error("Not implemented");
    }

    async handleAppendEntries(from: NodeId, request: AppendEntriesRequest): Promise<AppendEntriesResponse> {
        // TODO
        throw new Error("Not implemented");
    }

    private async handleElectionTimeout(): Promise<void> {
        if (this.currentState === RaftState.Leader) {
            return;
        }

        this.logger.info(`Node ${this.nodeId} election timeout, starting new election`);
        await this.becomeCandidate();
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
        const currentTerm = this.persistentState.getCurrentTerm();

        if (response.term > currentTerm) {
            this.logger.info(`Node ${this.nodeId} received higher term ${response.term} from ${from}, becoming Follower`);
            await this.becomeFollower(response.term, null);
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
                await this.becomeLeader();
            }

        } else {
            this.logger.info(`Node ${this.nodeId} received vote denial from ${from}`);
        }
    }

    private async sendHeartbeats(): Promise<void> {
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

        if (!this.leaderState) {
            throw new RaftError("LeaderState is required to handle AppendEntriesResponse", "LEADER_STATE_REQUIRED");
        }

        const currentTerm = this.persistentState.getCurrentTerm();
        const nextIndex = this.leaderState!.getNextIndex(peer);
        const prevLogIndex = nextIndex - 1;
        const prevLogTerm = await this.logManager.getTermAtIndex(prevLogIndex) ?? 0;

        const entries = await this.logManager.getEntriesFromIndex(nextIndex);

        const request: AppendEntriesRequest = {
            term: currentTerm,
            leaderId: this.nodeId,
            prevLogIndex,
            prevLogTerm,
            entries,
            leaderCommit: this.volatileState.getCommitIndex()
        };

        try {
            const response: AppendEntriesResponse = await this.rpcHandler.sendAppendEntries(peer, request);
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

        if (!this.leaderState) {
            throw new RaftError("LeaderState is required to handle AppendEntriesResponse", "LEADER_STATE_REQUIRED");
        }

        const currentTerm = this.persistentState.getCurrentTerm();

        if (response.term > currentTerm) {
            this.logger.info(`Node ${this.nodeId} received higher term ${response.term} from ${from}, becoming Follower`);
            await this.becomeFollower(response.term, null);
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
        }
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
        }
    }
}