import { LogEntry } from './LogEntry';

export interface LogManagerInterface {
    initialize(): Promise<void>;
    appendEntry(entry: LogEntry): Promise<number>;
    appendEntries(entries: LogEntry[]): Promise<number>;
    getEntry(index: number): Promise<LogEntry | null>;
    getEntries(fromIndex: number, toIndex: number): Promise<LogEntry[]>;
    getLastEntry(): Promise<LogEntry | null>;
    getLastIndex(): number;
    getLastTerm(): number;
    deleteEntriesFrom(index: number): Promise<void>;
    clear(): Promise<void>;
}