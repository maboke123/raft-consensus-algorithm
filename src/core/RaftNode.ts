import { NodeId } from "./Config";
import { Command, LogEntry } from "../log/LogEntry";
import { RaftState } from "./StateMachine";

export interface CommandResult {
    success: boolean;
    index?: number;
    leaderId?: NodeId;
    error?: string;
}

export interface ApplicationStateMachine {
    apply(command: Command): Promise<any>;
    getState(): any;
}

export interface RaftNodeInterface {
    start(): Promise<void>;
    stop(): Promise<void>;
    submitCommand(command: Command): Promise<CommandResult>;
    getState(): RaftState;
    isLeader(): boolean;
    getLeaderId(): NodeId | null;
    getCurrentTerm(): number;
    getCommittedIndex(): number;
    getLastApplied(): number;
    getLastLogIndex(): number;
    getNodeId(): NodeId;
    getApplicationState(): any;
    isStarted(): boolean;
    getEntries(startIndex: number, endIndex: number): Promise<LogEntry[]>;
}