import { LogEntry, validateLogEntry, Command } from './LogEntry';
import { StorageError, LogInconsistencyError } from '../util/Error';
import { Storage, StorageOperation, StorageCodec } from '../storage/Storage';


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
}

const LOG_ENTRY_PREFIX = "raft:log:";
const LAST_INDEX_KEY = "raft:log:lastIndex";
const LAST_TERM_KEY = "raft:log:lastTerm";

export class LogManager implements LogManagerInterface {

    private lastIndex: number = 0;
    private lastTerm: number = 0;
    private initialized: boolean = false;

    constructor(private readonly storage: Storage,) {
        if (!storage.isOpen()) {
            throw new StorageError('Storage must be open before creating LogManager');
        }
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            throw new LogInconsistencyError('LogManager is already initialized');
        }

        await this.safeStorage(async () => {
            const lastIndexBuf = await this.storage.get(LAST_INDEX_KEY);
            const lastTermBuf = await this.storage.get(LAST_TERM_KEY);
            this.lastIndex = lastIndexBuf ? StorageCodec.decodeNumber(lastIndexBuf) : 0;
            this.lastTerm = lastTermBuf ? StorageCodec.decodeNumber(lastTermBuf) : 0;

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
            const operation: StorageOperation[] = [
                {
                    type: 'set',
                    key: this.makeLogKey(entry.index),
                    value: StorageCodec.encodeJSON(entry)
                },
                {
                    type: 'set',
                    key: LAST_INDEX_KEY,
                    value: StorageCodec.encodeNumber(entry.index)
                },
                {
                    type: 'set',
                    key: LAST_TERM_KEY,
                    value: StorageCodec.encodeNumber(entry.term)
                }
            ];

            await this.storage.batch(operation);

            this.lastIndex = entry.index;
            this.lastTerm = entry.term;
        }, `appendEntry (${entry.index})`);

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

        await this.safeStorage(async () => {
            const operation: StorageOperation[] = [];

            for (const entry of entries) {
                validateLogEntry(entry);

                operation.push({
                    type: 'set',
                    key: this.makeLogKey(entry.index),
                    value: StorageCodec.encodeJSON(entry)
                });
            }

            const lastEntry = entries[entries.length - 1];

            operation.push({
                type: 'set',
                key: LAST_INDEX_KEY,
                value: StorageCodec.encodeNumber(lastEntry.index)
            });
            operation.push({
                type: 'set',
                key: LAST_TERM_KEY,
                value: StorageCodec.encodeNumber(lastEntry.term)
            });

            await this.storage.batch(operation);

            this.lastIndex = lastEntry.index;
            this.lastTerm = lastEntry.term;
        }, `appendEntries (${entries.length} entries)`);

        return this.lastIndex;
    }

    async getEntry(index: number): Promise<LogEntry | null> {
        this.ensureInitialized();

        if (index < 1 || index > this.lastIndex) {
            return null;
        }

        return await this.safeStorage(async () => {
            const entryBuf = await this.storage.get(this.makeLogKey(index));
            const entry = entryBuf ? StorageCodec.decodeJSON<LogEntry>(entryBuf) : null;
            return entry;
        }, `getEntry (${index})`);
    }

    async getEntries(fromIndex: number, toIndex: number): Promise<LogEntry[]> {
        this.ensureInitialized();

        if (fromIndex < 1 || toIndex > this.lastIndex || fromIndex > toIndex) {
            throw new LogInconsistencyError(`Invalid index range: from ${fromIndex} to ${toIndex}`);
        }

        const entries: LogEntry[] = [];

        for (let i = fromIndex; i <= toIndex; i++) {
            const entry = await this.getEntry(i);
            if (!entry) {
                throw new LogInconsistencyError(`Missing log entry at index ${i}`);
            }
            entries.push(entry);
        }

        return entries;
    }

    getFirstIndex(): number {
        this.ensureInitialized();
        if (this.lastIndex === 0) {
            throw new LogInconsistencyError('No log entries found');
        }
        return 1;
    }

    async getTermAtIndex(index: number): Promise<number | null> {
        this.ensureInitialized();

        const entry = await this.getEntry(index);
        return entry ? entry.term : null;
    }

    async hasMatchingEntry(index: number, term: number): Promise<boolean> {
        this.ensureInitialized();

        if (index === 0) {
            return true;
        }

        const entry = await this.getEntry(index);
        return entry !== null && entry.term === term;
    }

    async getLastEntry(): Promise<LogEntry | null> {
        this.ensureInitialized();

        if (this.lastIndex === 0) {
            return null;
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

        if (index < 1) {
            throw new LogInconsistencyError(`Cannot delete from index ${index} as it is less than 1`);
        }

        if (index > this.lastIndex) {
            throw new LogInconsistencyError(`Cannot delete from index ${index} as it is beyond last index ${this.lastIndex}`);
        }

        await this.safeStorage(async () => {
            const operation: StorageOperation[] = [];

            for (let i = index; i <= this.lastIndex; i++) {
                operation.push({
                    type: 'delete',
                    key: this.makeLogKey(i)
                });
            }

            const newLastIndex = index - 1;

            if (newLastIndex === 0) {
                operation.push({
                    type: 'delete',
                    key: LAST_INDEX_KEY
                });

                operation.push({
                    type: 'delete',
                    key: LAST_TERM_KEY
                });

                this.lastTerm = 0;

            } else {
                const prevEntry = await this.getEntry(newLastIndex);

                this.lastTerm = prevEntry ? prevEntry.term : 0;

                operation.push({
                    type: 'set',
                    key: LAST_INDEX_KEY,
                    value: StorageCodec.encodeNumber(newLastIndex)
                });
                
                operation.push({
                    type: 'set',
                    key: LAST_TERM_KEY,
                    value: StorageCodec.encodeNumber(this.lastTerm)
                });
            }

            await this.storage.batch(operation);

            this.lastIndex = newLastIndex;

        }, `deleteEntriesFrom (${index})`);
    }

    async clear(): Promise<void> {
        this.ensureInitialized();

        if (this.lastIndex === 0) {
            return;
        }

        /*
        await this.safeStorage(async () => {
            const operation: StorageOperation[] = [];
            for (let i = 1; i <= this.lastIndex; i++) {
                operation.push({
                    type: 'delete',
                    key: this.makeLogKey(i)
                });
            }

            operation.push({
                type: 'delete',
                key: LAST_INDEX_KEY
            });

            operation.push({
                type: 'delete',
                key: LAST_TERM_KEY
            });

            await this.storage.batch(operation);

            this.lastIndex = 0;
            this.lastTerm = 0;
        }, 'clear');
        */

        await this.deleteEntriesFrom(1);
    }

    async getEntriesFromIndex(index: number): Promise<LogEntry[]> {
        this.ensureInitialized();

        if (index < 1) {
            throw new LogInconsistencyError(`Invalid fromIndex: ${index} is less than 1`);
        }

        if (index > this.lastIndex) {
            return [];
        }

        return await this.getEntries(index, this.lastIndex + 1);
    }

    async appendEntriesFrom(prevLogIndex: number, entries: LogEntry[]): Promise<number> {
        this.ensureInitialized();

        if (entries.length === 0) {
            return this.lastIndex;
        }

        await this.deleteEntriesFrom(prevLogIndex + 1);

        if (this.lastIndex !== prevLogIndex) {
            throw new LogInconsistencyError(`After deleting entries from index ${prevLogIndex + 1}, last index is ${this.lastIndex} but expected ${prevLogIndex}`);
        }

        return await this.appendEntries(entries);
    }

    async matchesPrevLog(prevLogIndex: number, prevLogTerm: number): Promise<boolean> {
        this.ensureInitialized();

        if (prevLogIndex === 0) {
            return prevLogTerm === 0;
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

        while (conflictIndex > 1) {
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
            command: command
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

    
    private makeLogKey(index: number): string {
        return `${LOG_ENTRY_PREFIX}${index.toString().padStart(16, '0')}`;
    }

}