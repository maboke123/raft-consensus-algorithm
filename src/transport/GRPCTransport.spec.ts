import { describe, expect, it, vi } from "vitest";
import { RPCMessage } from "../rpc/RPCTypes";
import { GrpcTransport, rpcMessageToGrpc, grpcToRpcMessage, serializeAppendEntriesResponse } from "./GRPCTransport";
import { LogEntry, LogEntryType } from "../log/LogEntry";
import { NetworkError } from "../util/Error";
import path from "path";

let portCounter = 52000 + Math.floor(Math.random() * 5000);

function nextPort() {
    return portCounter++;
}

function makePair() {
    const portA = nextPort();
    const portB = nextPort();
    const transportA = new GrpcTransport("nodeA", portA, { nodeB: `localhost:${portB}` });
    const transportB = new GrpcTransport("nodeB", portB, { nodeA: `localhost:${portA}` });
    return { transportA, transportB };
}

const requestVoteRequest: RPCMessage = {
    type: "RequestVote",
    direction: "request",
    payload: {
        term: 1,
        candidateId: "nodeA",
        lastLogIndex: 0,
        lastLogTerm: 0
    }
};

const requestVoteResponse: RPCMessage = {
    type: "RequestVote",
    direction: "response",
    payload: {
        term: 1,
        voteGranted: true
    }
};

const appendEntriesRequest: RPCMessage = {
    type: "AppendEntries",
    direction: "request",
    payload: {
        term: 1,
        leaderId: "nodeA",
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0
    }
};

const appendEntriesResponse: RPCMessage = {
    type: "AppendEntries",
    direction: "response",
    payload: {
        term: 1,
        success: true
    }
};

const installSnapshotRequest: RPCMessage = {
    type: "InstallSnapshot",
    direction: "request",
    payload: {
        term: 1,
        leaderId: "nodeA",
        lastIncludedIndex: 0,
        lastIncludedTerm: 0,
        data: Buffer.from("snapshot data"),
        config: { voters: [
            { id: "node1", address: "localhost:9090" },
            { id: "node2", address: "localhost:9091"}
        ], learners: [] }
    }
};

const installSnapshotResponse: RPCMessage = {
    type: "InstallSnapshot",
    direction: "response",
    payload: {
        term: 1,
        success: true
    }
};

describe('GRPCTransport.ts, rpcMessageToGrpc', () => {
    it('should map a request vote request correctly', () => {
        const result = rpcMessageToGrpc(requestVoteRequest);
        expect(result.method).toBe("RequestVote");
        expect(result.payload).toEqual(requestVoteRequest.payload);
    });

    it('should preserve preVote in request vote request payload', () => {
        const preVoteRequest: RPCMessage = {
            type: "RequestVote",
            direction: "request",
            payload: {
                term: 2,
                candidateId: "nodeA",
                lastLogIndex: 3,
                lastLogTerm: 2,
                preVote: true
            }
        };

        const result = rpcMessageToGrpc(preVoteRequest);
        expect(result.method).toBe("RequestVote");
        expect(result.payload).toEqual(preVoteRequest.payload);
    });

    it('should map an append entries request correctly', () => {
        const result = rpcMessageToGrpc(appendEntriesRequest);
        expect(result.method).toBe("AppendEntries");
        expect((result.payload as any).entries).toEqual([]);
    });

    it('should serialize log entry payloads correctly', () => {
        const logEntry: LogEntry = { term: 1, index: 1, type: LogEntryType.COMMAND, command: { type: "set", payload: { key: "x", value: 42 } } };
        const message: RPCMessage = {
            type: "AppendEntries",
            direction: "request",
            payload: {
                term: 1,
                leaderId: "nodeA",
                prevLogIndex: 0,
                prevLogTerm: 0,
                entries: [logEntry],
                leaderCommit: 0
            }
        };

        const { method, payload } = rpcMessageToGrpc(message);
        const entries = (payload as any).entries;
        expect(method).toBe("AppendEntries");
        expect(entries).toHaveLength(1);
        expect(entries[0].term).toBe(1);
        expect(entries[0].index).toBe(1);
        expect(Buffer.isBuffer(entries[0].command.payload)).toBe(true);
        expect(JSON.parse(entries[0].command.payload.toString())).toEqual({ key: "x", value: 42 });
    });

    it('should serialize multiple log entries correctly', () => {
        const logEntries: LogEntry[] = [
            { term: 1, index: 1, type: LogEntryType.COMMAND, command: { type: "set", payload: { key: "x", value: 42 } } },
            { term: 1, index: 2, type: LogEntryType.COMMAND, command: { type: "set", payload: { key: "y", value: 43 } } }
        ];
        const message: RPCMessage = {
            type: "AppendEntries",
            direction: "request",
            payload: {
                term: 1,
                leaderId: "nodeA",
                prevLogIndex: 0,
                prevLogTerm: 0,
                entries: logEntries,
                leaderCommit: 0
            }
        };
        const { method, payload } = rpcMessageToGrpc(message);
        const entries = (payload as any).entries;
        expect(method).toBe("AppendEntries");
        expect(entries).toHaveLength(2);
        expect(entries[0].term).toBe(1);
        expect(entries[0].index).toBe(1);
        expect(Buffer.isBuffer(entries[0].command.payload)).toBe(true);
        expect(JSON.parse(entries[0].command.payload.toString())).toEqual({ key: "x", value: 42 });
        expect(entries[1].term).toBe(1);
        expect(entries[1].index).toBe(2);
        expect(Buffer.isBuffer(entries[1].command.payload)).toBe(true);
        expect(JSON.parse(entries[1].command.payload.toString())).toEqual({ key: "y", value: 43 });
    });

    it('should preserve all appendentries fields', () => {
        const message: RPCMessage = {
            type: "AppendEntries",
            direction: "request",
            payload: {
                term: 2,
                leaderId: "nodeA",
                prevLogIndex: 5,
                prevLogTerm: 2,
                entries: [],
                leaderCommit: 4
            }
        };
        const { method, payload } = rpcMessageToGrpc(message);
        expect(method).toBe("AppendEntries");
        expect(payload).toEqual(message.payload);
    });

    it('throws NetworkError for a requestVote response', () => {
        const invalidMessage: RPCMessage = {
            type: "RequestVote",
            direction: "response",
            payload: {
                term: 1,
                voteGranted: true
            }
        };
        expect(() => rpcMessageToGrpc(invalidMessage)).toThrowError("Unsupported message type or direction: RequestVote response");
    });

    it('throws NetworkError for an appendEntries response', () => {
        const invalidMessage: RPCMessage = {
            type: "AppendEntries",
            direction: "response",
            payload: {
                term: 1,
                success: true
            }
        };
        expect(() => rpcMessageToGrpc(invalidMessage)).toThrowError("Unsupported message type or direction: AppendEntries response");
    });

    it('throws NetworkError for an unsupported message type', () => {
        const invalidMessage: any = {
            type: "UnknownType",
            direction: "request",
            payload: {}
        };
        expect(() => rpcMessageToGrpc(invalidMessage)).toThrowError("Unsupported message type or direction: UnknownType request");
    });

    it('should map an install snapshot request correctly', () => {
        const result = rpcMessageToGrpc(installSnapshotRequest);
        expect(result.method).toBe("InstallSnapshot");
        expect((result.payload as any).config).toBe(JSON.stringify(installSnapshotRequest.payload.config));
    });
});

describe('GRPCTransport.ts, grpcToRpcMessage', () => {
    it('should map a requestvote raw to a RequestVote response message', () => {
        const raw = {
            term: 1,
            voteGranted: true
        };
        const result = grpcToRpcMessage("RequestVote", raw);
        expect(result.type).toBe("RequestVote");
        expect(result.direction).toBe("response");
        expect(result.payload).toEqual(raw);
    });

    it('should preserve voteGranted when false', () => {
        const raw = {
            term: 1,
            voteGranted: false
        };
        const result = grpcToRpcMessage("RequestVote", raw);
        expect(result.type).toBe("RequestVote");
        expect(result.direction).toBe("response");
        expect(result.payload).toEqual(raw);
    });

    it('should map an appendentries response correctly', () => {
        const raw = {
            term: 1,
            success: true,
            hasMatchIndex: false,
            hasConflictIndex: false,
            hasConflictTerm: false
        };
        const result = grpcToRpcMessage("AppendEntries", raw);
        expect(result.type).toBe("AppendEntries");
        expect(result.direction).toBe("response");
        expect(result.payload).toEqual({
            term: 1,
            success: true
        });
    });

    it('should omit matchIndex, conflictIndex, and conflictTerm when not present', () => {
        const raw = {
            term: 1,
            success: true,
            hasMatchIndex: false,
            hasConflictIndex: false,
            hasConflictTerm: false
        };
        const result = grpcToRpcMessage("AppendEntries", raw);
        expect(result.type).toBe("AppendEntries");
        expect(result.payload).toEqual({
            term: 1,
            success: true,
            matchIndex: undefined,
            conflictIndex: undefined,
            conflictTerm: undefined
        });
    });

    it('should include matchIndex when hasMatchIndex is true', () => {
        const raw = {
            term: 1,
            success: true,
            hasMatchIndex: true,
            matchIndex: 5,
            hasConflictIndex: false,
            hasConflictTerm: false
        };
        const result = grpcToRpcMessage("AppendEntries", raw);
        expect(result.type).toBe("AppendEntries");
        expect(result.payload).toEqual({
            term: 1,
            success: true,
            matchIndex: 5,
            conflictIndex: undefined,
            conflictTerm: undefined
        });
    });

    it('should include conflictIndex when hasConflictIndex is true', () => {
        const raw = {
            term: 1,
            success: false,
            hasMatchIndex: false,
            hasConflictIndex: true,
            conflictIndex: 3,
            hasConflictTerm: false
        };
        const result = grpcToRpcMessage("AppendEntries", raw);
        expect(result.type).toBe("AppendEntries");
        expect(result.payload).toEqual({
            term: 1,
            success: false,
            matchIndex: undefined,
            conflictIndex: 3,
            conflictTerm: undefined
        });
    });

    it('should include conflictTerm when hasConflictTerm is true', () => {
        const raw = {
            term: 1,
            success: false,
            hasMatchIndex: false,
            hasConflictIndex: false,
            hasConflictTerm: true,
            conflictTerm: 2
        };
        const result = grpcToRpcMessage("AppendEntries", raw);
        expect(result.type).toBe("AppendEntries");
        expect(result.payload).toEqual({
            term: 1,
            success: false,
            matchIndex: undefined,
            conflictIndex: undefined,
            conflictTerm: 2
        });
    });

    it('should map an install snapshot response correctly', () => {
        const raw = {
            term: 1,
            success: true
        };
        const result = grpcToRpcMessage("InstallSnapshot", raw);
        expect(result.type).toBe("InstallSnapshot");
        expect(result.direction).toBe("response");
        expect(result.payload).toEqual(raw);
    });

    it('should throw for an unsupported message type', () => {
        const raw = {
            term: 1
        };
        expect(() => grpcToRpcMessage("UnknownType", raw)).toThrowError("Unsupported gRPC method: UnknownType");
    });
});

describe('GRPCTransport.ts, serializeAppendEntriesResponse', () => {
    it('should serialize basic succes response without optional fields', () => {
        const response = {
            term: 1,
            success: true
        };
        const result = serializeAppendEntriesResponse(response);
        expect(result).toEqual({
            term: 1,
            success: true,
            hasMatchIndex: false,
            matchIndex: 0,
            hasConflictIndex: false,
            conflictIndex: 0,
            hasConflictTerm: false,
            conflictTerm: 0
        });
    });

    it('should serialize response with matchIndex', () => {
        const response = {
            term: 1,
            success: true,
            matchIndex: 5
        };
        const result = serializeAppendEntriesResponse(response);
        expect(result).toEqual({
            term: 1,
            success: true,
            hasMatchIndex: true,
            matchIndex: 5,
            hasConflictIndex: false,
            conflictIndex: 0,
            hasConflictTerm: false,
            conflictTerm: 0
        });
    });

    it('should serialize response with conflictIndex', () => {
        const response = {
            term: 1,
            success: false,
            conflictIndex: 3
        };
        const result = serializeAppendEntriesResponse(response);
        expect(result).toEqual({
            term: 1,
            success: false,
            hasMatchIndex: false,
            matchIndex: 0,
            hasConflictIndex: true,
            conflictIndex: 3,
            hasConflictTerm: false,
            conflictTerm: 0
        });
    });

    it('should serialize response with conflictTerm', () => {
        const response = {
            term: 1,
            success: false,
            conflictTerm: 2
        };
        const result = serializeAppendEntriesResponse(response);
        expect(result).toEqual({
            term: 1,
            success: false,
            hasMatchIndex: false,
            matchIndex: 0,
            hasConflictIndex: false,
            conflictIndex: 0,
            hasConflictTerm: true,
            conflictTerm: 2
        });
    });

    it('should serialize response with all optional fields', () => {
        const response = {
            term: 1,
            success: false,
            matchIndex: 5,
            conflictIndex: 3,
            conflictTerm: 2
        };
        const result = serializeAppendEntriesResponse(response);
        expect(result).toEqual({
            term: 1,
            success: false,
            hasMatchIndex: true,
            matchIndex: 5,
            hasConflictIndex: true,
            conflictIndex: 3,
            hasConflictTerm: true,
            conflictTerm: 2
        });
    });

    it('should hanlde a round trip with grpcToRpcMessage', () => {
        const response = {
            term: 1,
            success: true
        };
        const serialized = serializeAppendEntriesResponse(response);
        const result = grpcToRpcMessage("AppendEntries", serialized);
        expect(result.type).toBe("AppendEntries");
        expect(result.direction).toBe("response");
    });
});

describe('GRPCTransport.ts, GrpcTransport', () => {
    it('should start and stop correctly', async () => {
        const { transportA, transportB } = makePair();
        await transportA.start();
        await transportB.start();
        expect(transportA.isStarted()).toBe(true);
        expect(transportB.isStarted()).toBe(true);
        await transportA.stop();
        await transportB.stop();
        expect(transportA.isStarted()).toBe(false);
        expect(transportB.isStarted()).toBe(false);
    });

    it('should throw an error when starting twice', async () => {
        const { transportA } = makePair();
        await transportA.start();
        await expect(transportA.start()).rejects.toThrowError("Transport for node nodeA is already started.");
        await transportA.stop();
    });

    it('should throw an error when stopping twice', async () => {
        const { transportA } = makePair();
        await transportA.start();
        await transportA.stop();
        await expect(transportA.stop()).rejects.toThrowError("Transport for node nodeA is not started.");
    });

    it('should throw when sending message while not started', async () => {
        const { transportA, transportB } = makePair();
        await expect(transportA.send("nodeB", requestVoteRequest)).rejects.toThrowError("Transport for node nodeA is not started.");
    });

    it('round trip RequestVote response through grpcToRpcMessage and rpcMessageToGrpc', async () => {
        const { transportA, transportB } = makePair();
        transportB.onMessage(async (from, message) => {
            expect(message).toEqual(requestVoteRequest);
            return requestVoteResponse;
        });

        await transportB.start();
        await transportA.start();
        const response = await transportA.send("nodeB", requestVoteRequest);

        expect(response).toEqual(requestVoteResponse);

        await transportA.stop();
        await transportB.stop();
    });

    it('preserves voteGranted=false in RequestVote response', async () => {
        const { transportA, transportB } = makePair();

        transportB.onMessage(async () => ({
            type: "RequestVote",
            direction: "response",
            payload: {
                term: 1,
                voteGranted: false
            }
        } as RPCMessage));

        await transportB.start();
        await transportA.start();
        const response = await transportA.send("nodeB",  {
            type: "RequestVote",
            direction: "request",
            payload: {
                term: 1,
                candidateId: "nodeA",
                lastLogIndex: 0,
                lastLogTerm: 0
            }});
        
        expect(response).toEqual({
            type: "RequestVote",
            direction: "response",
            payload: {
                term: 1,
                voteGranted: false
            }
        });

        await transportA.stop();
        await transportB.stop();
    });

    it('should round trip a heartbeat', async () => {
        const { transportA, transportB } = makePair();

        transportB.onMessage(async (from, msg) => {
            expect(msg).toEqual(appendEntriesRequest);
            return appendEntriesResponse;
        });

        await transportB.start();
        await transportA.start();
        const response = await transportA.send("nodeB", appendEntriesRequest);
        expect(response).toEqual(appendEntriesResponse);

        await transportA.stop();
        await transportB.stop();
    });


    it('preserves preVote field through send RequestVote request', async () => {
        const { transportA, transportB } = makePair();

        const requestVotePreVoteRequest: RPCMessage = {
            type: "RequestVote",
            direction: "request",
            payload: {
                term: 2,
                candidateId: "nodeA",
                lastLogIndex: 1,
                lastLogTerm: 1,
                preVote: true
            }
        };

        transportB.onMessage(async (_from, message) => {
            expect(message).toEqual(requestVotePreVoteRequest);
            return requestVoteResponse;
        });

        await transportA.start();
        await transportB.start();

        const response = await transportA.send("nodeB", requestVotePreVoteRequest);
        expect(response).toEqual(requestVoteResponse);

        await transportA.stop();
        await transportB.stop();
    });
    it('should round trip a logEntry with primitive json payload', async () => {
        const { transportA, transportB } = makePair();

        const logEntry: LogEntry = { term: 1, index: 1, type: LogEntryType.COMMAND, command: { type: "set", payload: { key: "x", value: 42 } } };
        let receivedEntry: LogEntry | null = null;

        transportB.onMessage(async (from, msg) => {
            if (msg.type === "AppendEntries" && msg.direction === "request") {
                receivedEntry = msg.payload.entries[0];
            }
            return appendEntriesResponse;
        });

        await transportB.start();
        await transportA.start();
        await transportA.send("nodeB", {
            type: "AppendEntries",
            direction: "request",
            payload: {
                term: 1,
                leaderId: "nodeA",
                prevLogIndex: 0,
                prevLogTerm: 0,
                entries: [logEntry],
                leaderCommit: 0
             }
        });

        expect(receivedEntry).toEqual(logEntry);

        await transportA.stop();
        await transportB.stop();
    });

    it('should round trip a logEntry with a deeply nested payload', async () => {
        const { transportA, transportB } = makePair();

        const nestedPayload = {
            key: "x",
            value: {
                nestedKey: "y",
                nestedValue: [1, 2, 3],
                deeperNested: {
                    foo: "bar"
                }
            }
        }

        let receivedEntry: LogEntry | null = null;

        transportB.onMessage(async (from, msg) => {
            if (msg.type === "AppendEntries" && msg.direction === "request") {
                receivedEntry = msg.payload.entries[0];
            }
            return appendEntriesResponse;
        });

        await transportB.start();
        await transportA.start();
        await transportA.send("nodeB", {
            type: "AppendEntries",
            direction: "request",
            payload: {
                term: 1,
                leaderId: "nodeA",
                prevLogIndex: 0,
                prevLogTerm: 0,
                entries: [{ term: 1, index: 1, type: LogEntryType.COMMAND, command: { type: "set", payload: nestedPayload } }],
                leaderCommit: 0
             }
         });

        expect(receivedEntry).toEqual({
            term: 1,
            index: 1,
            type: LogEntryType.COMMAND,
            command: {
                type: "set",
                payload: nestedPayload
            }
         });

        await transportA.stop();
        await transportB.stop();
    });

    it('should send the from-node metadata', async () => {
        const { transportA, transportB } = makePair();

        let receivedFrom: string | null = null;

        transportB.onMessage(async (from, msg) => {
            receivedFrom = from;
            return appendEntriesResponse;
        });

        await transportB.start();
        await transportA.start();
        await transportA.send("nodeB", appendEntriesRequest);
        expect(receivedFrom).toBe("nodeA");

        await transportA.stop();
        await transportB.stop();
    });

    it('should have matchIndex, conflictIndex, and conflictTerm as undefined when not present in AppendEntries response', async () => {
        const { transportA, transportB } = makePair();

        transportB.onMessage(async () => ({
            type: "AppendEntries",
            direction: "response",
            payload: {
                term: 1,
                success: true,
                hasMatchIndex: false,
                hasConflictIndex: false,
                hasConflictTerm: false
            }
        } as RPCMessage));

        await transportB.start();
        await transportA.start();
        const response = await transportA.send("nodeB", appendEntriesRequest);

        expect(response).toEqual({
            type: "AppendEntries",
            direction: "response",
            payload: {
                term: 1,
                success: true,
                matchIndex: undefined,
                conflictIndex: undefined,
                conflictTerm: undefined
            }
        });
    });

    it('should work for matchIndex = 0 in AppendEntries response', async () => {
        const { transportA, transportB } = makePair();

        transportB.onMessage(async () => ({
            type: "AppendEntries",
            direction: "response",
            payload: {
                term: 1,
                success: true,
                hasMatchIndex: true,
                matchIndex: 0,
                hasConflictIndex: false,
                hasConflictTerm: false
            }
        } as RPCMessage));

        await transportB.start();
        await transportA.start();
        const response = await transportA.send("nodeB", appendEntriesRequest);
        expect(response).toEqual({
            type: "AppendEntries",
            direction: "response",
            payload: {
                term: 1,
                success: true,
                matchIndex: 0,
                conflictIndex: undefined,
                conflictTerm: undefined
            }
        });
    });

    it('should throw NetworkEror when no handler is registered', async () => {
        const { transportA, transportB } = makePair();

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", requestVoteRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
    });

    it('should throw NetworkError when sending to an unknown node', async () => {
        const { transportA } = makePair();
        await transportA.start();
        await expect(transportA.send("unknownNode", requestVoteRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
    });

    it('should throw NetworkError when sending a response message', async () => {
        const { transportA, transportB } = makePair();
        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", requestVoteResponse)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
    });

    it('should throw when binding to an already used port', async () => {
        const port = nextPort();
        const transportA = new GrpcTransport("nodeA", port, { nodeB: `localhost:${port + 1}` });
        const transportB = new GrpcTransport("nodeB", port, { nodeA: `localhost:${port}` });
        await transportA.start();
        await expect(transportB.start()).rejects.toThrowError(NetworkError);
        await transportA.stop();
    });

    it('should throw when no handler registered for appendEntries response', async () => {
        const { transportA, transportB } = makePair();

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", {
            type: "AppendEntries",
            direction: "response",
            payload: {
                term: 1,
                success: true
            }
        })).rejects.toThrowError(NetworkError);

        await transportA.stop();
        await transportB.stop();
    });

    it('should throw when no handler registered for installSnapshot response', async () => {
        const { transportA, transportB } = makePair();

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", {
            type: "InstallSnapshot",
            direction: "response",
            payload: {
                term: 1,
                success: true
            }
        })).rejects.toThrowError(NetworkError);

        await transportA.stop();
        await transportB.stop();
    });

    it('should throw when requestvote handler returns wrong message type', async () => {
        const { transportA, transportB } = makePair();
        transportB.onMessage(async () => appendEntriesResponse);

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", requestVoteRequest)).rejects.toThrowError(NetworkError);

        await transportA.stop();
        await transportB.stop();
    });

    it('should throw when appendEntries handler returns wrong message type', async () => {
        const { transportA, transportB } = makePair();
        transportB.onMessage(async () => requestVoteResponse);

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", appendEntriesRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
    });

    it('should throw when installSnapshot handler returns wrong message type', async () => {
        const { transportA, transportB } = makePair();
        transportB.onMessage(async () => requestVoteResponse);

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", installSnapshotRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
    });

    it('should throw when appendentries handler throws an error', async () => {
        const { transportA, transportB } = makePair();

        transportB.onMessage(async () => {
            throw new Error("Handler error");
        });

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", appendEntriesRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
    });

    it('should throw when requestvote handler throws an error', async () => {
        const { transportA, transportB } = makePair();

        transportB.onMessage(async () => {
            throw new Error("Handler error");
        });

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", requestVoteRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
     });

     it('should throw when installSnapshot handler throws an error', async () => {
        const { transportA, transportB } = makePair();

        transportB.onMessage(async () => {
            throw new Error("Handler error");
        });

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", installSnapshotRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
     });

     it('should throw when no handler registered for appendEntries request', async () => {
        const { transportA, transportB } = makePair();

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", appendEntriesRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
    });

    it('should throw when no handler registered for installSnapshot request', async () => {
        const { transportA, transportB } = makePair();

        await transportB.start();
        await transportA.start();
        await expect(transportA.send("nodeB", installSnapshotRequest)).rejects.toThrowError(NetworkError);
        await transportA.stop();
        await transportB.stop();
    });

    it('should round trip an installSnapshot request', async () => {
        const { transportA, transportB } = makePair();

        transportB.onMessage(async (from, message) => {
            expect(message).toEqual(installSnapshotRequest);
            return installSnapshotResponse;
        });

        await transportB.start();
        await transportA.start();
        const response = await transportA.send("nodeB", installSnapshotRequest);
        expect(response).toEqual(installSnapshotResponse);

        await transportA.stop();
        await transportB.stop();
    });

    it('should start with real TLS certs', async () => {
        const portA = nextPort();
        const portB = nextPort();

        const certBase = path.join(__dirname, '../../certs');

        const transportA = new GrpcTransport("node1", portA, { node2: `localhost:${portB}` }, {
            caCert: path.join(certBase, 'ca/ca.crt'),
            nodeCert: path.join(certBase, 'node1/node1.crt'),
            nodeKey: path.join(certBase, 'node1/node1.key'),
        });

        const transportB = new GrpcTransport("node2", portB, { node1: `localhost:${portA}` }, {
            caCert: path.join(certBase, 'ca/ca.crt'),
            nodeCert: path.join(certBase, 'node2/node2.crt'),
            nodeKey: path.join(certBase, 'node2/node2.key'),
        });

        transportB.onMessage(async () => requestVoteResponse);

        await transportB.start();
        await transportA.start();

        const response = await transportA.send("node2", requestVoteRequest);
        expect(response).toEqual(requestVoteResponse);

        await transportA.stop();
        await transportB.stop();
    });

    it('should add a peer dynamically and send messages to it', async () => {
        const portA = nextPort();
        const portC = nextPort();

        const transportA = new GrpcTransport("nodeA", portA, {});
        const transportC = new GrpcTransport("nodeC", portC, {});

        transportC.onMessage(async () => requestVoteResponse);

        await transportC.start();
        await transportA.start();

        await transportA.addPeer("nodeC", `localhost:${portC}`);

        const response = await transportA.send("nodeC", requestVoteRequest);
        expect(response).toEqual(requestVoteResponse);

        await transportA.stop();
        await transportC.stop();
    });

    it('should not throw when adding an already existing peer', async () => {
        const { transportA } = makePair();
        await transportA.start();
        await expect(transportA.addPeer("nodeB", "localhost:1234")).resolves.not.toThrow();
        await transportA.stop();
    });

    it('should remove a peer and prevent sending to it', async () => {
        const { transportA, transportB } = makePair();

        await transportA.start();
        await transportB.start();

        transportA.removePeer("nodeB");
        await expect(transportA.send("nodeB", requestVoteRequest)).rejects.toThrowError(NetworkError);

        await transportA.stop();
        await transportB.stop();
    });

    it('should silently ignore removePeer for unknown peer', async () => {
        const { transportA } = makePair();
        await transportA.start();
        expect(() => transportA.removePeer('unknownPeer')).not.toThrow();
        await transportA.stop();
    });

    it('should throw when addind peer before transport is started', async () => {
        const { transportA } = makePair();

        await expect(transportA.addPeer('nodeC', "localhost:56768")).rejects.toThrowError('Transport is not initialized. Start the transport before adding peers.')
    });

    it("should force shutdown when tryShutdown returns error", async () => {
        const { transportA } = makePair();
        await transportA.start();

        const server = (transportA as any).server;

        vi.spyOn(server, "tryShutdown").mockImplementation((cb: any) => {
            cb(new Error("shutdown failed"));
        });

        const forceSpy = vi.spyOn(server, "forceShutdown");

        await transportA.stop();

        expect(forceSpy).toHaveBeenCalled();
    });

    it("should force shutdown when tryShutdown hangs", async () => {
        vi.useFakeTimers();

        const { transportA } = makePair();

        const forceShutdown = vi.fn();
        const tryShutdown = vi.fn(() => {});

        (transportA as any).server = {
            tryShutdown,
            forceShutdown
        };

        (transportA as any).started = true;

        const stopPromise = transportA.stop();

        await vi.advanceTimersByTimeAsync((transportA as any).shutdownTimeoutMs);

        await stopPromise;

        expect(forceShutdown).toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('should convert non-Buffer data to Buffer in InstallSnapshot handler', async () => {
        const port = nextPort();
        const transport = new GrpcTransport("nodeA", port, {});
        const handler = vi.fn().mockResolvedValue({
            type: "InstallSnapshot" as const,
            direction: "response" as const,
            payload: { term: 1, success: true }
        } as RPCMessage);
        transport.onMessage(handler);

        const serviceImpl = (transport as any).buildServiceImplementation();
        const callback = vi.fn();

        await serviceImpl.InstallSnapshot({
            request: {
                term: 1,
                leaderId: "nodeA",
                lastIncludedIndex: 0,
                lastIncludedTerm: 0,
                data: new Uint8Array(Buffer.from("snapshot data")),
                config: JSON.stringify({ voters: [], learners: [] })
            },
            metadata: { get: () => [] }
        }, callback);

        expect(callback).toHaveBeenCalledWith(null, expect.anything());
        const receivedData = handler.mock.calls[0][1].payload.data;
        expect(Buffer.isBuffer(receivedData)).toBe(true);
        expect(receivedData).toEqual(Buffer.from("snapshot data"));
    });

    it('should use default config when config field is absent in InstallSnapshot handler', async () => {
        const port = nextPort();
        const transport = new GrpcTransport("nodeA", port, {});
        const handler = vi.fn().mockResolvedValue({
            type: "InstallSnapshot" as const,
            direction: "response" as const,
            payload: { term: 1, success: true }
        } as RPCMessage);
        transport.onMessage(handler);

        const serviceImpl = (transport as any).buildServiceImplementation();
        const callback = vi.fn();

        await serviceImpl.InstallSnapshot({
            request: {
                term: 1,
                leaderId: "nodeA",
                lastIncludedIndex: 0,
                lastIncludedTerm: 0,
                data: Buffer.from("snapshot data"),
                config: ""
            },
            metadata: { get: () => [] }
        }, callback);

        expect(callback).toHaveBeenCalledWith(null, expect.anything());
        const receivedConfig = handler.mock.calls[0][1].payload.config;
        expect(receivedConfig).toEqual({ voters: [], learners: [] });
    });
});