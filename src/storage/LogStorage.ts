import { LogEntry } from "../log/LogEntry";

export interface LogStorageMeta {
    snapshotIndex: number;
    snapshotTerm: number;
    lastIndex: number;
    lastTerm: number;
}

export interface LogStorage {
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): boolean;

    readMeta(): Promise<LogStorageMeta>;

    append(entries: LogEntry[]): Promise<void>;

    getEntry(index: number): Promise<LogEntry | null>;

    getEntries(from: number, to: number): Promise<LogEntry[]>;

    truncateFrom(index: number): Promise<void>;

    compact(upToIndex: number, term: number): Promise<void>;
    
    reset(snapshotIndex: number, snapshotTerm: number): Promise<void>;
}
