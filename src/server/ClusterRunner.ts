import { createConfig, NodeId } from "../core/Config";
import { RaftNode } from "../core/RaftNode";
import { RaftEventBus } from "../events/RaftEvents";
import { Command } from "../log/LogEntry";
import { InMemoryStorage } from "../storage/Storage";
import { SystemClock } from "../timing/Clock";
import { TimerConfig } from "../timing/TimerManager";
import { MockTransport } from "../transport/Transport";
import { SystemRandom } from "../util/Random";


export interface ClusterRunnerOptions {
    nodeCount: number;
    timerConfig: TimerConfig;
}

class NoOpStateMachine {
    async apply(command: Command): Promise<void> {}
    getState(): null { return null; }
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

    partitionNodes(groupA: NodeId[], groupB: NodeId[]): void {
        MockTransport.partition(groupA, groupB);
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
            : Array.from(this.nodes.values()).filter(node => node.isLeader());

        if (canidates.length === 0) {
            throw new Error('No leader available to submit command');
        }

        const result = await canidates[0].submitCommand(command);
        if (!result.success) {
            throw new Error(`Command submission failed: ${result.error}`);
        }
    }
}

