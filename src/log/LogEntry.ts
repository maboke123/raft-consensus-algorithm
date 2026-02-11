export interface Command {
  type: string;
  payload: any;
}

export interface LogEntry {
  term: number;
  index: number;
  command: Command;
}

export function validateLogEntry(entry: LogEntry): void {
    if (entry.term < 0) {
        throw new Error(`Invalid term: ${entry.term}. Term must be a non-negative integer.`);
    }

    if (entry.index < 0) {
        throw new Error(`Invalid index: ${entry.index}. Index must be a non-negative integer.`);
    }

    if (!entry.command || typeof entry.command !== 'object') {
        throw new Error(`Invalid command: ${entry.command}. Command must be an object`);
    }

    if (!entry.command.type || typeof entry.command.type !== 'string') {
        throw new Error(`Invalid command type: ${entry.command.type}. Type must be a string`);
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

    return commandsEqual(entry1.command, entry2.command);
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