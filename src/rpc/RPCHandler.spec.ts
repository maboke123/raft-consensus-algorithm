import { describe, it, expect, beforeEach, vi } from "vitest";
import { RPCHandler } from "./RPCHandler";
import { RPCMessage } from "./RPCTypes";
import { RPCHandlerError, NetworkError } from "../util/Error";
import { MockTransport } from "../transport/MockTransport";
import { Logger } from "../util/Logger";
import { Clock } from "../timing/Clock";
import { SeededRandom } from "../util/Random";

describe('RPCHandler.ts, RPCHandler', () => {

    const nodeId = 'node1';
    const peerId = 'node2';

    let transport: { send: ReturnType<typeof vi.fn>};
    let logger: { debug: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn> };
    let clock: { setTimeout: ReturnType<typeof vi.fn>, clearTimeout: ReturnType<typeof vi.fn> };
    let rpcHandler: RPCHandler;

    const requestVoteRequest = {
        term: 1,
        candidateId: nodeId,
        lastLogIndex: 0,
        lastLogTerm: 0
    };

    const requestVoteResponse = {
        term: 1,
        voteGranted: true
    };

    const appendEntriesRequest = {
        term: 1,
        leaderId: nodeId,
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0
    };

    const appendEntriesResponse = {
        term: 1,
        success: true
    };

    const installSnapshotRequest = {
        term: 1,
        leaderId: nodeId,
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from('snapshot data'),
    };

    const installSnapshotResponse = {
        term: 1,
        success: true
    };

    beforeEach(() => {
        transport = {
            send: vi.fn()
        };
        logger = {
            debug: vi.fn(),
            error: vi.fn(),
            warn: vi.fn()
        };
        clock = {
            setTimeout: vi.fn(),
            clearTimeout: vi.fn()
        };
        rpcHandler = new RPCHandler(nodeId, transport as any, logger as any, clock as any);
    });

    it('should send RequestVote and receive valid response', async () => {
        const responseMessage: RPCMessage = {
            type: "RequestVote",
            direction: 'response',
            payload: requestVoteResponse
        };

        transport.send.mockResolvedValue(responseMessage);

        const response = await rpcHandler.sendRequestVote(peerId, requestVoteRequest);

        expect(response).toEqual(requestVoteResponse);
        expect(transport.send).toHaveBeenCalledWith(peerId, expect.objectContaining({
            type: "RequestVote",
            direction: 'request',
            payload: requestVoteRequest
        }));
        expect(logger.debug).toHaveBeenCalledTimes(2);
    });

    it('should throw if response type is invalid for RequestVote', async () => {
        const invalidResponseMessage: RPCMessage = {
            type: "AppendEntries",
            direction: 'response',
            payload: appendEntriesResponse
        };

        transport.send.mockResolvedValue(invalidResponseMessage);

        await expect(rpcHandler.sendRequestVote(peerId, requestVoteRequest)).rejects.toThrow(RPCHandlerError);
    });

    it('should send AppendEntries and receive valid response', async () => {
        const responseMessage: RPCMessage = {
            type: "AppendEntries",
            direction: 'response',
            payload: appendEntriesResponse
        };

        transport.send.mockResolvedValue(responseMessage);

        const response = await rpcHandler.sendAppendEntries(peerId, appendEntriesRequest);
        expect(response).toEqual(appendEntriesResponse);
        expect(transport.send).toHaveBeenCalledWith(peerId, expect.objectContaining({
            type: "AppendEntries",
            direction: 'request',
            payload: appendEntriesRequest
        }));
        expect(logger.debug).toHaveBeenCalledTimes(2);
    });

    it('should throw if response type is invalid for AppendEntries', async () => {
        const invalidResponseMessage: RPCMessage = {
            type: "RequestVote",
            direction: 'response',
            payload: requestVoteResponse
        };

        transport.send.mockResolvedValue(invalidResponseMessage);

        await expect(rpcHandler.sendAppendEntries(peerId, appendEntriesRequest)).rejects.toThrow(RPCHandlerError);
    });

    it('should send InstallSnapshot and receive valid response', async () => {
        const responseMessage: RPCMessage = {
            type: "InstallSnapshot",
            direction: 'response',
            payload: installSnapshotResponse
        };

        transport.send.mockResolvedValue(responseMessage);

        const response = await rpcHandler.sendInstallSnapshot(peerId, installSnapshotRequest);

        expect(response).toEqual(installSnapshotResponse);
        expect(transport.send).toHaveBeenCalledWith(peerId, expect.objectContaining({
            type: "InstallSnapshot",
            direction: 'request',
            payload: installSnapshotRequest
        }));
        expect(logger.debug).toHaveBeenCalledTimes(2);
    });

    it('should throw if response type is invalid for InstallSnapshot', async () => {
        const invalidResponseMessage: RPCMessage = {
            type: "AppendEntries",
            direction: 'response',
            payload: appendEntriesResponse
        };

        transport.send.mockResolvedValue(invalidResponseMessage);

        await expect(rpcHandler.sendInstallSnapshot(peerId, installSnapshotRequest)).rejects.toThrow(RPCHandlerError);
    });

    it('should throw if RPC times out', async () => {
        transport.send.mockReturnValue(new Promise(() => {}));

        clock.setTimeout.mockImplementation((fn: () => void) => {
            fn();
            return 1;
        });

        await expect(rpcHandler.sendRequestVote(peerId, requestVoteRequest, { timeoutMs: 100 })).rejects.toThrow(RPCHandlerError);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('should throw if transport.send throws a NetworkError', async () => {
        transport.send.mockRejectedValue(new NetworkError('Network failure'));

        await expect(rpcHandler.sendRequestVote(peerId, requestVoteRequest)).rejects.toThrow(NetworkError);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('should throw if transport.send throws an unexpected error', async () => {
        transport.send.mockRejectedValue(new Error('Unexpected failure'));

        await expect(rpcHandler.sendRequestVote(peerId, requestVoteRequest)).rejects.toThrow(Error);
        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('should use default timeout if not specified', async () => {
        transport.send.mockReturnValue(new Promise(() => {}));

        clock.setTimeout.mockImplementation((fn: () => void) => {
            fn();
            return 1;
        });

        await expect(rpcHandler.sendRequestVote(peerId, requestVoteRequest)).rejects.toThrow(RPCHandlerError);
        expect(clock.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);
    });

    it('should handle incoming requestVote requests and send valid responses', async () => {
        const handler = {
            onRequestVote: vi.fn().mockResolvedValue(requestVoteResponse),
            onAppendEntries: vi.fn(),
            onInstallSnapshot: vi.fn()
        }

        const requestMessage: RPCMessage = {
            type: "RequestVote",
            direction: 'request',
            payload: requestVoteRequest
        };

        const responseMessage = await rpcHandler.handleIncomingMessage(peerId, requestMessage, handler);

        expect(handler.onRequestVote).toHaveBeenCalledWith(peerId, requestVoteRequest);
        expect(responseMessage).toEqual({
            type: "RequestVote",
            direction: 'response',
            payload: requestVoteResponse
        });
    });

    it('should handle incoming appendEntries requests and send valid responses', async () => {
        const handler = {
            onRequestVote: vi.fn(),
            onAppendEntries: vi.fn().mockResolvedValue(appendEntriesResponse),
            onInstallSnapshot: vi.fn()
        }

        const requestMessage: RPCMessage = {
            type: "AppendEntries",
            direction: 'request',
            payload: appendEntriesRequest
        };

        const responseMessage = await rpcHandler.handleIncomingMessage(peerId, requestMessage, handler);

        expect(handler.onAppendEntries).toHaveBeenCalledWith(peerId, appendEntriesRequest);
        expect(responseMessage).toEqual({
            type: "AppendEntries",
            direction: 'response',
            payload: appendEntriesResponse
        });
    });

    it('should handle incoming installSnapshot requests and send valid responses', async () => {
        const handler = {
            onRequestVote: vi.fn(),
            onAppendEntries: vi.fn(),
            onInstallSnapshot: vi.fn().mockResolvedValue(installSnapshotResponse)
        }

        const requestMessage: RPCMessage = {
            type: "InstallSnapshot",
            direction: 'request',
            payload: installSnapshotRequest
        };

        const responseMessage = await rpcHandler.handleIncomingMessage(peerId, requestMessage, handler);

        expect(handler.onInstallSnapshot).toHaveBeenCalledWith(peerId, installSnapshotRequest);
        expect(responseMessage).toEqual({
            type: "InstallSnapshot",
            direction: 'response',
            payload: installSnapshotResponse
        });
    });

    it('should throw if incoming message type is unknown', async () => {
        const handler = {
            onRequestVote: vi.fn(),
            onAppendEntries: vi.fn(),
            onInstallSnapshot: vi.fn()
        }

        const requestMessage: RPCMessage = {
            type: "UnknownType" as any,
            direction: 'request',
            payload: {} as any
        };

        await expect(rpcHandler.handleIncomingMessage(peerId, requestMessage, handler)).rejects.toThrow(RPCHandlerError);
    });

    it('should emit MessageDropped with reason "peer down" when sendAppendEntries throws NetworkError', async () => {
        const eventBus = { emit: vi.fn() };
        const handler = new RPCHandler(nodeId, transport as any, logger as any, clock as any, eventBus as any);

        transport.send.mockRejectedValue(new NetworkError('connection refused'));

        await expect(handler.sendAppendEntries(peerId, appendEntriesRequest)).rejects.toThrow(NetworkError);

        expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
            type: "MessageDropped",
            reason: "peer down"
        }));
    });

    it('should emit MessageDropped with reason "peer down" when sendInstallSnapshot throws NetworkError', async () => {
        const eventBus = { emit: vi.fn() };
        const handler = new RPCHandler(nodeId, transport as any, logger as any, clock as any, eventBus as any);

        transport.send.mockRejectedValue(new NetworkError('connection refused'));

        await expect(handler.sendInstallSnapshot(peerId, installSnapshotRequest)).rejects.toThrow(NetworkError);

        expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
            type: "MessageDropped",
            reason: "peer down"
        }));
    });

});

