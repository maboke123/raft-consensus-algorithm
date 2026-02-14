import { NodeId } from "../core/Config";
import { RequestVoteRequest,
         RequestVoteResponse,
         AppendEntriesRequest,
         AppendEntriesResponse,
         isRequestVoteRequestMessage,
         isRequestVoteResponseMessage,
         isAppendEntriesRequestMessage,
         isAppendEntriesResponseMessage,
         validateRPCMessage,
         RPCMessage
        } from "./RPCTypes";
import { Transport } from "../transport/Transport";
import { Logger } from "../util/Logger";
import { Clock, TimerHandle } from "../timing/Clock";
import { RPCHandlerError, NetworkError } from "../util/Error";

export interface RPCSendOptions {
    timeoutMs?: number;
}

export interface RPCHandlerInterface {
    sendRequestVote(peerId: NodeId, request: RequestVoteRequest, options?: RPCSendOptions): Promise<RequestVoteResponse>;
    sendAppendEntries(peerId: NodeId, request: AppendEntriesRequest, options?: RPCSendOptions): Promise<AppendEntriesResponse>;
}

export class RPCHandler implements RPCHandlerInterface {

    private static readonly default_timeout_ms = 1000;

    constructor(
        private nodeId: NodeId,
        private transport: Transport,
        private logger: Logger,
        private clock: Clock
    ) {}

    async sendRequestVote(peerId: NodeId, request: RequestVoteRequest, options?: RPCSendOptions): Promise<RequestVoteResponse> {

        const message: RPCMessage = {
            type: "RequestVote",
            direction: 'request',
            payload: request
        };

        validateRPCMessage(message);

        this.logger.debug(`Node ${this.nodeId} sending RequestVote to ${peerId}: ${JSON.stringify(request)}`);

        const response = await this.sendWithTimeout(peerId, message, options);

        if (!isRequestVoteResponseMessage(response)) {
            throw new RPCHandlerError(`Invalid response type for RequestVote: expected RequestVoteResponse, got ${response.type}`);
        };

        this.logger.debug(`Node ${this.nodeId} received RequestVoteResponse from ${peerId}: ${JSON.stringify(response.payload)}`);

        return response.payload;
    }

    async sendAppendEntries(peerId: NodeId, request: AppendEntriesRequest, options?: RPCSendOptions): Promise<AppendEntriesResponse> {

        const message: RPCMessage = {
            type: "AppendEntries",
            direction: 'request',
            payload: request
        };

        validateRPCMessage(message);

        this.logger.debug(`Node ${this.nodeId} sending AppendEntries to ${peerId}: ${JSON.stringify(request)}`);

        const response = await this.sendWithTimeout(peerId, message, options);

        if (!isAppendEntriesResponseMessage(response)) {
            throw new RPCHandlerError(`Invalid response type for AppendEntries: expected AppendEntriesResponse, got ${response.type}`);
        }

        this.logger.debug(`Node ${this.nodeId} received AppendEntriesResponse from ${peerId}: ${JSON.stringify(response.payload)}`);

        return response.payload;
    }

    private async sendWithTimeout(peerId: NodeId, message: RPCMessage, options?: RPCSendOptions): Promise<RPCMessage> {

        const timeoutMs = options?.timeoutMs ?? RPCHandler.default_timeout_ms;
        let timeoutHandle: TimerHandle | null = null;

        const timeoutPromise: Promise<RPCMessage> = new Promise((_resolve, reject) => {
            timeoutHandle = this.clock.setTimeout(() => {
                reject(new RPCHandlerError(`RPC to ${peerId} timed out after ${timeoutMs} ms`));
            }, timeoutMs);
        });

        try {

            const result = await Promise.race<RPCMessage>([
                this.transport.send(peerId, message),
                timeoutPromise
            ]);

            if (timeoutHandle !== null) {
                this.clock.clearTimeout(timeoutHandle);
            }

            return result;

        } catch (error) {

            if (timeoutHandle !== null) {
                this.clock.clearTimeout(timeoutHandle);
            }

            if (error instanceof RPCHandlerError) {
                this.logger.warn('RPC timeout', { to: peerId, messageType: message.type, timeoutMs });
            } else if (error instanceof NetworkError) {
                this.logger.warn('Network error during RPC', { to: peerId, messageType: message.type, error });
            } else {
                this.logger.error('Unexpected error during RPC', { to: peerId, messageType: message.type, error });
            }
            throw error;
        }
    }

    async handleIncomingMessage(from: NodeId, message: RPCMessage, handler: { onRequestVote: (from: NodeId, request: RequestVoteRequest) => Promise<RequestVoteResponse>, onAppendEntries: (from: NodeId, request: AppendEntriesRequest) => Promise<AppendEntriesResponse> }): Promise<RPCMessage> {

        this.logger.debug(`Node ${this.nodeId} received message from ${from}: ${JSON.stringify(message)}`);

        if (isRequestVoteRequestMessage(message)) {
            const responsePayload = await handler.onRequestVote(from, message.payload);
            return {
                type: "RequestVote",
                direction: 'response',
                payload: responsePayload
            };
        } else if (isAppendEntriesRequestMessage(message)) {
            const responsePayload = await handler.onAppendEntries(from, message.payload);
            return {
                type: "AppendEntries",
                direction: 'response',
                payload: responsePayload
            };
        } else {
            throw new RPCHandlerError(`Invalid RPC message type: ${message.type}`);
        }
    }
}
