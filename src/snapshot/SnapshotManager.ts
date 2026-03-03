import { Storage, StorageCodec } from "../storage/Storage";
import { StorageError } from "../util/Error";

export interface SnapshotMetaData {
    lastIncludedIndex: number;
    lastIncludedTerm: number;
}

export interface Snapshot extends SnapshotMetaData {
    data: Buffer;
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

        if (!dataBuffer) {
            return null;
        }

        return {
            lastIncludedIndex: this.cachedIndex,
            lastIncludedTerm: this.cachedTerm,
            data: dataBuffer
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