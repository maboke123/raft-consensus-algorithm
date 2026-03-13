import { ClusterConfig } from "../config/ClusterConfig";

export interface Command {
  type: string;
  payload: any;
}

export enum LogEntryType {
    COMMAND = 'COMMAND',
    CONFIG = 'CONFIG',
    NOOP = 'NOOP'
}

export interface LogEntry {
  term: number;
  index: number;
  type: LogEntryType;
  command?: Command;
  config?: ClusterConfig
}

export function validateLogEntry(entry: LogEntry): void {
    if (!Number.isInteger(entry.term) || entry.term < 0) {
        throw new Error(`Invalid term: ${entry.term}. Term must be a non-negative integer.`);
    }

    if (!Number.isInteger(entry.index) || entry.index < 0) {
        throw new Error(`Invalid index: ${entry.index}. Index must be a non-negative integer.`);
    }

    if (entry.type === LogEntryType.COMMAND) {
        if (!entry.command || typeof entry.command !== 'object') {
            throw new Error(`Invalid command: ${entry.command}. Command must be an object`);
        }

        if (!entry.command.type || typeof entry.command.type !== 'string') {
            throw new Error(`Invalid command type: ${entry.command.type}. Type must be a string`);
        }
    } else if (entry.type === LogEntryType.CONFIG) {
        if (!entry.config || typeof entry.config !== 'object') {
            throw new Error(`Invalid config: ${entry.config}. Config must be an object`);
        }

        if (!Array.isArray(entry.config.voters) || !Array.isArray(entry.config.learners)) {
            throw new Error(`Invalid config: ${entry.config}. Voters and learners must be arrays`);
        }
    } else if (entry.type === LogEntryType.NOOP) {
        // no fields
    } else {
        throw new Error(`Invalid log entry type: ${entry.type}. Type must be either COMMAND, CONFIG or NOOP`);
    }
}

export function validateLogSequence(log: LogEntry[]): void {
    if (log.length === 0) {
        return;
    }

    for (let i = 0; i < log.length; i++) {
        const entry = log[i];
        validateLogEntry(entry);

        if (i > 0) {
            const prevEntry = log[i - 1];

            if (entry.index !== prevEntry.index + 1) {
                throw new Error(`Invalid log sequence at index ${i}. Expected index ${prevEntry.index + 1} but got ${entry.index}`);
            };

            if (entry.term < prevEntry.term) {
                throw new Error(`Invalid log sequence at index ${i}. Term must be non-decreasing. Previous term: ${prevEntry.term}, current term: ${entry.term}`);
            };
        }
    }
}

export function commandsEqual(cmd1: Command, cmd2: Command): boolean {
    if (cmd1.type !== cmd2.type) {
        return false;
    }

    const payload1 = JSON.stringify(cmd1.payload);
    const payload2 = JSON.stringify(cmd2.payload);
    return payload1 === payload2;
}

export function entriesEqual(entry1: LogEntry, entry2: LogEntry): boolean {
    if (entry1.term !== entry2.term || entry1.index !== entry2.index) {
        return false;
    }

    if (entry1.type !== entry2.type) {
        return false;
    }

    if (entry1.type === LogEntryType.CONFIG) {
        const config1 = JSON.stringify(entry1.config);
        const config2 = JSON.stringify(entry2.config);
        return config1 === config2;
    }

    if (entry1.type === LogEntryType.NOOP) {
        return true;
    }

    return commandsEqual(entry1.command!, entry2.command!);
}

export function logsEqual(log1: LogEntry[], log2: LogEntry[]): boolean {
    if (log1.length !== log2.length) {
        return false;
    }

    for (let i = 0; i < log1.length; i++) {
        if (!entriesEqual(log1[i], log2[i])) {
            return false;
        }
    }
    return true;
}