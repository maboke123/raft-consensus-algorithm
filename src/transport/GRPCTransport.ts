import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import { AppendEntriesResponse, RPCMessage } from "../rpc/RPCTypes";
import { NetworkError } from "../util/Error";
import { Transport, MessageHandler } from "./Transport";
import { StorageCodec } from "../storage/Storage";
import { NodeId } from "../core/Config";
import fs from "fs/promises";

const protoPath = path.resolve(__dirname, "../../proto/raft.proto");

const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: false,
    oneofs: true,
});

const proto = grpc.loadPackageDefinition(packageDefinition) as any;

export function rpcMessageToGrpc(message: RPCMessage): { method: string, payload: object} {
    if (message.type === "RequestVote" && message.direction === "request") {
        return {
            method: "RequestVote",
            payload: message.payload
        };
    } else if (message.type === "AppendEntries" && message.direction === "request") {
        return {
            method: "AppendEntries",
            payload: {
                ...message.payload,
                entries: message.payload.entries.map((entry: any) => StorageCodec.serializeLogEntry(entry))
            }
        };
    };

    throw new NetworkError(`Unsupported message type or direction: ${message.type} ${message.direction}`);
}

export function grpcToRpcMessage(method: string, raw: any): RPCMessage {
    if (method === "RequestVote") {
        return {
            type: "RequestVote",
            direction: "response",
            payload: {
                term: raw.term,
                voteGranted: raw.voteGranted
            }
        };
    };

    const payload: AppendEntriesResponse = {
        term: raw.term,
        success: raw.success,
        ...(raw.hasMatchIndex && { matchIndex: raw.matchIndex }),
        ...(raw.hasConflictIndex && { conflictIndex: raw.conflictIndex }),
        ...(raw.hasConflictTerm && { conflictTerm: raw.conflictTerm }),
    };

    return {
        type: "AppendEntries",
        direction: "response",
        payload: payload
    };
}

export function serializeAppendEntriesResponse(response: AppendEntriesResponse): object {
    return {
        term: response.term,
        success: response.success,
        hasMatchIndex: response.matchIndex !== undefined,
        matchIndex: response.matchIndex ?? 0,
        hasConflictIndex: response.conflictIndex !== undefined,
        conflictIndex: response.conflictIndex ?? 0,
        hasConflictTerm: response.conflictTerm !== undefined,
        conflictTerm: response.conflictTerm ?? 0,
    };
}

export class GrpcTransport implements Transport {
    private handler: MessageHandler | null = null;
    private started: boolean = false;
    private server: grpc.Server | null = null;
    private clients: Map<NodeId, any> = new Map();

    private readonly callTimeoutMs: number;
    private readonly shutdownTimeoutMs: number;

    constructor(
        private readonly nodeId: NodeId,
        private readonly port: number,
        private readonly peers: Record<NodeId, string>,
        private readonly certPaths: {
            caCert: string,
            nodeCert: string;
            nodeKey: string;
        },
        callTimeoutMs: number = 5000,
        shutdownTimeoutMs: number = 5000
    ) {
        this.callTimeoutMs = callTimeoutMs;
        this.shutdownTimeoutMs = shutdownTimeoutMs;
    }

    async start(): Promise<void> {
        if (this.started) {
            throw new NetworkError(`Transport for node ${this.nodeId} is already started.`);
        }

        this.server = new grpc.Server();
        this.server.addService(proto.raft.RaftService.service, this.buildServiceImplementation());

        const caCert = await fs.readFile(this.certPaths.caCert);
        const nodeCert = await fs.readFile(this.certPaths.nodeCert);
        const nodeKey = await fs.readFile(this.certPaths.nodeKey);

        return new Promise((resolve, reject) => {
            this.server!.bindAsync(
                `0.0.0.0:${this.port}`,
                grpc.ServerCredentials.createSsl(
                    caCert,
                    [{
                        cert_chain: nodeCert,
                        private_key: nodeKey
                    }],
                    true
                ),
                (err) => {
                    if (err) {
                        reject(new NetworkError(`Failed to bind gRPC server: ${err.message}`));
                    }

                    for (const [peerId, address] of Object.entries(this.peers)) {
                        this.clients.set(
                            peerId,
                            new proto.raft.RaftService(address, grpc.credentials.createSsl(caCert, nodeKey, nodeCert), { 'grpc.enable_retries': 0 })
                        );
                    }

                    this.started = true;
                    resolve();
                }
            );
        });
    }

    async stop(): Promise<void> {

        if (!this.started) {
            throw new NetworkError(`Transport for node ${this.nodeId} is not started.`);
        }

        for (const client of this.clients.values()) {
            client.close();
        }
        this.clients.clear();

        return new Promise((resolve, reject) => {
            const forced = setTimeout(() => {
                this.server!.forceShutdown();
                this.finishStop();
                resolve();
            }, this.shutdownTimeoutMs);

            this.server!.tryShutdown((err) => {
                clearTimeout(forced);
                if (err) {
                    this.server!.forceShutdown();
                }
                this.finishStop();
                resolve();
            });
        });
    }

    isStarted(): boolean {
        return this.started;
    }

    async send(peerId: NodeId, message: RPCMessage): Promise<RPCMessage> {
        if (!this.started) {
            throw new NetworkError(`Transport for node ${this.nodeId} is not started.`);
        }

        const client = this.clients.get(peerId);
        if (!client) {
            throw new NetworkError(`Peer ${peerId} is not available.`);
        }

        const { method, payload } = rpcMessageToGrpc(message);

        const metadata = new grpc.Metadata();
        metadata.set('from-node', this.nodeId);

        const deadline = new Date(Date.now() + this.callTimeoutMs);

        return new Promise((resolve, reject) => {
            client[method](payload, metadata, { deadline }, (err: any, response: any) => {
                if (err) {
                    reject(new NetworkError(`Failed to send message from ${this.nodeId} to ${peerId}: ${err.message}`, err));
                    return;
                }
                resolve(grpcToRpcMessage(method, response));
            });
        });
    }

    onMessage(handler: MessageHandler): void {
        this.handler = handler;
    }

    private finishStop() {
        this.started = false;
        this.handler = null;
        this.server = null;
    }

    private buildServiceImplementation() {
        return {
            RequestVote: async (call: any, callback: any) => {
                if (!this.handler) {
                    callback({ code: grpc.status.UNAVAILABLE, message: "No message handler registered" });
                    return;
                }

                try {
                    const from = this.extractSender(call);
                    const message: RPCMessage = {
                        type: "RequestVote",
                        direction: "request",
                        payload: call.request
                    };

                    const response = await this.handler(from, message);

                    if (response.type !== "RequestVote" || response.direction !== "response") {
                        callback({ code: grpc.status.INTERNAL, message: "Invalid response type from handler" });
                        return;
                    }

                    callback(null, response.payload);
                } catch (err) {
                    callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
                }
            },

            AppendEntries: async (call: any, callback: any) => {
                if (!this.handler) {
                    callback({ code: grpc.status.UNAVAILABLE, message: "No message handler registered" });
                    return;
                }

                try {
                    const from = this.extractSender(call);
                    const message: RPCMessage = {
                        type: "AppendEntries",
                        direction: "request",
                        payload: {
                            ...call.request,
                            entries: (call.request.entries ?? []).map(StorageCodec.deserializeLogEntry)
                        }
                    };

                    const response = await this.handler(from, message);

                    if (response.type !== "AppendEntries" || response.direction !== "response") {
                        callback({ code: grpc.status.INTERNAL, message: "Invalid response type from handler" });
                        return;
                    }

                    callback(null, serializeAppendEntriesResponse(response.payload));
                } catch (err) {
                    callback({ code: grpc.status.INTERNAL, message: (err as Error).message });
                }
            }
        };
    }

    private extractSender(call: any): NodeId {
        const values = call.metadata?.get('from-node');
        return ( values && values.length > 0) ? (values[0] as NodeId) : ("unknown" as NodeId);
    }
}