export type RaftRole = 'Leader' | 'Follower' | 'Candidate';

export interface LogEntry {
    index: number;
    term: number;
    command: unknown;
}

export interface ClusterConfig {
    voters: string[];
    learners: string[];
}

interface BaseEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    nodeId: string;
}

export interface NodeStateChangedEvent extends BaseEvent {
    type: "NodeStateChanged";
    oldState: RaftRole;
    newState: RaftRole;
    term: number
}

export interface TermChangedEvent extends BaseEvent {
    type: "TermChanged";
    oldTerm: number;
    newTerm: number;
    reason: string;
}

export interface CommitIndexAdvanceEvent extends BaseEvent {
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
    voterId: string;
    candidateId: string;
}

export interface VoteDeniedEvent extends BaseEvent {
    type: "VoteDenied";
    term: number;
    voterId: string;
    candidateId: string;
    reason: string;
}

export interface LeaderElectedEvent extends BaseEvent {
    type: "LeaderElected";
    term: number;
    leaderId: string;
    voteCount: number;
    clusterSize: number;
}

export interface MatchIndexUpdatedEvent extends BaseEvent {
    type: "MatchIndexUpdated";
    followerId: string;
    prevMatchIndex: number;
    newMatchIndex: number;
    term: number;
}

export interface NextIndexDecrementedEvent extends BaseEvent {
    type: "NextIndexDecremented";
    followerId: string;
    prevNextIndex: number;
    newNextIndex: number;
    term: number;
}

export interface MessageSentEvent extends BaseEvent {
    type: "MessageSent";
    messageType: "RequestVote" | "AppendEntries" | "InstallSnapshotRequest";
    messageId: string;
    fromNodeId: string;
    toNodeId: string;
    term: number;
    payload: unknown;
}

export interface MessageReceivedEvent extends BaseEvent {
    type: "MessageReceived";
    messageType: "RequestVoteResponse" | "AppendEntriesResponse" | "InstallSnapshotResponse";
    messageId: string;
    fromNodeId: string;
    toNodeId: string;
    term: number;
    payload: unknown;
    latencyMs:number;
}

export interface MessageDroppedEvent extends BaseEvent {
    type: "MessageDropped";
    messageType: string;
    messageId: string;
    fromNodeId: string;
    toNodeId: string;
    term: number;
    reason:string;
}

export interface PartitionCreatedEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    type: "PartitionCreated";
    groups: string[][];
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
    nodeA: string;
    nodeB: string;
}

export interface LinkHealedEvent {
    eventId: string;
    timestamp: number;
    wallTime: number;
    type: "LinkHealed";
    nodeA: string;
    nodeB: string;
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
    senderId: string;
}

export interface ServerAddedEvent extends BaseEvent {
    type: "ServerAdded";
    addedNodeId: string;
    asLearner: boolean;
    config: ClusterConfig;
}

export interface ServerRemovedEvent extends BaseEvent {
    type: "ServerRemoved";
    removedNodeId: string;
    config: ClusterConfig;
}

export interface LearnerPromotedEvent extends BaseEvent {
    type: "LearnerPromoted";
    promotedNodeId: string;
    config: ClusterConfig;
}

export interface ConfigChangedEvent extends BaseEvent {
    type: "ConfigChanged";
    voters: string[];
    learners: string[];
    commited: boolean;
}

export interface ConfigChangeRejectedEvent extends BaseEvent {
    type: "ConfigChangeRejected";
    voters: string[];
    learners: string[];
    reason: string;
}

export type RaftEvent = 
    | NodeStateChangedEvent
    | TermChangedEvent
    | CommitIndexAdvanceEvent
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

export interface InitialStateMessage {
    type: "InitialState";
    events: RaftEvent[];
    nodeIds: string[];
    config?: ClusterConfig;
}

export interface LiveEventMessage {
    type: "LiveEvent";
    event: RaftEvent;
}

export type ServerMessage = InitialStateMessage | LiveEventMessage

export type ClientCommand = 
    | { type: "SubmitCommand"; command: unknown}
    | { type: "CrashNode"; nodeId: string}
    | { type: "RecoverNode"; nodeId: string }
    | { type: "PartitionNodes"; groups: string[][] }
    | { type: "HealPartition"}
    | { type: "SetDropRate"; nodeId: string; dropRate: number }
    | { type: "CutLink"; nodeA: string; nodeB: string }
    | { type: "HealLink"; nodeA: string; nodeB: string }
    | { type: "HealAllLinks" }
    | { type: "AddServer"; nodeId: string; address: string; asLearner: boolean }
    | { type: "RemoveServer"; nodeId: string }
    | { type: "PromoteLearner"; nodeId: string }

export interface NodeUIState {
    nodeId: string;
    role: RaftRole;
    term: number;
    commitIndex: number;
    votedFor: string | null;
    crashed: boolean;
    logEntries: LogEntry[];
    snapshotIndex: number;
    isLearner: boolean;
}

export type ArrowStatus = "inFlight" | "received" | "dropped";

export interface MessageArrow {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    messageType: "RequestVote" | "AppendEntries" | "RequestVoteResponse" | "AppendEntriesResponse" | "InstallSnapshotRequest" | "InstallSnapshotResponse";
    status: ArrowStatus;
    createdAt: number;
    isHeartbeat: boolean;
}

export interface Partition {
    groups: string[][];
}

export interface NodePosition {
    x: number;
    y: number;
}