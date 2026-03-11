import { describe, it, expect } from "vitest";
import { LogEntry, validateLogEntry, validateLogSequence, commandsEqual, entriesEqual, logsEqual, LogEntryType } from "./LogEntry";

describe('LogEntry.ts, validateLogEntry', () => {

    const validCommand = {
        type: "set",
        payload: { key: "x", value: 10 }
    };

    const validEntry: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const invalidEntry1: LogEntry = {
        term: -1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const invalidEntry2: LogEntry = {
        term: 1.5,
        index: 1,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const invalidEntry3: LogEntry = {
        term: 1,
        index: -1,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const invalidEntry4: LogEntry = {
        term: 1,
        index: 1.5,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const invalidEntry5: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: null as any
    };

    const invalidEntry6: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: { payload: { key: "x", value: 10 } } as any
    };

    const validEntry2: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config: { voters: ["node1", "node2"], learners: [] }
    };

    const invalidEntry7: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config: null as any
    };

    const invalidEntry8: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
    };

    const invalidEntry9: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config : { voters: ["node1", "node2"]} as any
    };

    const invalidEntry10: LogEntry = {
        term: 1,
        index: 1,
        type: "UNKNOWN_TYPE" as any,
        command: validCommand
    };

    it('should validate a correct log entry', () => {
        expect(() => validateLogEntry(validEntry)).not.toThrow();
    });

    it('should throw error for negative term', () => {
        expect(() => validateLogEntry(invalidEntry1)).toThrow("Invalid term: -1. Term must be a non-negative integer.");
    });

    it('should throw error for non-integer term', () => {
        expect(() => validateLogEntry(invalidEntry2)).toThrow("Invalid term: 1.5. Term must be a non-negative integer.");
    });

    it('should throw error for negative index', () => {
        expect(() => validateLogEntry(invalidEntry3)).toThrow("Invalid index: -1. Index must be a non-negative integer.");
    });

    it('should throw error for non-integer index', () => {
        expect(() => validateLogEntry(invalidEntry4)).toThrow("Invalid index: 1.5. Index must be a non-negative integer.");
    });

    it('should throw error for missing command', () => {
        expect(() => validateLogEntry(invalidEntry5)).toThrow("Invalid command: null. Command must be an object");
    });

    it('should throw error for missing command type', () => {
        expect(() => validateLogEntry(invalidEntry6)).toThrow("Invalid command type: undefined. Type must be a string");
    });

    it('should validate a correct config entry', () => {
        expect(() => validateLogEntry(validEntry2)).not.toThrow();
    });

    it('should throw error for missing config', () => {
        expect(() => validateLogEntry(invalidEntry7)).toThrow("Invalid config: null. Config must be an object");
    });

    it('should throw for unknown config field', () => {
        expect(() => validateLogEntry(invalidEntry8)).toThrow("Invalid config: undefined. Config must be an object");
    });

    it('should throw error for missing config field', () => {
        expect(() => validateLogEntry(invalidEntry9)).toThrow("Invalid config: [object Object]. Voters and learners must be arrays");
    });

    it('should throw error for unknown entry type', () => {
        expect(() => validateLogEntry(invalidEntry10)).toThrow("Invalid log entry type: UNKNOWN_TYPE. Type must be either COMMAND or CONFIG");
    });
});

describe('LogEntry.ts, validateLogSequence', () => {
    const validCommand = {
        type: "set",
        payload: { key: "x", value: 10 }
    };

    const validEntry: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const validEntry2: LogEntry = {
        term: 1,
        index: 2,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const validEntry3: LogEntry = {
        term: 2,
        index: 3,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const invalidEntry: LogEntry = {
        term: 1,
        index: 5,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const invalidEntry2: LogEntry = {
        term: 0,
        index: 2,
        type: LogEntryType.COMMAND,
        command: validCommand
    };

    const validEntry4: LogEntry = {
        term: 2,
        index: 2,
        type: LogEntryType.CONFIG,
        config: { voters: ["node1", "node2"], learners: [] }
    };

    const emptyLog: LogEntry[] = [];
    const validLog: LogEntry[] = [validEntry, validEntry2, validEntry3];
    const invalidLog: LogEntry[] = [validEntry, invalidEntry, validEntry3];
    const invalidLog2: LogEntry[] = [validEntry, invalidEntry2, validEntry3];
    const validLog2: LogEntry[] = [validEntry, validEntry4, validEntry3];

    it('should validate a empty log sequence', () => {
        expect(() => validateLogSequence(emptyLog)).not.toThrow();
    });

    it('should validate a correct log sequence', () => {
        expect(() => validateLogSequence(validLog)).not.toThrow();
    });

    it('should throw error for non-sequential indices', () => {
        expect(() => validateLogSequence(invalidLog)).toThrow("Invalid log sequence at index 1. Expected index 2 but got 5");
    });

    it('should throw error for decreasing term', () => {
        expect(() => validateLogSequence(invalidLog2)).toThrow("Invalid log sequence at index 1. Term must be non-decreasing. Previous term: 1, current term: 0");
    });

    it('should validate a correct log sequence with config entry', () => {
        expect(() => validateLogSequence(validLog2)).not.toThrow();
    });
});

describe('LogEntry.ts, commandsEqual', () => {
    const cmd1 = {
        type: "set",
        payload: { key: "x", value: 10 }
    };
    const cmd2 = {
        type: "set",
        payload: { key: "x", value: 10 }
    };
    const cmd3 = {
        type: "set",
        payload: { key: "x", value: 20 }
    };
    const cmd4 = {
        type: "set",
        payload: { key: "y", value: 10 }
    };
    const cmd5 = {
        type: "delete",
        payload: { key: "x" }
    };
    const cmd6 = {
        type: "set",
        payload: { key: "x", value: 10, extra: "data" }
    };
    const cmd7 = {
        type: "set",
        payload: null
    };

    it('should return false for different command types', () => {
        expect(commandsEqual(cmd1, cmd5)).toBe(false);
    });

    it('should return false for different command payloads', () => {
        expect(commandsEqual(cmd1, cmd3)).toBe(false);
    });

    it('should return false for different command payloads', () => {
        expect(commandsEqual(cmd1, cmd4)).toBe(false);
    });

    it('should return false for different command payloads', () => {
        expect(commandsEqual(cmd1, cmd6)).toBe(false);
    });

    it('should return false for different command payloads', () => {
        expect(commandsEqual(cmd1, cmd7)).toBe(false);
    });

    it('should return true for identical commands', () => {
        expect(commandsEqual(cmd1, cmd2)).toBe(true);
    });
});

describe('LogEntry.ts, entriesEqual', () => {
    const cmd1 = {
        type: "set",
        payload: { key: "x", value: 10 }
    };
    const cmd2 = {
        type: "set",
        payload: { key: "x", value: 10 }
    };
    const cmd3 = {
        type: "set",
        payload: { key: "x", value: 20 }
    };
    const entry1: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: cmd1
    };
    const entry2: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: cmd2
    };
    const entry3: LogEntry = {
        term: 2,
        index: 1,
        type: LogEntryType.COMMAND,
        command: cmd1
    };
    const entry4: LogEntry = {
        term: 1,
        index: 2,
        type: LogEntryType.COMMAND,
        command: cmd1
    };
    const entry5: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: cmd3
    };
    const entry6: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config: { voters: ["node1", "node2"], learners: [] }
    };
    const entry7: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config: { voters: ["node1", "node2"], learners: [] }
    };
    const entry8: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config: { voters: ["node1"], learners: [] }
    };

    it('should return false for different terms', () => {
        expect(entriesEqual(entry1, entry3)).toBe(false);
    });

    it('should return false for different indices', () => {
        expect(entriesEqual(entry1, entry4)).toBe(false);
    });

    it('should return false for different commands', () => {
        expect(entriesEqual(entry1, entry5)).toBe(false);
    });

    it('should return true for identical entries', () => {
        expect(entriesEqual(entry1, entry2)).toBe(true);
    });

    it('should return false for entries with different types', () => {
        expect(entriesEqual(entry1, entry6)).toBe(false);
    });

    it('should return true for identical config entries', () => {
        expect(entriesEqual(entry6, entry7)).toBe(true);
    });

    it('should return false for different config entries', () => {
        expect(entriesEqual(entry6, entry8)).toBe(false);
    });
});

describe('LogEntry.ts, logsEqual', () => {
    const cmd1 = {
        type: "set",
        payload: { key: "x", value: 10 }
    };
    const cmd2 = {
        type: "set",
        payload: { key: "x", value: 10 }
    };
    const cmd3 = {
        type: "set",
        payload: { key: "x", value: 20 }
    };
    const entry1: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: cmd1
    };
    const entry2: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.COMMAND,
        command: cmd2
    };
    const entry3: LogEntry = {
        term: 1,
        index: 2,
        type: LogEntryType.COMMAND,
        command: cmd1
    };
    const entry4: LogEntry = {
        term: 1,
        index: 2,
        type: LogEntryType.COMMAND,
        command: cmd3
    };
    const entry5: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config: { voters: ["node1", "node2"], learners: [] }
    };
    const entry6: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config: { voters: ["node1", "node2"], learners: [] }
    };
    const entry7: LogEntry = {
        term: 1,
        index: 1,
        type: LogEntryType.CONFIG,
        config: { voters: ["node1"], learners: [] }
    };
    const log1: LogEntry[] = [entry1, entry3];
    const log2: LogEntry[] = [entry2, entry3];
    const log3: LogEntry[] = [entry1, entry4];
    const log4: LogEntry[] = [entry1];
    const log5: LogEntry[] = [entry3, entry1];
    const log6: LogEntry[] = [entry5, entry3];
    const log7: LogEntry[] = [entry6, entry3];
    const log8: LogEntry[] = [entry7, entry3];

    it('should return false for logs of different lengths', () => {
        expect(logsEqual(log1, log4)).toBe(false);
    });

    it('should return false for logs with different entries', () => {
        expect(logsEqual(log1, log3)).toBe(false);
    });

    it('should return false for logs with same entries in different order', () => {
        expect(logsEqual(log1, log5)).toBe(false);
    });

    it('should return true for identical logs', () => {
        expect(logsEqual(log1, log2)).toBe(true);
    });

    it('should return true for logs with identical config entries', () => {
        expect(logsEqual(log6, log7)).toBe(true);
    });

    it('should return false for logs with different config entries', () => {
        expect(logsEqual(log6, log8)).toBe(false);
    });
});