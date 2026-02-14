import { NodeId, RaftConfig } from "./Config";
import { RequestVoteRequest, RequestVoteResponse, AppendEntriesRequest, AppendEntriesResponse } from "../rpc/RPCTypes";
import { LeaderState } from "../state/LeaderState";
import { PersistentState } from "../state/PersistentState";
import { VolatileState } from "../state/VolatileState";
import { LogManager } from "../log/LogManager";
import { RPCHandler } from "../rpc/RPCHandler";
import { TimerManager } from "../timing/TimerManager";
import { Logger } from "../util/Logger";


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
        // TODO
    }

    async stop(): Promise<void> {
        // TODO
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
        // TODO
    }

    async becomeCandidate(): Promise<void> {
        // TODO
    }

    async becomeLeader(): Promise<void> {
        // TODO
    }

    async handleRequestVote(from: NodeId, request: RequestVoteRequest): Promise<RequestVoteResponse> {
        // TODO
        throw new Error("Not implemented");
    }

    async handleAppendEntries(from: NodeId, request: AppendEntriesRequest): Promise<AppendEntriesResponse> {
        // TODO
        throw new Error("Not implemented");
    }
}