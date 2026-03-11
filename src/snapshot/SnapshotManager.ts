import { Storage, StorageCodec } from "../storage/Storage";
import { StorageError } from "../util/Error";
import { ClusterConfig } from "../config/ClusterConfig";
import { NodeId } from "../core/Config";

export interface SnapshotMetaData {
    lastIncludedIndex: number;
    lastIncludedTerm: number;
}

export interface Snapshot extends SnapshotMetaData {
    data: Buffer;
    config: ClusterConfig;
}

export interface SnapshotManagerInterface {
    saveSnapshot(snapshot: Snapshot): Promise<void>;
    loadSnapshot(): Promise<Snapshot | null>;
    hasSnapshot(): boolean;
    getSnapshotMetadata(): SnapshotMetaData | null;
}

export const SNAPSHOT_INDEX_KEY = "raft:log:snapshot:index";
export const SNAPSHOT_TERM_KEY = "raft:log:snapshot:term";
export const SNAPSHOT_DATA_KEY = "raft:log:snapshot:data";
export const SNAPSHOT_VOTERS_KEY = "raft:log:snapshot:config:voters";
export const SNAPSHOT_LEARNERS_KEY = "raft:log:snapshot:config:learners";

export class SnapshotManager implements SnapshotManagerInterface {

    private cachedIndex: number = 0;
    private cachedTerm: number = 0;
    private initialized: boolean = false;

    constructor(
        private readonly storage: Storage
    ) {}

    async initialize(): Promise<SnapshotMetaData | null> {
        if (this.initialized) {
            return this.cachedIndex > 0
                ? { lastIncludedIndex: this.cachedIndex, lastIncludedTerm: this.cachedTerm }
                : null;
        }

        const indexBuffer = await this.storage.get(SNAPSHOT_INDEX_KEY);
        const termBuffer = await this.storage.get(SNAPSHOT_TERM_KEY);

        if (!indexBuffer || !termBuffer) {
            this.initialized = true;
            return null;
        }

        this.cachedIndex = StorageCodec.decodeNumber(indexBuffer);
        this.cachedTerm = StorageCodec.decodeNumber(termBuffer);
        this.initialized = true;

        return { lastIncludedIndex: this.cachedIndex, lastIncludedTerm: this.cachedTerm };
    }

    async saveSnapshot(snapshot: Snapshot): Promise<void> {
        this.ensureInitialized();

        await this.storage.batch([
            {
                type: "set",
                key: SNAPSHOT_INDEX_KEY,
                value: StorageCodec.encodeNumber(snapshot.lastIncludedIndex)
            },
            {
                type: "set",
                key: SNAPSHOT_TERM_KEY,
                value: StorageCodec.encodeNumber(snapshot.lastIncludedTerm)
            },
            {
                type: "set",
                key: SNAPSHOT_DATA_KEY,
                value: snapshot.data
            },
            {
                type: "set",
                key: SNAPSHOT_VOTERS_KEY,
                value: StorageCodec.encodeJSON(snapshot.config.voters)
            },
            {
                type: "set",
                key: SNAPSHOT_LEARNERS_KEY,
                value: StorageCodec.encodeJSON(snapshot.config.learners)
            }
        ]);

        this.cachedIndex = snapshot.lastIncludedIndex;
        this.cachedTerm = snapshot.lastIncludedTerm;
    }

    async loadSnapshot(): Promise<Snapshot | null> {
        this.ensureInitialized();

        if (this.cachedIndex === 0) {
            return null;
        }

        const dataBuffer = await this.storage.get(SNAPSHOT_DATA_KEY);
        const votersBuffer = await this.storage.get(SNAPSHOT_VOTERS_KEY);
        const learnersBuffer = await this.storage.get(SNAPSHOT_LEARNERS_KEY);

        if (!dataBuffer || !votersBuffer || !learnersBuffer) {
            return null;
        }

        const config: ClusterConfig = {
            voters: StorageCodec.decodeJSON<NodeId[]>(votersBuffer),
            learners: StorageCodec.decodeJSON<NodeId[]>(learnersBuffer)
        };

        return {
            lastIncludedIndex: this.cachedIndex,
            lastIncludedTerm: this.cachedTerm,
            data: dataBuffer,
            config: config
        };
    }

    hasSnapshot(): boolean {
        this.ensureInitialized();
        return this.cachedIndex > 0;
    }

    getSnapshotMetadata(): SnapshotMetaData | null {
        this.ensureInitialized();
        return this.cachedIndex > 0 ? { lastIncludedIndex: this.cachedIndex, lastIncludedTerm: this.cachedTerm } : null;
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new StorageError("SnapshotManager is not initialized. Call initialize() before using.");
        }
    }
}