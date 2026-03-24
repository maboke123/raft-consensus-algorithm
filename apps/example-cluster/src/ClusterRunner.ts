import {
    Command,
    createConfig,
    InMemoryNodeStorage,
    NodeId,
    RaftEventBus,
    RaftNode,
} from "@maboke123/raft-core";
import { MockTransport, SeededRandom } from "@maboke123/raft-core/testing";
import { ClusterRunnerInterface, CommittedConfig } from "./ClusterRunnerInterface";

interface TimerConfig {
    electionTimeoutMin: number;
    electionTimeoutMax: number;
    heartbeatInterval: number;
}

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

interface NodeEntry {
    node: RaftNode;
    storage: InMemoryNodeStorage;
    address: string;
}

export class ClusterRunner implements ClusterRunnerInterface {
    private entries: Map<NodeId, NodeEntry> = new Map();
    private nodeIds: NodeId[] = [];
    private committedConfig: CommittedConfig = { voters: [], learners: [] };

    constructor(
        private bus: RaftEventBus,
        private options: ClusterRunnerOptions
    ) {}

    async start(): Promise<void> {
        const { nodeCount, timerConfig } = this.options;

        this.nodeIds = Array.from({ length: nodeCount }, (_, i) => `node${i + 1}`);

        this.committedConfig = {
            voters: this.nodeIds.map((id, index) => ({ id, address: `localhost:${52000 + index}` })),
            learners: []
        };

        for (const nodeId of this.nodeIds) {
            const address = `localhost:${52000 + this.nodeIds.indexOf(nodeId)}`;
            const storage = new InMemoryNodeStorage();
            await storage.open();
            this.entries.set(nodeId, { node: null!, storage, address });
        }

        for (const nodeId of this.nodeIds) {
            const entry = this.entries.get(nodeId)!;
            const node = this.buildNode(nodeId, entry.address, entry.storage);
            entry.node = node;
        }

        for (const entry of this.entries.values()) {
            await entry.node.start();
        }
    }

    async stop(): Promise<void> {
        for (const entry of this.entries.values()) {
            if (entry.node.isStarted()) {
                await entry.node.stop();
            }
        }
        MockTransport.reset();
    }

    getNodeIds(): NodeId[] {
        return [...this.nodeIds];
    }

    async crashNode(nodeId: NodeId): Promise<void> {
        const entry = this.entries.get(nodeId);
        if (entry && entry.node.isStarted()) {
            await entry.node.stop();
        }
    }

    async recoverNode(nodeId: NodeId): Promise<void> {
        const entry = this.entries.get(nodeId);
        if (!entry || entry.node.isStarted()) return;

        entry.node = this.buildNode(nodeId, entry.address, entry.storage);
        await entry.node.start();
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
        const candidates = targetLeaderId
            ? [this.entries.get(targetLeaderId)?.node!].filter(Boolean)
            : Array.from(this.entries.values()).map(e => e.node).filter(n => n.isStarted() && n.isLeader());

        if (candidates.length === 0) {
            throw new Error('No leader available to submit command');
        }

        const result = await candidates[0].submitCommand(command);
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

    async addServer(nodeId: NodeId, address: string, asLearner: boolean): Promise<void> {
        if (this.entries.has(nodeId)) {
            throw new Error(`Node ${nodeId} already exists in the cluster`);
        }

        const port = parseInt(address.split(':')[1]);
        if (isNaN(port)) {
            throw new Error(`Invalid address format: ${address}`);
        }

        const leader = Array.from(this.entries.values()).map(e => e.node).find(n => n.isStarted() && n.isLeader());
        if (!leader) {
            throw new Error('No leader available to add server');
        }

        const storage = new InMemoryNodeStorage();
        await storage.open();

        const node = this.buildNode(nodeId, address, storage);

        for (const entry of this.entries.values()) {
            if (entry.node.isStarted()) {
                await entry.node.registerPeer(nodeId, address);
            }
        }

        const success = await leader.addServer(nodeId, address, asLearner);

        if (!success) {
            for (const entry of this.entries.values()) {
                if (entry.node.isStarted()) {
                    await entry.node.removePeer(nodeId);
                }
            }
            throw new Error(`Failed to add server ${nodeId} to the cluster`);
        }

        this.entries.set(nodeId, { node, storage, address });
        this.nodeIds.push(nodeId);

        await node.start();

        const member = { id: nodeId, address };
        if (asLearner) {
            this.committedConfig = {
                voters: this.committedConfig.voters,
                learners: [...this.committedConfig.learners, member]
            };
        } else {
            this.committedConfig = {
                voters: [...this.committedConfig.voters, member],
                learners: this.committedConfig.learners
            };
        }
    }

    async removeServer(nodeId: NodeId): Promise<void> {
        const leader = Array.from(this.entries.values()).map(e => e.node).find(n => n.isStarted() && n.isLeader());
        if (!leader) {
            throw new Error('No leader available to remove server');
        }

        await leader.removeServer(nodeId);

        const entry = this.entries.get(nodeId);
        if (entry && entry.node.isStarted()) {
            await entry.node.stop();
        }

        for (const [existingId, existingEntry] of this.entries) {
            if (existingId !== nodeId && existingEntry.node.isStarted()) {
                await existingEntry.node.removePeer(nodeId);
            }
        }

        this.entries.delete(nodeId);
        this.nodeIds = this.nodeIds.filter(id => id !== nodeId);
        this.committedConfig = {
            voters: this.committedConfig.voters.filter(m => m.id !== nodeId),
            learners: this.committedConfig.learners.filter(m => m.id !== nodeId)
        };
    }

    async promoteServer(nodeId: NodeId): Promise<void> {
        const leader = Array.from(this.entries.values()).map(e => e.node).find(n => n.isStarted() && n.isLeader());
        if (!leader) {
            throw new Error('No leader available to promote server');
        }

        await leader.promoteServer(nodeId);

        const member = this.committedConfig.learners.find(m => m.id === nodeId);
        if (member) {
            this.committedConfig = {
                voters: [...this.committedConfig.voters, member],
                learners: this.committedConfig.learners.filter(m => m.id !== nodeId)
            };
        }
    }

    private buildNode(nodeId: NodeId, address: string, storage: InMemoryNodeStorage): RaftNode {
        const { timerConfig } = this.options;

        const peerMembers = [
            ...this.committedConfig.voters,
            ...this.committedConfig.learners
        ].filter(m => m.id !== nodeId);

        const config = createConfig(
            nodeId,
            address,
            peerMembers,
            timerConfig.electionTimeoutMin,
            timerConfig.electionTimeoutMax,
            timerConfig.heartbeatInterval
        );

        return new RaftNode({
            config,
            storage,
            transport: new MockTransport(nodeId, new SeededRandom(1)),
            stateMachine: new NoOpStateMachine(),
            eventBus: this.bus,
        });
    }

    getCommittedConfig(): CommittedConfig {
        return this.committedConfig;
    }

    isLeader(nodeId: NodeId): boolean {
        const entry = this.entries.get(nodeId);
        return entry !== undefined && entry.node.isStarted() && entry.node.isLeader();
    }
}