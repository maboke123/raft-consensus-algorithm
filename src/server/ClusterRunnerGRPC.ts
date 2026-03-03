import { createConfig, NodeId } from "../core/Config";
import { RaftNode } from "../core/RaftNode";
import { RaftEventBus } from "../events/RaftEvents";
import { Command } from "../log/LogEntry";
// import { InMemoryStorage } from "../storage/InMemoryStorage";
import { SystemClock } from "../timing/Clock";
import { TimerConfig } from "../timing/TimerManager";
import { GrpcTransport } from "../transport/GRPCTransport";
import { SystemRandom } from "../util/Random";
import { DiskStorage } from "../storage/DiskStorage";
import path from "node:path";


export interface ClusterRunnerOptions {
    nodeCount: number;
    timerConfig: TimerConfig;
}

class NoOpStateMachine {
    async apply(command: Command): Promise<void> {}
    getState(): null { return null; }
    async takeSnapshot(): Promise<Buffer> { return Buffer.alloc(0); }
    async installSnapshot(snapshot: Buffer): Promise<void> {}
}

export class ClusterRunnerGRPC {
    private nodes: Map<NodeId, RaftNode> = new Map();
    private nodeIds: NodeId[] = [];

    constructor(
        private bus: RaftEventBus,
        private options: ClusterRunnerOptions
    ){}

    async start(): Promise<void> {
        const { nodeCount, timerConfig } = this.options;

        this.nodeIds = Array.from({ length: nodeCount }, (_, i) => `node${i + 1}`);

        const addressMap: Record<NodeId, string> = {};
        this.nodeIds.forEach((nodeId, index) => {
            addressMap[nodeId] = `localhost:${52000 + index}`;
        });

        for (const nodeId of this.nodeIds) {
            const peerIds = this.nodeIds.filter(id => id !== nodeId);
            const config = createConfig(nodeId, peerIds, timerConfig.electionTimeoutMin, timerConfig.electionTimeoutMax, timerConfig.heartbeatInterval);

            const storage = new DiskStorage(path.join(__dirname, "../../data", nodeId));
            await storage.open();

            const port = 52000 + this.nodeIds.indexOf(nodeId);

            const peers = Object.fromEntries(
                Object.entries(addressMap).filter(([id]) => id !== nodeId)
            );

            const transport = new GrpcTransport(
                nodeId,
                port, 
                peers, 
                {
                    caCert: path.join(__dirname, "../../certs/ca/ca.crt"),
                    nodeCert: path.join(__dirname, `../../certs/${nodeId}`, `${nodeId}.crt`),
                    nodeKey: path.join(__dirname, `../../certs/${nodeId}`, `${nodeId}.key`)
                },
                400, 
                3000);

            const clock = new SystemClock();

            const random = new SystemRandom();

            const node = new RaftNode(
                config,
                storage,
                transport,
                new NoOpStateMachine(),
                clock,
                random,
                undefined,
                this.bus
            );

            this.nodes.set(nodeId, node);
        }

        for (const node of this.nodes.values()) {
            await node.start();
        }
    }

    async stop(): Promise<void> {
        for (const node of this.nodes.values()) {
            if (node.isStarted()) {
                await node.stop();
            }
        }
    }

    getNodeIds(): NodeId[] {
        return [...this.nodeIds];
    }

    async crashNode(nodeId: NodeId): Promise<void> {
        const node = this.nodes.get(nodeId);
        if (node && node.isStarted()) {
            await node.stop();
        }
    }

    async recoverNode(nodeId: NodeId): Promise<void> {
        const node = this.nodes.get(nodeId);
        if (node && !node.isStarted()) {
            await node.start();
        }
    }

    partitionNodes(groups: NodeId[][]): void {}

    healPartition(): void {}

    setDropRate(nodeId: NodeId, rate: number): void {    }

    async submitCommand(command: Command, targetLeaderId?: NodeId): Promise<void> {
        const canidates = targetLeaderId
            ? [ this.nodes.get(targetLeaderId)!].filter(Boolean)
            : Array.from(this.nodes.values()).filter(node => node.isStarted() && node.isLeader());

        if (canidates.length === 0) {
            throw new Error('No leader available to submit command');
        }

        const result = await canidates[0].submitCommand(command);
        if (!result.success) {
            throw new Error(`Command submission failed: ${result.error}`);
        }
    }

    cutLink(nodeA: NodeId, nodeB: NodeId): void {}

    healLink(nodeA: NodeId, nodeB: NodeId): void {}

    healAllLinks(): void {}
}

