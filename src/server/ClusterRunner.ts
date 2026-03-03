import { createConfig, NodeId } from "../core/Config";
import { RaftNode } from "../core/RaftNode";
import { RaftEventBus } from "../events/RaftEvents";
import { Command } from "../log/LogEntry";
import { InMemoryStorage } from "../storage/InMemoryStorage";
import { SystemClock } from "../timing/Clock";
import { TimerConfig } from "../timing/TimerManager";
import { MockTransport } from "../transport/MockTransport";
import { SystemRandom } from "../util/Random";


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

export class ClusterRunner {
    private nodes: Map<NodeId, RaftNode> = new Map();
    private nodeIds: NodeId[] = [];

    constructor(
        private bus: RaftEventBus,
        private options: ClusterRunnerOptions
    ){}

    async start(): Promise<void> {
        const { nodeCount, timerConfig } = this.options;

        this.nodeIds = Array.from({ length: nodeCount }, (_, i) => `node${i + 1}`);

        for (const nodeId of this.nodeIds) {
            const peerIds = this.nodeIds.filter(id => id !== nodeId);
            const config = createConfig(nodeId, peerIds, timerConfig.electionTimeoutMin, timerConfig.electionTimeoutMax, timerConfig.heartbeatInterval);

            const storage = new InMemoryStorage();
            storage.open();

            const transport = new MockTransport(nodeId, new SystemRandom());

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

        MockTransport.reset();
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

    partitionNodes(groups: NodeId[][]): void {
        MockTransport.partition(...groups);
    }

    healPartition(): void {
        MockTransport.healPartition();
    }

    setDropRate(nodeId: NodeId, rate: number): void {
        MockTransport.setDropRate(nodeId, rate);
    }

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

    cutLink(nodeA: NodeId, nodeB: NodeId): void {
        MockTransport.cutLink(nodeA, nodeB);
        this.bus.emit({
            eventId: crypto.randomUUID(),
            timestamp: performance.now(),
            wallTime: Date.now(),
            type: "LinkCut",
            nodeA,
            nodeB,
        });
    }

    healLink(nodeA: NodeId, nodeB: NodeId): void {
        MockTransport.healLink(nodeA, nodeB);
        this.bus.emit({
            eventId: crypto.randomUUID(),
            timestamp: performance.now(),
            wallTime: Date.now(),
            type: "LinkHealed",
            nodeA,
            nodeB,
        });
    }

    healAllLinks(): void {
        MockTransport.healAllLinks();
        this.bus.emit({
            eventId: crypto.randomUUID(),
            timestamp: performance.now(),
            wallTime: Date.now(),
            type: "AllLinksHealed",
        });
    }
}

