import { SnapshotManager, SNAPSHOT_DATA_KEY, SNAPSHOT_INDEX_KEY, SNAPSHOT_TERM_KEY } from './SnapshotManager';
import { Storage, StorageCodec } from '../storage/Storage';
import { StorageError } from '../util/Error';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SnapshotManager.ts, SnapshotManager', () => {
    let snapshotManager: SnapshotManager;
    let storage: Storage;

    const snapshot = {
        lastIncludedIndex: 10,
        lastIncludedTerm: 3,
        data: Buffer.from("test data")
    };

    beforeEach(() => {
        storage = {
            get: vi.fn().mockResolvedValue(null),
            set: vi.fn().mockResolvedValue(undefined),
            batch: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined)
        } as any

        snapshotManager = new SnapshotManager(storage);
    });

    it('returns null when neither index nor term exists in storage', async () => {
        const result = await snapshotManager.initialize();
        expect(result).toBeNull();
        expect(storage.get).toHaveBeenCalledWith(SNAPSHOT_INDEX_KEY);
        expect(storage.get).toHaveBeenCalledWith(SNAPSHOT_TERM_KEY);
    });

    it('returns null when only the index key exists in storage', async () => {
        vi.mocked(storage.get).mockImplementation(async (key) => {
            if (key === SNAPSHOT_INDEX_KEY) {
                return StorageCodec.encodeNumber(5);
            }
            return null;
        });

        expect(await snapshotManager.initialize()).toBeNull();
    });

    it('returns null when only the term key exists in storage', async () => {
        vi.mocked(storage.get).mockImplementation(async (key) => {
            if (key === SNAPSHOT_TERM_KEY) {
                return StorageCodec.encodeNumber(2);
            }
            return null;
        });

        expect(await snapshotManager.initialize()).toBeNull();
    });

    it('returns snapshot metadata when both index and term exist in storage', async () => {
        vi.mocked(storage.get).mockImplementation(async (key) => {
            if (key === SNAPSHOT_INDEX_KEY) {
                return StorageCodec.encodeNumber(10);
            }
            if (key === SNAPSHOT_TERM_KEY) {
                return StorageCodec.encodeNumber(3);
            }
            return null;
        });

        const result = await snapshotManager.initialize();
        expect(result).toEqual({ lastIncludedIndex: 10, lastIncludedTerm: 3 });
    });

    it('does not call storage again on a second initialize call', async () => {
        vi.mocked(storage.get).mockImplementation(async (key) => {
            if (key === SNAPSHOT_INDEX_KEY) {
                return StorageCodec.encodeNumber(10);
            }
            if (key === SNAPSHOT_TERM_KEY) {
                return StorageCodec.encodeNumber(3);
            }
            return null;
        });

        await snapshotManager.initialize();
        const result = await snapshotManager.initialize();
        expect(result).toEqual({ lastIncludedIndex: 10, lastIncludedTerm: 3 });
        expect(storage.get).toHaveBeenCalledTimes(2);
    });

    it('returns null on repeted initialize when no snapshot was found', async () => {
        await snapshotManager.initialize();
        const result = await snapshotManager.initialize();
        expect(result).toBeNull();
    });

    it('throws StorageError if called before initialization', async () => {
        await expect(snapshotManager.saveSnapshot(snapshot)).rejects.toThrow(StorageError);
    });

    it('writes index, term and data via a single batch operation', async () => {
        await snapshotManager.initialize();
        await snapshotManager.saveSnapshot(snapshot);

        expect(storage.batch).toHaveBeenCalledOnce();
        expect(storage.batch).toHaveBeenCalledWith([
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
    });

    it('updated the cached index and term after saving a snapshot', async () => {
        await snapshotManager.initialize();
        await snapshotManager.saveSnapshot(snapshot);

        expect(snapshotManager.hasSnapshot()).toBe(true);
        expect(snapshotManager.getSnapshotMetadata()).toEqual({ lastIncludedIndex: snapshot.lastIncludedIndex, lastIncludedTerm: snapshot.lastIncludedTerm });
    });

    it('overwrites a previous snapshot', async () => {
        await snapshotManager.initialize();
        await snapshotManager.saveSnapshot(snapshot);

        const newSnapshot = {
            lastIncludedIndex: 20,
            lastIncludedTerm: 5,
            data: Buffer.from("new test data")
        };

        await snapshotManager.saveSnapshot(newSnapshot);

        expect(snapshotManager.getSnapshotMetadata()).toEqual({ lastIncludedIndex: newSnapshot.lastIncludedIndex, lastIncludedTerm: newSnapshot.lastIncludedTerm });
    });

    it('throws StorageError if loadSnapshot is called before initialization', async () => {
        await expect(snapshotManager.loadSnapshot()).rejects.toThrow(StorageError);
    });

    it('returns null if no snapshot exists', async () => {
        await snapshotManager.initialize();
        const result = await snapshotManager.loadSnapshot();
        expect(result).toBeNull();
    });

    it('returns null when data key is missing in storage even with valid index', async () => {
        vi.mocked(storage.get).mockImplementation(async (key) => {
            if (key === SNAPSHOT_INDEX_KEY) {
                return StorageCodec.encodeNumber(10);
            }
            if (key === SNAPSHOT_TERM_KEY) {
                return StorageCodec.encodeNumber(3);
            }
            return null;
        });

        await snapshotManager.initialize();
        const result = await snapshotManager.loadSnapshot();
        expect(result).toBeNull();
    });

    it('returns the full snapshot when data exists in storage', async () => {
        vi.mocked(storage.get).mockImplementation(async (key) => {
            if (key === SNAPSHOT_INDEX_KEY) {
                return StorageCodec.encodeNumber(10);
            }
            if (key === SNAPSHOT_TERM_KEY) {
                return StorageCodec.encodeNumber(3);
            }
            if (key === SNAPSHOT_DATA_KEY) {
                return Buffer.from("test data");
            }
            return null;
        });

        await snapshotManager.initialize();
        const result = await snapshotManager.loadSnapshot();
        expect(result).toEqual({
            lastIncludedIndex: 10,
            lastIncludedTerm: 3,
            data: Buffer.from("test data")
        });
    });

    it('returns a snapshot that was just saved in the same session', async () => {
        const data = Buffer.from("in-memory");

        await snapshotManager.initialize();

        vi.mocked(storage.get).mockResolvedValue(data);

        await snapshotManager.saveSnapshot(snapshot);
        const result = await snapshotManager.loadSnapshot();
        expect(result).toEqual({
            lastIncludedIndex: snapshot.lastIncludedIndex,
            lastIncludedTerm: snapshot.lastIncludedTerm,
            data
        });
    });

    it('throws StorageError if called before initialization', async () => {
        expect(() => snapshotManager.hasSnapshot()).toThrow(StorageError);
    });

    it('returns false when no snapshot has been saved', async () => {
        await snapshotManager.initialize();
        expect(snapshotManager.hasSnapshot()).toBe(false);
    });

    it('returns true after a snapshot has been saved', async () => {
        await snapshotManager.initialize();
        await snapshotManager.saveSnapshot(snapshot);
        expect(snapshotManager.hasSnapshot()).toBe(true);
    });

    it('returns true when initialized with existing snapshot data from storage', async () => {
        vi.mocked(storage.get).mockImplementation(async (key) => {
            if (key === SNAPSHOT_INDEX_KEY) {
                return StorageCodec.encodeNumber(10);
            }
            if (key === SNAPSHOT_TERM_KEY) {
                return StorageCodec.encodeNumber(3);
            }
            return null;
        });

        await snapshotManager.initialize();
        expect(snapshotManager.hasSnapshot()).toBe(true);
    });

    it('throws StorageError if getSnapshotMetadata is called before initialization', async () => {
        expect(() => snapshotManager.getSnapshotMetadata()).toThrow(StorageError);
    });

    it('returns null when no snapshot metadata exists', async () => {
        await snapshotManager.initialize();
        expect(snapshotManager.getSnapshotMetadata()).toBeNull();
    });

    it('returns snapshot metadata after a snapshot has been saved', async () => {
        await snapshotManager.initialize();
        await snapshotManager.saveSnapshot(snapshot);
        expect(snapshotManager.getSnapshotMetadata()).toEqual({ lastIncludedIndex: snapshot.lastIncludedIndex, lastIncludedTerm: snapshot.lastIncludedTerm });
    });

    it('returns the latest metadata when multiple snapshots have been saved', async () => {
        await snapshotManager.initialize();
        await snapshotManager.saveSnapshot(snapshot);
        const newSnapshot = {
            lastIncludedIndex: 20,
            lastIncludedTerm: 5,
            data: Buffer.from("new test data")
        };
        await snapshotManager.saveSnapshot(newSnapshot);
        expect(snapshotManager.getSnapshotMetadata()).toEqual({ lastIncludedIndex: newSnapshot.lastIncludedIndex, lastIncludedTerm: newSnapshot.lastIncludedTerm });
    });

    it('returns metadata from storage on initialization', async () => {
        vi.mocked(storage.get).mockImplementation(async (key) => {
            if (key === SNAPSHOT_INDEX_KEY) {
                return StorageCodec.encodeNumber(15);
            }
            if (key === SNAPSHOT_TERM_KEY) {
                return StorageCodec.encodeNumber(4);
            }
            return null;
        });

        await snapshotManager.initialize();
        expect(snapshotManager.getSnapshotMetadata()).toEqual({ lastIncludedIndex: 15, lastIncludedTerm: 4 });
    });
});