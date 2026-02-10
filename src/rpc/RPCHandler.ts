import { NodeId } from "../core/Config";
import { RequestVoteRequest, RequestVoteResponse, AppendEntriesRequest, AppendEntriesResponse } from "./RPCTypes";

export interface RPCSendOptions {
    timeoutMs?: number;
}

export interface RPCHandlerInterface {
    sendRequestVote(peerId: NodeId, request: RequestVoteRequest, options?: RPCSendOptions): Promise<RequestVoteResponse>;
    sendAppendEntries(peerId: NodeId, request: AppendEntriesRequest, options?: RPCSendOptions): Promise<AppendEntriesResponse>;
}