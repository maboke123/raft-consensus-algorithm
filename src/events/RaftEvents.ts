import { NodeId } from "../core/Config";
import { Command, LogEntry } from "../log/LogEntry";
import {
    RequestVoteRequest,
    RequestVoteResponse,
    AppendEntriesRequest,
    AppendEntriesResponse,
    InstallSnapshotResponse,
    InstallSnapshotRequest,
} from "../rpc/RPCTypes";
import { RaftState } from "../core/StateMachine";
import { ClusterConfig, ClusterMember } from "../config/ClusterConfig";

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
    commitIndex: number;
    snapshotIndex: number;
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
    | "AppendEntriesResponse"
    | "InstallSnapshotRequest"
    | "InstallSnapshotResponse";

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

export interface InstallSnapshotRequestEvent extends BaseMessageEvent {
    type: "MessageSent";
    messageType: "InstallSnapshotRequest";
    payload: InstallSnapshotRequest;
}

export interface InstallSnapshotResponseEvent extends BaseMessageEvent {
    type: "MessageReceived";
    messageType: "InstallSnapshotResponse";
    payload: InstallSnapshotResponse;
    latencyMs: number;
}

export type MessageSentEvent = RequestVoteSentEvent | AppendEntriesSentEvent | InstallSnapshotRequestEvent;
export type MessageReceivedEvent = RequestVoteReceivedEvent | AppendEntriesReceivedEvent | InstallSnapshotResponseEvent;

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
    groups: NodeId[][];
}

export interface PartitionHealedEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    type: "PartitionHealed";
}

export interface LinkCutEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    type: "LinkCut";
    nodeA: NodeId;
    nodeB: NodeId;
}

export interface LinkHealedEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    type: "LinkHealed";
    nodeA: NodeId;
    nodeB: NodeId;
}

export interface AllLinksHealedEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    type: "AllLinksHealed";
}

export interface SnapshotTakenEvent extends BaseEvent {
    type: "SnapshotTaken";
    lastIncludedIndex: number;
    lastIncludedTerm: number;
    snapshotSizeBytes: number;
}

export interface SnapshotInstalledEvent extends BaseEvent {
    type: "SnapshotInstalled";
    lastIncludedIndex: number;
    lastIncludedTerm: number;
    senderId: NodeId;
}

export interface ServerAddedEvent extends BaseEvent {
    type: "ServerAdded";
    addedNodeId: NodeId;
    asLearner: boolean;
    config: ClusterConfig;
}

export interface ServerRemovedEvent extends BaseEvent {
    type: "ServerRemoved";
    removedNodeId: NodeId;
    config: ClusterConfig;
}

export interface LearnerPromotedEvent extends BaseEvent {
    type: "LearnerPromoted";
    promotedNodeId: NodeId;
    config: ClusterConfig;
}

export interface ConfigChangedEvent extends BaseEvent {
    type: "ConfigChanged";
    voters: ClusterMember[];
    learners: ClusterMember[];
    commited: boolean;
}

export interface ConfigChangeRejectedEvent extends BaseEvent {
    type: "ConfigChangeRejected";
    voters: ClusterMember[];
    learners: ClusterMember[];
    reason: string;
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
    | PartitionHealedEvent
    | LinkCutEvent
    | LinkHealedEvent
    | AllLinksHealedEvent
    | SnapshotTakenEvent
    | SnapshotInstalledEvent
    | ServerAddedEvent
    | ServerRemovedEvent
    | LearnerPromotedEvent
    | ConfigChangedEvent
    | ConfigChangeRejectedEvent;

export interface RaftEventBus {
    emit(event: RaftEvent): void;
    subscribe(handler: (event: RaftEvent) => void): () => void;
}

export interface InitialStateMessage {
    type: "InitialState";
    events: RaftEvent[];
    nodeIds: NodeId[];
    config?: ClusterConfig;
}

export interface LiveEventMessage {
    type: "LiveEvent";
    event: RaftEvent;
}

export type ServerMessage = InitialStateMessage | LiveEventMessage;

export interface SubmitCommandMessage {
    type: "SubmitCommand";
    command: Command;
}

export interface CrashNodeMessage {
    type: "CrashNode";
    nodeId: NodeId;
}

export interface RecoverNodeMessage {
    type: "RecoverNode";
    nodeId: NodeId;
}

export interface PartitionNodesMessage {
    type: "PartitionNodes";
    groups: NodeId[][];
}

export interface HealPartitionMessage {
    type: "HealPartition";
}

export interface SetDropRateMessage {
    type: "SetDropRate";
    nodeId: NodeId;
    dropRate: number;
}

export interface CutLinkMessage {
    type: "CutLink";
    nodeA: NodeId;
    nodeB: NodeId;
}

export interface HealLinkMessage {
    type: "HealLink";
    nodeA: NodeId;
    nodeB: NodeId;
}

export interface HealAllLinksMessage {
    type: "HealAllLinks";
}

export interface AddServerMessage {
    type: "AddServer";
    nodeId: NodeId;
    address: string;
    asLearner: boolean;
}

export interface RemoveServerMessage {
    type: "RemoveServer";
    nodeId: NodeId;
}

export interface PromoteLearnerMessage {
    type: "PromoteLearner";
    nodeId: NodeId;
}

export type ClientMessage =
    | SubmitCommandMessage
    | CrashNodeMessage
    | RecoverNodeMessage
    | PartitionNodesMessage
    | HealPartitionMessage
    | SetDropRateMessage
    | CutLinkMessage
    | HealLinkMessage
    | HealAllLinksMessage
    | AddServerMessage
    | RemoveServerMessage
    | PromoteLearnerMessage;