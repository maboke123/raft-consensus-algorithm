import { LogEntry, validateLogEntry, Command, LogEntryType } from './LogEntry';
import { StorageError, LogInconsistencyError } from '../util/Error';
import { LogStorage } from '../storage/interfaces/LogStorage';
import { RaftEventBus } from '../events/RaftEvents';
import { NoOpEventBus } from '../events/EventBus';
import { NodeId } from '../core/Config';
import { ClusterConfig } from '../config/ClusterConfig';

export interface LogManagerInterface {
    initialize(): Promise<void>;
    appendEntry(entry: LogEntry): Promise<number>;
    appendEntries(entries: LogEntry[]): Promise<number>;
    getEntry(index: number): Promise<LogEntry | null>;
    getEntries(fromIndex: number, toIndex: number): Promise<LogEntry[]>;
    getFirstIndex(): number;
    getTermAtIndex(index: number): Promise<number | null>;
    hasMatchingEntry(index: number, term: number): Promise<boolean>;
    getLastEntry(): Promise<LogEntry | null>;
    getLastIndex(): number;
    getLastTerm(): number;
    deleteEntriesFrom(index: number): Promise<void>;
    clear(): Promise<void>;
    discardEntriesUpTo(index: number, term: number): Promise<void>;
}

export class LogManager implements LogManagerInterface {

    private lastIndex: number = 0;
    private lastTerm: number = 0;
    private snapshotIndex: number = 0;
    private snapshotTerm: number = 0;
    private initialized: boolean = false;

    constructor(
        private readonly logStorage: LogStorage,
        private readonly eventBus: RaftEventBus = new NoOpEventBus(),
        private readonly nodeId: NodeId | null = null
    ) {}

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        await this.safeStorage(async () => {
            const meta = await this.logStorage.readMeta();
            this.lastIndex = meta.lastIndex;
            this.lastTerm = meta.lastTerm;
            this.snapshotIndex = meta.snapshotIndex;
            this.snapshotTerm = meta.snapshotTerm;
            this.initialized = true;
        }, 'initialize');
    }

    async appendEntry(entry: LogEntry): Promise<number> {
        this.ensureInitialized();

        validateLogEntry(entry);

        if (entry.index !== this.lastIndex + 1) {
            throw new LogInconsistencyError(`Entry index ${entry.index} does not match expected index ${this.lastIndex + 1}`);
        }

        await this.safeStorage(async () => {
            await this.logStorage.append([entry]);
            this.lastIndex = entry.index;
            this.lastTerm = entry.term;
        }, `appendEntry (${entry.index})`);

        if (this.nodeId) {
            this.eventBus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.nodeId,
                type: 'LogAppended',
                entries: [entry],
                term: entry.term,
            });
        }

        return entry.index;
    }

    async appendEntries(entries: LogEntry[]): Promise<number> {
        this.ensureInitialized();

        if (entries.length === 0) {
            return this.lastIndex;
        }

        for (let i = 0; i < entries.length; i++) {
            const expectedIndex = this.lastIndex + 1 + i;
            if (entries[i].index !== expectedIndex) {
                throw new LogInconsistencyError(`Entry index ${entries[i].index} does not match expected index ${expectedIndex}`);
            }
        }

        for (const entry of entries) {
            validateLogEntry(entry);
        }

        const lastEntry = entries[entries.length - 1];

        await this.safeStorage(async () => {
            await this.logStorage.append(entries);
            this.lastIndex = lastEntry.index;
            this.lastTerm = lastEntry.term;
        }, `appendEntries (${entries.length} entries)`);

        if (this.nodeId) {
            this.eventBus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.nodeId,
                type: 'LogAppended',
                entries: entries,
                term: lastEntry.term,
            });
        }

        return this.lastIndex;
    }

    async getEntry(index: number): Promise<LogEntry | null> {
        this.ensureInitialized();

        if (index <= this.snapshotIndex || index > this.lastIndex) {
            return null;
        }

        return await this.safeStorage(async () => {
            return await this.logStorage.getEntry(index);
        }, `getEntry (${index})`);
    }

    async getEntries(fromIndex: number, toIndex: number): Promise<LogEntry[]> {
        this.ensureInitialized();

        if (fromIndex <= this.snapshotIndex || toIndex > this.lastIndex || fromIndex > toIndex) {
            throw new LogInconsistencyError(`Invalid index range: from ${fromIndex} to ${toIndex}`);
        }

        return await this.safeStorage(async () => {
            return await this.logStorage.getEntries(fromIndex, toIndex);
        }, `getEntries (${fromIndex} to ${toIndex})`);
    }

    getFirstIndex(): number {
        this.ensureInitialized();
        if (this.lastIndex === 0 && this.snapshotIndex === 0) {
            throw new LogInconsistencyError('No log entries found');
        }
        return this.snapshotIndex + 1;
    }

    async getTermAtIndex(index: number): Promise<number | null> {
        this.ensureInitialized();

        if (index === this.snapshotIndex) {
            return this.snapshotTerm;
        }

        const entry = await this.getEntry(index);
        return entry ? entry.term : null;
    }

    async hasMatchingEntry(index: number, term: number): Promise<boolean> {
        this.ensureInitialized();

        if (index === 0) {
            return true;
        }

        if (index === this.snapshotIndex) {
            return this.snapshotTerm === term;
        }

        if (index < this.snapshotIndex) {
            return false;
        }

        const entry = await this.getEntry(index);
        return entry !== null && entry.term === term;
    }

    async getLastEntry(): Promise<LogEntry | null> {
        this.ensureInitialized();

        if (this.lastIndex === 0) {
            return null;
        }

        if (this.lastIndex === this.snapshotIndex) {
            return null
        }

        return await this.getEntry(this.lastIndex);
    }

    getLastIndex(): number {
        this.ensureInitialized();
        return this.lastIndex;
    }

    getLastTerm(): number {
        this.ensureInitialized();
        return this.lastTerm;
    }

    async deleteEntriesFrom(index: number): Promise<void> {
        this.ensureInitialized();

        if (index <= this.snapshotIndex) {
            throw new LogInconsistencyError(`Cannot delete from index ${index} as it is less than or equal to snapshot index ${this.snapshotIndex}`);
        }

        if (index > this.lastIndex) {
            throw new LogInconsistencyError(`Cannot delete from index ${index} as it is beyond last index ${this.lastIndex}`);
        }

        await this.safeStorage(async () => {
            await this.logStorage.truncateFrom(index);

            const meta = await this.logStorage.readMeta();
            this.lastIndex = meta.lastIndex;
            this.lastTerm = meta.lastTerm;
        }, `deleteEntriesFrom (${index})`);
    }

    async clear(): Promise<void> {
        this.ensureInitialized();

        if (this.lastIndex <= this.snapshotIndex) {
            return;
        }

        await this.deleteEntriesFrom(this.snapshotIndex + 1);
    }

    async getEntriesFromIndex(index: number): Promise<LogEntry[]> {
        this.ensureInitialized();

        if (index <= this.snapshotIndex) {
            throw new LogInconsistencyError(`Invalid fromIndex: ${index} is less than or equal to snapshot index ${this.snapshotIndex}`);
        }

        if (index > this.lastIndex) {
            return [];
        }

        return await this.getEntries(index, this.lastIndex);
    }

    async appendEntriesFrom(prevLogIndex: number, entries: LogEntry[]): Promise<number> {
        this.ensureInitialized();

        if (entries.length === 0) {
            return this.lastIndex;
        }

        let truncateFromIndex: number | null = null;
        for (const newEntry of entries) {
            const existing = await this.getEntry(newEntry.index);

            if (existing === null) {
                break;
            }

            if (existing.term !== newEntry.term) {
                truncateFromIndex = newEntry.index;
                break;
            }
        }

        if (truncateFromIndex !== null) {

            if (this.nodeId) {
                this.eventBus.emit({
                    eventId: crypto.randomUUID(),
                    timestamp: performance.now(),
                    wallTime: Date.now(),
                    nodeId: this.nodeId,
                    type: 'LogConflictResolved',
                    newEntries: entries,
                    truncatedFromIndex: truncateFromIndex,
                    term: entries[0].term,
                });
            }

            await this.deleteEntriesFrom(truncateFromIndex);
        }

        const toAppend = entries.filter(e => e.index > this.lastIndex);

        if (toAppend.length === 0) {
            return this.lastIndex;
        }

        return await this.appendEntries(toAppend);
    }

    async matchesPrevLog(prevLogIndex: number, prevLogTerm: number): Promise<boolean> {
        this.ensureInitialized();

        if (prevLogIndex === 0) {
            return prevLogTerm === 0;
        }

        if (prevLogIndex === this.snapshotIndex) {
            return this.snapshotTerm === prevLogTerm;
        }

        const entry = await this.getEntry(prevLogIndex);

        if (!entry) {
            return false;
        }

        return entry.term === prevLogTerm;
    }

    async getConflictInfo(prevLogIndex: number): Promise<{ conflictIndex: number, conflictTerm: number }> {
        this.ensureInitialized();

        if (prevLogIndex > this.lastIndex) {
            return { conflictIndex: this.lastIndex + 1, conflictTerm: 0 };
        }

        const entryConflict = await this.getEntry(prevLogIndex);

        if (!entryConflict) {
            return { conflictIndex: this.lastIndex + 1, conflictTerm: 0 };
        }

        const conflictTerm = entryConflict.term;

        let conflictIndex = prevLogIndex;

        while (conflictIndex > this.snapshotIndex + 1) {
            const entry = await this.getEntry(conflictIndex - 1);
            if (!entry || entry.term !== conflictTerm) {
                break;
            }
            conflictIndex--;
        }

        return { conflictIndex, conflictTerm };
    }

    async appendCommand(command: Command, term: number): Promise<number> {

        const idx = this.lastIndex + 1;

        const entry: LogEntry = {
            index: idx,
            term: term,
            type: LogEntryType.COMMAND,
            command: command
        };

        await this.appendEntry(entry);

        return idx;
    }

    async discardEntriesUpTo(index: number, term: number): Promise<void> {
        this.ensureInitialized();

        if (index <= this.snapshotIndex) {
            return;
        }

        if (index > this.lastIndex) {
            throw new LogInconsistencyError(`Cannot discard up to index ${index} as it is beyond last index ${this.lastIndex}`);
        }

        await this.safeStorage(async () => {
            await this.logStorage.compact(index, term);

            const meta = await this.logStorage.readMeta();
            this.snapshotIndex = meta.snapshotIndex;
            this.snapshotTerm = meta.snapshotTerm;
            this.lastIndex = meta.lastIndex;
            this.lastTerm = meta.lastTerm;
        }, `discardEntriesUpTo (${index})`);
    }

    async resetToSnapshot(snapshotIndex: number, snapshotTerm: number): Promise<void> {
        this.ensureInitialized();

        await this.safeStorage(async () => {
            await this.logStorage.reset(snapshotIndex, snapshotTerm);

            this.snapshotIndex = snapshotIndex;
            this.snapshotTerm = snapshotTerm;
            this.lastIndex = snapshotIndex;
            this.lastTerm = snapshotTerm;
        }, `resetToSnapshot (${snapshotIndex})`);
    }

    getSnapshotIndex(): number {
        this.ensureInitialized();
        return this.snapshotIndex;
    }

    async appendConfigEntry(config: ClusterConfig, term: number): Promise<number> {

        const idx = this.lastIndex + 1;

        const entry: LogEntry = {
            index: idx,
            term: term,
            type: LogEntryType.CONFIG,
            config: config
        };

        await this.appendEntry(entry);

        return idx;
    }

    async getLastConfigEntry(): Promise<ClusterConfig | null> {
        this.ensureInitialized();

        for (let i = this.lastIndex; i > this.snapshotIndex; i--) {
            const entry = await this.getEntry(i);
            if (entry && entry.type === LogEntryType.CONFIG && entry.config) {
                return entry.config;
            }
        }

        return null;
    }

    async appendNoOpEntry(term: number): Promise<number> {

        const idx = this.lastIndex + 1;
        
        const entry: LogEntry = {
            index: idx,
            term: term,
            type: LogEntryType.NOOP
        };

        await this.appendEntry(entry);

        return idx;
    }

    private async safeStorage<T>(fn : () => Promise<T>, context: string): Promise<T> {
        try {
            return await fn();
        } catch (err) {
            if (err instanceof StorageError || err instanceof LogInconsistencyError) {
                throw err;
            }
            throw new StorageError(`Storage operation failed in context: ${context}`, err as Error);
        }

    }

    private ensureInitialized() {
        if (!this.initialized) {
            throw new StorageError('LogManager is not initialized');
        }
    }

}