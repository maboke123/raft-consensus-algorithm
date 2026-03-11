import { NodeId } from "../core/Config";
import { LogEntry } from "../log/LogEntry";
import { ClusterConfig } from "../config/ClusterConfig";

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
    leaderId: NodeId;
    prevLogIndex: number;
    prevLogTerm: number;
    entries: LogEntry[]; // empty when sending heartbeat
    leaderCommit: number;
}

export interface AppendEntriesResponse {
    term: number;
    success: boolean;
    matchIndex?: number; // last three fields are optimization for leader upon failed append
    conflictIndex?: number;
    conflictTerm?: number;
}

export interface InstallSnapshotRequest {
    term: number;
    leaderId: NodeId;
    lastIncludedIndex: number;
    lastIncludedTerm: number;
    data: Buffer;
    config: ClusterConfig;
}

export interface InstallSnapshotResponse {
    term: number;
    success: boolean;
}

export type RPCRequest = RequestVoteRequest | AppendEntriesRequest | InstallSnapshotRequest;

export type RPCResponse = RequestVoteResponse | AppendEntriesResponse | InstallSnapshotResponse;

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

export interface InstallSnapshotRequestMessage {
    type: "InstallSnapshot";
    direction: "request";
    payload: InstallSnapshotRequest;
}

export interface InstallSnapshotResponseMessage {
    type: "InstallSnapshot";
    direction: "response";
    payload: InstallSnapshotResponse;
}

export type RPCMessage = 
    | RequestVoteRequestMessage
    | RequestVoteResponseMessage
    | AppendEntriesRequestMessage
    | AppendEntriesResponseMessage
    | InstallSnapshotRequestMessage
    | InstallSnapshotResponseMessage;

export function isRequestVoteRequestMessage(message: RPCMessage): message is RequestVoteRequestMessage {
    return message.type === "RequestVote" && message.direction === "request";
}

export function isRequestVoteResponseMessage(message: RPCMessage): message is RequestVoteResponseMessage {
    return message.type === "RequestVote" && message.direction === "response";
}

export function isAppendEntriesRequestMessage(message: RPCMessage): message is AppendEntriesRequestMessage {
    return message.type === "AppendEntries" && message.direction === "request";
}

export function isAppendEntriesResponseMessage(message: RPCMessage): message is AppendEntriesResponseMessage {
    return message.type === "AppendEntries" && message.direction === "response";
}

export function isInstallSnapshotRequestMessage(message: RPCMessage): message is InstallSnapshotRequestMessage {
    return message.type === "InstallSnapshot" && message.direction === "request";
}

export function isInstallSnapshotResponseMessage(message: RPCMessage): message is InstallSnapshotResponseMessage {
    return message.type === "InstallSnapshot" && message.direction === "response";
}

export function validateRequestVoteRequest(request: RequestVoteRequest): void {
    if (!Number.isInteger(request.term) || request.term < 0) {
        throw new Error(`Invalid term: ${request.term}. term must be a non-negative integer.`);
    }

    if (!request.candidateId || typeof request.candidateId !== 'string') {
        throw new Error(`Invalid candidateId: ${request.candidateId}. candidateId must be a non-empty string.`);
    }

    if (!Number.isInteger(request.lastLogIndex) || request.lastLogIndex < 0) {
        throw new Error(`Invalid lastLogIndex: ${request.lastLogIndex}. lastLogIndex must be a non-negative integer.`);
    }

    if (!Number.isInteger(request.lastLogTerm) || request.lastLogTerm < 0) {
        throw new Error(`Invalid lastLogTerm: ${request.lastLogTerm}. lastLogTerm must be a non-negative integer.`);
    }
}

export function validateRequestVoteResponse(response: RequestVoteResponse): void {
    if (!Number.isInteger(response.term) || response.term < 0) {
        throw new Error(`Invalid term: ${response.term}. term must be a non-negative integer.`);
    }

    if (typeof response.voteGranted !== 'boolean') {
        throw new Error(`Invalid voteGranted: ${response.voteGranted}. voteGranted must be a boolean.`);
    }
}

export function validateAppendEntriesRequest(request: AppendEntriesRequest): void {
    if (!Number.isInteger(request.term) || request.term < 0) {
        throw new Error(`Invalid term: ${request.term}. term must be a non-negative integer.`);
    }

    if (!request.leaderId || typeof request.leaderId !== 'string') {
        throw new Error(`Invalid leaderId: ${request.leaderId}. leaderId must be a non-empty string.`);
    }

    if (!Number.isInteger(request.prevLogIndex) || request.prevLogIndex < 0) {
        throw new Error(`Invalid prevLogIndex: ${request.prevLogIndex}. prevLogIndex must be a non-negative integer.`);
    }

    if (!Number.isInteger(request.prevLogTerm) || request.prevLogTerm < 0) {
        throw new Error(`Invalid prevLogTerm: ${request.prevLogTerm}. prevLogTerm must be a non-negative integer.`);
    }

    if (!Number.isInteger(request.leaderCommit) || request.leaderCommit < 0) {
        throw new Error(`Invalid leaderCommit: ${request.leaderCommit}. leaderCommit must be a non-negative integer.`);
    }

    if (!Array.isArray(request.entries) || request.entries.some(entry => typeof entry !== 'object')) {
        throw new Error(`Invalid entries: ${request.entries}. entries must be an array of LogEntry objects.`);
    }
}

export function validateAppendEntriesResponse(response: AppendEntriesResponse): void {
    if (!Number.isInteger(response.term) || response.term < 0) {
        throw new Error(`Invalid term: ${response.term}. term must be a non-negative integer.`);
    }

    if (typeof response.success !== 'boolean') {
        throw new Error(`Invalid success: ${response.success}. success must be a boolean.`);
    }

    if (response.matchIndex !== undefined && (!Number.isInteger(response.matchIndex) || response.matchIndex < 0)) {
        throw new Error(`Invalid matchIndex: ${response.matchIndex}. matchIndex must be a non-negative integer.`);
    }

    if (response.conflictIndex !== undefined && (!Number.isInteger(response.conflictIndex) || response.conflictIndex < 0)) {
        throw new Error(`Invalid conflictIndex: ${response.conflictIndex}. conflictIndex must be a non-negative integer.`);
    }

    if (response.conflictTerm !== undefined && (!Number.isInteger(response.conflictTerm) || response.conflictTerm < 0)) {
        throw new Error(`Invalid conflictTerm: ${response.conflictTerm}. conflictTerm must be a non-negative integer.`);
    }
}

export function validateInstallSnapshotRequest(request: InstallSnapshotRequest): void {
    if (!Number.isInteger(request.term) || request.term < 0) {
        throw new Error(`Invalid term: ${request.term}. term must be a non-negative integer.`);
    }

    if (!request.leaderId || typeof request.leaderId !== 'string') {
        throw new Error(`Invalid leaderId: ${request.leaderId}. leaderId must be a non-empty string.`);
    }

    if (!Number.isInteger(request.lastIncludedIndex) || request.lastIncludedIndex < 0) {
        throw new Error(`Invalid lastIncludedIndex: ${request.lastIncludedIndex}. lastIncludedIndex must be a non-negative integer.`);
    }

    if (!Number.isInteger(request.lastIncludedTerm) || request.lastIncludedTerm < 0) {
        throw new Error(`Invalid lastIncludedTerm: ${request.lastIncludedTerm}. lastIncludedTerm must be a non-negative integer.`);
    }

    if (!Buffer.isBuffer(request.data)) {
        throw new Error(`Invalid data: ${request.data}. data must be a Buffer.`);
    }

    if (!request.config || typeof request.config !== 'object') {
        throw new Error(`Invalid config: ${request.config}. config must be an object.`);
    }

    if (!Array.isArray(request.config.voters) || !Array.isArray(request.config.learners)) {
        throw new Error(`Invalid config: ${request.config}. voters and learners must be arrays.`);
    }

    if (request.config.voters.some((m: any) => typeof m.id !== 'string' || typeof m.address !== 'string')) {
        throw new Error(`Invalid config: voters must be ClusterMember objects with id and address strings.`);
    }

    if (request.config.learners.some((m: any) => typeof m.id !== 'string' || typeof m.address !== 'string')) {
        throw new Error(`Invalid config: learners must be ClusterMember objects with id and address strings.`);
    }
}

export function validateInstallSnapshotResponse(response: InstallSnapshotResponse): void {
    if (!Number.isInteger(response.term) || response.term < 0) {
        throw new Error(`Invalid term: ${response.term}. term must be a non-negative integer.`);
    }

    if (typeof response.success !== 'boolean') {
        throw new Error(`Invalid success: ${response.success}. success must be a boolean.`);
    }
}

export function validateRPCMessage(message: RPCMessage): void {
    switch (message.type) {
        case "RequestVote":
            if (message.direction === "request") {
                validateRequestVoteRequest(message.payload);
            } else {
                validateRequestVoteResponse(message.payload);
            }
            break;
        case "AppendEntries":
            if (message.direction === "request") {
                validateAppendEntriesRequest(message.payload);
            } else {
                validateAppendEntriesResponse(message.payload);
            }
            break;
        case "InstallSnapshot":
            if (message.direction === "request") {
                validateInstallSnapshotRequest(message.payload);
            } else {
                validateInstallSnapshotResponse(message.payload);
            }
            break;
        default:
            throw new Error('Unknown RPC message type.');
    }
}

