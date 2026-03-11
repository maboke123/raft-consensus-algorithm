import { NodeId } from "../core/Config";
import { Storage, StorageCodec } from "../storage/Storage";
import { StorageError } from "../util/Error";
import { ClusterConfig, clusterConfigsEqual, ClusterMember, getQuorumSize, isLearner, isVoter } from "./ClusterConfig";

export const CONFIG_VOTERS_KEY = "raft:config:voters";
export const CONFIG_LEARNERS_KEY = "raft:config:learners";

export interface ConfigManagerInterface {
    applyConfigEntry(config: ClusterConfig): void;
    commitConfig(config: ClusterConfig): Promise<void>;
    getActiveConfig(): ClusterConfig;
    getCommittedConfig(): ClusterConfig;
    getVoters(): NodeId[];
    getLearners(): NodeId[];
    getAllPeers(selfId: NodeId): NodeId[];
    getQuorumSize(): number;
    isVoter(nodeId: NodeId): boolean;
    isLearner(nodeId: NodeId): boolean;
    hasPendingChange(): boolean;
}

export class ConfigManager implements ConfigManagerInterface {
    private activeConfig: ClusterConfig
    private committedConfig: ClusterConfig;
    private initialized: boolean = false;

    constructor(
        private readonly storage: Storage,
        initialConfig: ClusterConfig
    ) {
        this.activeConfig = initialConfig;
        this.committedConfig = initialConfig;
    }

    async initialize(): Promise<ClusterConfig | null> {
        if (this.initialized) {
            return this.committedConfig;
        }

        const votersBuffer = await this.storage.get(CONFIG_VOTERS_KEY);
        const learnersBuffer = await this.storage.get(CONFIG_LEARNERS_KEY);

        if (!votersBuffer || !learnersBuffer) {
            this.initialized = true;
            return null;
        }

        const voters = StorageCodec.decodeJSON<ClusterMember[]>(votersBuffer);
        const learners = StorageCodec.decodeJSON<ClusterMember[]>(learnersBuffer);

        const persistedConfig: ClusterConfig = { voters, learners };
        this.activeConfig = persistedConfig;
        this.committedConfig = persistedConfig;
        this.initialized = true;

        return persistedConfig;
    }

    applyConfigEntry(config: ClusterConfig): void {
        this.ensureInitialized();
        this.activeConfig = config;
    }

    async commitConfig(config: ClusterConfig): Promise<void> {
        this.ensureInitialized();

        await this.storage.batch([
            {
                type: "set",
                key: CONFIG_VOTERS_KEY,
                value: StorageCodec.encodeJSON(config.voters)
            },
            {
                type: "set",
                key: CONFIG_LEARNERS_KEY,
                value: StorageCodec.encodeJSON(config.learners)
            }
        ]);

        this.committedConfig = config;
    }

    getActiveConfig(): ClusterConfig {
        this.ensureInitialized();
        return this.activeConfig;
    }

    getCommittedConfig(): ClusterConfig {
        this.ensureInitialized();
        return this.committedConfig;
    }

    getVoters(): NodeId[] {
        this.ensureInitialized();
        return this.activeConfig.voters.map(v => v.id);
    }

    getLearners(): NodeId[] {
        this.ensureInitialized();
        return this.activeConfig.learners.map(l => l.id);
    }

    getAllPeers(selfId: NodeId): NodeId[] {
        this.ensureInitialized();
        return [...this.activeConfig.voters, ...this.activeConfig.learners]
            .map(m => m.id)
            .filter(id => id !== selfId);
    }

    getMemberAddress(nodeId: NodeId): string | null {
        this.ensureInitialized();
        const member = [...this.activeConfig.voters, ...this.activeConfig.learners]
            .find(m => m.id === nodeId);
        return member?.address ?? null;
    }

    getAllMembers(): ClusterMember[] {
        this.ensureInitialized();
        return [...this.activeConfig.voters, ...this.activeConfig.learners];
    }

    getQuorumSize(): number {
        this.ensureInitialized();
        return getQuorumSize(this.activeConfig);
    }

    isVoter(nodeId: NodeId): boolean {
        this.ensureInitialized();
        return isVoter(this.activeConfig, nodeId);
    }

    isLearner(nodeId: NodeId): boolean {
        this.ensureInitialized();
        return isLearner(this.activeConfig, nodeId);
    }

    hasPendingChange(): boolean {
        this.ensureInitialized();
        return !clusterConfigsEqual(this.activeConfig, this.committedConfig);
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new StorageError("ConfigManager is not initialized. Call initialize() before using.");
        }
    }
}