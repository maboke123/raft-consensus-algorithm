import { LogEntry, validateLogEntry } from './LogEntry';
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
            return;
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