import { NodeId} from "../core/Config";
import { RPCMessage } from "../rpc/RPCTypes";
import { NetworkError } from "../util/Error";
import { Random } from "../util/Random";

export type MessageHandler = (
    from: NodeId,
    message: RPCMessage
) => Promise<RPCMessage>;

export interface Transport {
    start(): Promise<void>;
    stop(): Promise<void>;
    isStarted(): boolean;
    send(peerId: NodeId, message: RPCMessage): Promise<RPCMessage>;
    onMessage(handler: MessageHandler): void;
}

export class MockTransport implements Transport {
    private handler: MessageHandler | null = null;
    private started: boolean = false;
    private dropRate: number= 0;

    private static transports: Map<NodeId, MockTransport> = new Map();
    private static partitions: Set<NodeId>[] = [];

    constructor(private readonly nodeId: NodeId, private readonly random: Random) {}

    async start(): Promise<void> {
        if (this.started) {
            throw new NetworkError(`Transport for node ${this.nodeId} is already started.`);
        }

        this.started = true;
        MockTransport.transports.set(this.nodeId, this);
    }

    async stop(): Promise<void> {
        if (!this.started) {
            throw new NetworkError(`Transport for node ${this.nodeId} is not started.`);
        }
        this.started = false;
        this.handler = null;
        MockTransport.transports.delete(this.nodeId);
    }

    isStarted(): boolean {
        return this.started;
    }

    async send(peerId: NodeId, message: RPCMessage): Promise<RPCMessage> {
        if (!this.started) {
            throw new NetworkError(`Transport for node ${this.nodeId} is not started.`);
        }

        if (this.random.nextFloat() < this.dropRate) {
            throw new NetworkError(`Message from ${this.nodeId} to ${peerId} was dropped due to simulated network conditions.`);
        }

        if(MockTransport.isPartitioned(this.nodeId, peerId)) {
            throw new NetworkError(`Message from ${this.nodeId} to ${peerId} was dropped due to network partition.`);
        }

        const peerTransport = MockTransport.transports.get(peerId);

        if (!peerTransport || !peerTransport.isStarted()) {
            throw new NetworkError(`Peer ${peerId} is not available.`);
        }

        if (!peerTransport.handler) {
            throw new NetworkError(`Peer ${peerId} does not have a message handler registered.`);
        }

        try {
            return await peerTransport.handler(this.nodeId, message);
        } catch (error) {
            throw new NetworkError(`Failed to send message from ${this.nodeId} to ${peerId}: ${(error as Error).message}`, error as Error);
        }
    }

    onMessage(handler: MessageHandler): void {
        this.handler = handler;
    }

    setDropRate(dropRate: number): void {

        if (!Number(dropRate) || dropRate < 0 || dropRate > 1) {
            throw new NetworkError(`Invalid drop rate: ${dropRate}. Drop rate must be a number between 0 and 1.`);
        }
        this.dropRate = dropRate;
    }

    static setDropRate(nodeId: NodeId, dropRate: number): void {
        const transport = MockTransport.transports.get(nodeId);
        if (!transport) { return; }
        transport.setDropRate(dropRate);
    }

    getDropRate(): number {
        return this.dropRate;
    }

    static partition(...groups: NodeId[][]): void {
        MockTransport.partitions = groups.map(group => new Set(group));
    }

    static healPartition(): void {
        MockTransport.partitions = [];
    }

    static isPartitioned(nodeA: NodeId, nodeB: NodeId): boolean {
        if (MockTransport.partitions.length === 0) {
            return false;
        }

        let fromPartition: Set<NodeId> | null = null;
        let toPartition: Set<NodeId> | null = null;

        for (const partition of MockTransport.partitions) {
            if (partition.has(nodeA)) {
                fromPartition = partition;
            }

            if (partition.has(nodeB)) {
                toPartition = partition;
            }

            if (fromPartition && toPartition) {
                break;
            }
        }

        if (!fromPartition) {
            fromPartition = new Set([nodeA]);
        }

        if (!toPartition) {
            toPartition = new Set([nodeB]);
        }

        return fromPartition !== toPartition;
    }

    static reset(): void {
        MockTransport.transports.clear();
        MockTransport.partitions = [];
    }

    static getRegisteredNodes(): NodeId[] {
        return Array.from(MockTransport.transports.keys());
    }
}
