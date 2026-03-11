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
import { ClusterMember } from "../config/ClusterConfig";
import { StorageCodec } from "../storage/Storage";
import { CONFIG_LEARNERS_KEY, CONFIG_VOTERS_KEY } from "../config/ConfigManager";
import fs from "fs/promises";

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


    private committedConfig: { voters: { id: NodeId, address: string }[], learners: { id: NodeId, address: string }[] } = { voters: [], learners: [] };

    constructor(
        private bus: RaftEventBus,
        private options: ClusterRunnerOptions
    ){}

    async start(): Promise<void> {
        const { nodeCount, timerConfig } = this.options;

        const baseNodeIds: NodeId[] = Array.from({ length: nodeCount }, (_, i) => `node${i+1}`);

        const persistedMembers = await this.readPersistedConfig(baseNodeIds);

        const addressMap: Record<NodeId, string> = {};
        baseNodeIds.forEach((nodeId, index) => {
            addressMap[nodeId] = `localhost:${52000 + index}`;
        });

        if (persistedMembers) {
            for (const m of [...persistedMembers.voters, ...persistedMembers.learners]) {
                addressMap[m.id] = m.address;
            }
        }
        

        const allNodeIds: NodeId[] = persistedMembers
            ? [
                ...persistedMembers.voters.map(m => m.id),
                ...persistedMembers.learners.map(m => m.id)
              ]
            : baseNodeIds;

        this.nodeIds = allNodeIds;

        for (const nodeId of allNodeIds) {
            const address = addressMap[nodeId];
            const port = parseInt(address.split(':')[1]);

            const peerMembers = this.nodeIds
                .filter(id => id !== nodeId)
                .map(id => ({ id, address: addressMap[id] }));

            const config = createConfig(nodeId, address, peerMembers, timerConfig.electionTimeoutMin, timerConfig.electionTimeoutMax, timerConfig.heartbeatInterval);

            const storage = new DiskStorage(path.join(__dirname, "../../data", nodeId));
            await storage.open();

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

        this.committedConfig = persistedMembers ?? {
            voters: baseNodeIds.map(id => ({ id, address: addressMap[id] })),
            learners: []
        };
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

    async addServer(nodeId: NodeId, address: string, asLearner: boolean): Promise<void> {

        if (this.nodes.has(nodeId)) {
            throw new Error(`Node ${nodeId} already exists in the cluster`);
        }

        const port = parseInt(address.split(':')[1]);
        if (isNaN(port)) {
            throw new Error(`Invalid address format: ${address}`);
        }

        const leader = Array.from(this.nodes.values()).find(n => n.isStarted() && n.isLeader());
        if (!leader) {
            throw new Error('No leader available to add server')
        }

        const allCurrentMembers = [
            ...this.committedConfig.voters,
            ...this.committedConfig.learners
        ];

        const peers = Object.fromEntries(
            allCurrentMembers.map(m => [m.id, m.address])
        );

        const peerMembers = allCurrentMembers.map(m => ({id: m.id, address: m.address }));

        const config = createConfig(
            nodeId,
            address,
            peerMembers,
            this.options.timerConfig.electionTimeoutMin,
            this.options.timerConfig.electionTimeoutMax,
            this.options.timerConfig.heartbeatInterval
        );

        const storage = new DiskStorage(path.join(__dirname, "../../data", nodeId));
        await storage.open();

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
            3000
        );

        const node = new RaftNode(
            config,
            storage,
            transport,
            new NoOpStateMachine(),
            new SystemClock(),
            new SystemRandom(),
            undefined,
            this.bus
        );

        this.nodes.set(nodeId, node);
        this.nodeIds.push(nodeId);

        await node.start();

        for (const [existingId, existingNode] of this.nodes) {
            if (existingId !== nodeId && existingNode.isStarted()) {
                await existingNode.registerPeer(nodeId, address);
            }
        }

        const success = await leader.addServer(nodeId, address, asLearner);

        if (!success) {
            this.nodes.delete(nodeId);
            this.nodeIds.pop();
            await node.stop();
            throw new Error(`Failed to add server ${nodeId} to the cluster`);
        }

        const member = { id: nodeId, address };
        
        if (asLearner) {
            this.committedConfig = {
                voters: this.committedConfig.voters,
                learners: [...this.committedConfig.learners, member]
            }
        } else {
            this.committedConfig = {
                voters: [...this.committedConfig.voters, member],
                learners: this.committedConfig.learners
            }
        }
    }

    async removeServer(nodeId: NodeId): Promise<void> {
        const leader = Array.from(this.nodes.values()).find(n => n.isStarted() && n.isLeader());
        if (!leader) {
            throw new Error('No leader available to remove server');
        }
        await leader.removeServer(nodeId);

        const node = this.nodes.get(nodeId);
        if (node && node.isStarted()) {
            await node.stop();
        }

        for (const [existingId, existingNode] of this.nodes) {
            if (existingId !== nodeId && existingNode.isStarted()) {
                await existingNode.removePeer(nodeId);
            }
        }

        this.nodes.delete(nodeId);
        this.nodeIds = this.nodeIds.filter(id => id !== nodeId);
        this.committedConfig = {
            voters: this.committedConfig.voters.filter(m => m.id !== nodeId),
            learners: this.committedConfig.learners.filter(m => m.id !== nodeId)
        };

        const dataDir = path.join(__dirname, "../../data", nodeId);
        await fs.rm(dataDir, { recursive: true, force: true });
    }

    async promoteServer(nodeId: NodeId): Promise<void> {
        const leader = Array.from(this.nodes.values()).find(n => n.isStarted() && n.isLeader());
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

    getCommittedConfig() {
        return this.committedConfig;
    }

    private async readPersistedConfig(
        baseNodeIds: NodeId[]
    ): Promise<{ voters: ClusterMember[]; learners: ClusterMember[] } | null> {
        for (const seedNodeId of baseNodeIds) {
            const storagePath = path.join(__dirname, "../../data", seedNodeId);
            const storage = new DiskStorage(storagePath);
            try {
                await storage.open();
                const votersBuf = await storage.get(CONFIG_VOTERS_KEY);
                const learnersBuf = await storage.get(CONFIG_LEARNERS_KEY);
                await storage.close();
                if (!votersBuf || !learnersBuf) continue;
                const voters = StorageCodec.decodeJSON<ClusterMember[]>(votersBuf);
                const learners = StorageCodec.decodeJSON<ClusterMember[]>(learnersBuf);
                return { voters, learners };
            } catch {
                try { await storage.close(); } catch {}
            }
        }
        return null;
    }
}

