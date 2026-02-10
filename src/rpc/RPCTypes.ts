import { NodeId } from "../core/Config";
import { LogEntry } from "../log/LogEntry";

export interface RequestVoteRequest {
    term: number;
    candidateId: NodeId;
    lastLogIndex: number;
    lastLogTerm: number;
}

export interface RequestVoteResponse {
    term: number;
    voteGranted: boolean;
}

export interface AppendEntriesRequest {
    term: number;
    leaderId: NonDocumentTypeChildNode;
    prevLogIndex: number;
    prevLogTerm: number;
    entries: LogEntry[];
    leaderCommit: number;
}

export interface AppendEntriesResponse {
    term: number;
    succes: boolean;
    matchIndex?: number;
    conflictIndex?: number;
    conflictTerm?: number;
}

export type RPCRequest = RequestVoteRequest | AppendEntriesRequest;

export type RPCResponse = RequestVoteResponse | AppendEntriesResponse;

export interface RequestVoteRequestMessage {
    type: "RequestVote";
    direction: "request";
    payload: RequestVoteRequest;
}

export interface RequestVoteResponseMessage {
    type: "RequestVote";
    direction: "response";
    payload: RequestVoteResponse;
}

export interface AppendEntriesRequestMessage {
    type: "AppendEntries";
    direction: "request";
    payload: AppendEntriesRequest;
}

export interface AppendEntriesResponseMessage {
    type: "AppendEntries";
    direction: "response";
    payload: AppendEntriesResponse;
}

export type RPCMessage = 
    | RequestVoteRequestMessage
    | RequestVoteResponseMessage
    | AppendEntriesRequestMessage
    | AppendEntriesResponseMessage;
