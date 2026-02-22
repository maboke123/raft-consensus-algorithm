import { NodeId } from "../core/Config";
import { LogEntry } from "../log/LogEntry";
import {
    RequestVoteRequest,
    RequestVoteResponse,
    AppendEntriesRequest,
    AppendEntriesResponse,
} from "../rpc/RPCTypes";
import { RaftState } from "../core/StateMachine";

export interface BaseEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    nodeId: NodeId;
}

export interface NodeStateChangedEvent extends BaseEvent {
    type: "NodeStateChanged";
    oldState: RaftState;
    newState: RaftState;
    term: number;
}

export interface TermChangedEvent extends BaseEvent {
    type: "TermChanged";
    oldTerm: number;
    newTerm: number;
    reason: "election" | "higher term";
}

export interface CommitIndexAdvancedEvent extends BaseEvent {
    type: "CommitIndexAdvanced";
    oldCommitIndex: number;
    newCommitIndex: number;
    term: number;
}

export interface NodeCrashedEvent extends BaseEvent {
    type: "NodeCrashed";
    reason?: string;
}

export interface NodeRecoveredEvent extends BaseEvent {
    type: "NodeRecovered";
    term: number;
    logLength: number;
}

export interface LogAppendedEvent extends BaseEvent {
    type: "LogAppended";
    entries: LogEntry[];
    term: number;
}

export interface LogConflictResolvedEvent extends BaseEvent {
    type: "LogConflictResolved";
    truncatedFromIndex: number;
    newEntries: LogEntry[];
    term: number;
}

export interface ElectionStartedEvent extends BaseEvent {
    type: "ElectionStarted";
    term: number;
}

export interface VoteGrantedEvent extends BaseEvent {
    type: "VoteGranted";
    term: number;
    voterId: NodeId;
    candidateId: NodeId;
}

export interface VoteDeniedEvent extends BaseEvent {
    type: "VoteDenied";
    term: number;
    voterId: NodeId;
    candidateId: NodeId;
    reason: "already voted" | "outdated term" | "log not up-to-date";
}

export interface LeaderElectedEvent extends BaseEvent {
    type: "LeaderElected";
    term: number;
    leaderId: NodeId;
    voteCount: number;
    clusterSize: number;
}

export interface MatchIndexUpdatedEvent extends BaseEvent {
    type: "MatchIndexUpdated";
    followerId: NodeId;
    prevMatchIndex: number;
    newMatchIndex: number;
    term: number;
}

export interface NextIndexDecrementedEvent extends BaseEvent {
    type: "NextIndexDecremented";
    followerId: NodeId;
    prevNextIndex: number;
    newNextIndex: number;
    term: number;
}

export type MessageType = 
    | "RequestVote"
    | "RequestVoteResponse"
    | "AppendEntries"
    | "AppendEntriesResponse";

interface BaseMessageEvent extends BaseEvent {
    messageId: string;
    fromNodeId: NodeId;
    toNodeId: NodeId;
    term: number;
}

export interface RequestVoteSentEvent extends BaseMessageEvent {
    type: "MessageSent";
    messageType: "RequestVote";
    payload: RequestVoteRequest;
}

export interface RequestVoteReceivedEvent extends BaseMessageEvent {
    type: "MessageReceived";
    messageType: "RequestVoteResponse";
    payload: RequestVoteResponse;
    latencyMs: number;
}

export interface AppendEntriesSentEvent extends BaseMessageEvent {
    type: "MessageSent";
    messageType: "AppendEntries";
    payload: AppendEntriesRequest;
}

export interface AppendEntriesReceivedEvent extends BaseMessageEvent {
    type: "MessageReceived";
    messageType: "AppendEntriesResponse";
    payload: AppendEntriesResponse;
    latencyMs: number;
}

export type MessageSentEvent = RequestVoteSentEvent | AppendEntriesSentEvent;
export type MessageReceivedEvent = RequestVoteReceivedEvent | AppendEntriesReceivedEvent;

export interface MessageDroppedEvent extends BaseMessageEvent {
    type: "MessageDropped";
    messageType: MessageType;
    reason: "network partition" | "simulated loss" | "timeout" | "peer down";
}

export interface PartitionCreatedEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    type: "PartitionCreated";
    groupA: NodeId[];
    groupB: NodeId[];
}

export interface PartitionHealedEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    type: "PartitionHealed";
}

export type RaftEvent =
    | NodeStateChangedEvent
    | TermChangedEvent
    | CommitIndexAdvancedEvent
    | NodeCrashedEvent
    | NodeRecoveredEvent
    | LogAppendedEvent
    | LogConflictResolvedEvent
    | ElectionStartedEvent
    | VoteGrantedEvent
    | VoteDeniedEvent
    | LeaderElectedEvent
    | MatchIndexUpdatedEvent
    | NextIndexDecrementedEvent
    | MessageSentEvent
    | MessageReceivedEvent
    | MessageDroppedEvent
    | PartitionCreatedEvent
    | PartitionHealedEvent;

export interface RaftEventBus {
    emit(event: RaftEvent): void;
    subscribe(handler: (event: RaftEvent) => void): () => void;
}

export interface InitialStateMessage {
    type: "InitialState";
    events: RaftEvent[];
    nodeIds: NodeId[];
}

export interface LiveEventMessage {
    type: "LiveEvent";
    event: RaftEvent;
}

export type ServerMessage = InitialStateMessage | LiveEventMessage;