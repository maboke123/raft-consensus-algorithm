import { describe, it, expect, beforeEach } from "vitest";
import { LogManager } from "./LogManager";
import { LogEntry, Command } from "./LogEntry";
import { InMemoryStorage } from "../storage/Storage";
import { LogInconsistencyError, StorageError } from "../util/Error";
import { log } from "node:console";

describe('LogManager.ts, LogManager', () => {

    let storage: InMemoryStorage;

    let logManager: LogManager;

    const validCommand: Command = { type: 'set', payload: { key: 'x', value: '10' } };
    const validCommand2: Command = { type: 'set', payload: { key: 'y', value: '20' } };
    const validCommand3: Command = { type: 'delete', payload: { key: 'x' } };
    const validCommand4: Command = { type: 'set', payload: { key: 'x', value: '10' } };

    const validLogEntry: LogEntry = { index: 1, term: 1, command: validCommand };
    const validLogEntry2: LogEntry = { index: 2, term: 1, command: validCommand2 };
    const validLogEntry3: LogEntry = { index: 3, term: 1, command: validCommand3 };
    const validLogEntry4: LogEntry = { index: 4, term: 2, command: validCommand4 };

    const invalidLogEntry: LogEntry = { index: 3, term: 1, command: validCommand };

    const emptyEntries: LogEntry[] = [];

    const validEntries: LogEntry[] = [ validLogEntry, validLogEntry2, validLogEntry3, validLogEntry4 ];

    const invalidEntries: LogEntry[] = [ validLogEntry, invalidLogEntry, validLogEntry3 ];

    class FailingStorage extends InMemoryStorage {
        async get(key: string): Promise<Buffer | null> {
            throw new StorageError('Storage get error');
        }
    }

    class FailingStorage2 extends InMemoryStorage {
        async get(key: string): Promise<Buffer | null> {
            throw new LogInconsistencyError('Log inconsistency error');
        }
    }

    class FailingStorage3 extends InMemoryStorage {
        async get(key: string): Promise<Buffer | null> {
            throw new Error('Unexpected error');
        }
    }

    beforeEach(() => {
        storage = new InMemoryStorage();
        storage.open();
        logManager = new LogManager(storage);
    });

    it('should create a LogManager instance', () => {
        expect(logManager).toBeInstanceOf(LogManager);
    });

    it('should throw when creating a LogManager with non-open storage', () => {
        const closedStorage = new InMemoryStorage();
        expect(() => new LogManager(closedStorage)).toThrow('Storage must be open before creating LogManager');
    });

    it('should initialize correctly and have empty log', async () => {
        await logManager.initialize();
        expect(logManager.getLastIndex()).toBe(0);
        expect(logManager.getLastTerm()).toBe(0);
    });

    it('should throw when re-initializing', async () => {
        await logManager.initialize();
        await expect(logManager.initialize()).rejects.toThrow('LogManager is already initialized');
    });

    it('should throw when initzializing but lastindex buff is null', async () => {
        const key = `raft:log:lastIndex`;
        await storage.set(key, Buffer.from('not a number'));
        await expect(logManager.initialize()).rejects.toThrow("Buffer length must be 8 bytes to decode a number, got 12");
    });

    it('should throw when initzializing but lastterm buff is null', async () => {
        const key = `raft:log:lastTerm`;
        await storage.set(key, Buffer.from('not a number'));
        await expect(logManager.initialize()).rejects.toThrow("Buffer length must be 8 bytes to decode a number, got 12");
    });

    it('should throw when appending entry before initialization', async () => {
        await expect(logManager.appendEntry(validLogEntry)).rejects.toThrow('LogManager is not initialized');
    });

    it('should append a valid log entry', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        expect(logManager.getLastIndex()).toBe(1);
        expect(logManager.getLastTerm()).toBe(1);
    });

    it('should throw when appending an invalid log entry', async () => {
        await logManager.initialize();
        await expect(logManager.appendEntry(invalidLogEntry)).rejects.toThrow('Entry index 3 does not match expected index 1');
        await logManager.appendEntry(validLogEntry);
        await expect(logManager.appendEntry(invalidLogEntry)).rejects.toThrow('Entry index 3 does not match expected index 2');
    });

    it('should return last index on empty entries appendEntries', async () => {
        await logManager.initialize();
        const result = await logManager.appendEntries(emptyEntries);
        expect(result).toBe(0);
        await logManager.appendEntry(validLogEntry);
        const result2 = await logManager.appendEntries(emptyEntries);
        expect(result2).toBe(1);
    });

    it("should append valid log entries with appendEntries", async () => {
        await logManager.initialize();
        const result = await logManager.appendEntries(validEntries);
        expect(result).toBe(4);
        expect(logManager.getLastIndex()).toBe(4);
        expect(logManager.getLastTerm()).toBe(2);
    });

    it("should throw when appending invalid log entries with appendEntries", async () => {
        await logManager.initialize();
        await expect(logManager.appendEntries(invalidEntries)).rejects.toThrow('Entry index 3 does not match expected index 2');
        expect(logManager.getLastIndex()).toBe(0);
        expect(logManager.getLastTerm()).toBe(0);
    });

    it('should get an existing entry', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        const entry = await logManager.getEntry(1);
        expect(entry).toEqual(validLogEntry);
    });

    it('should return null for getting non-existing entry', async () => {
        await logManager.initialize();
        const entry = await logManager.getEntry(1);
        expect(entry).toBeNull();
    });

    it('should return null for getting entry with index < 1', async () => {
        await logManager.initialize();
        const entry = await logManager.getEntry(0);
        expect(entry).toBeNull();
    });

    it('should return null for getting entry with index > last index', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        const entry = await logManager.getEntry(2);
        expect(entry).toBeNull();
    });

    it('should get existing entries in range', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const entries = await logManager.getEntries(2, 3);
        expect(entries).toEqual([validLogEntry2, validLogEntry3]);
    });

    it('should throw when getting entries with fromIndex < 1', async () => {
        await logManager.initialize();
        await expect(logManager.getEntries(0, 2)).rejects.toThrow('Invalid index range: from 0 to 2');
    });

    it('should throw when getting entries with toIndex > last index', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        await expect(logManager.getEntries(1, 2)).rejects.toThrow('Invalid index range: from 1 to 2');
    });
    
    it('should throw when getting entries with fromIndex > toIndex', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        await expect(logManager.getEntries(3, 2)).rejects.toThrow('Invalid index range: from 3 to 2');
    });

    it('should throw when an entry in the range is missing', async () => {
        await logManager.initialize();

        const entry1: LogEntry = { index: 1, term: 1, command: validCommand };
        const entry3: LogEntry = { index: 3, term: 1, command: validCommand3 };

        await logManager.appendEntry(entry1);

        const key = `raft:log:0000000000000003`;
        await logManager['storage'].set(key, Buffer.from(JSON.stringify(entry3)));

        logManager['lastIndex'] = 3;
        logManager['lastTerm'] = entry3.term;

        await expect(logManager.getEntries(1, 3)).rejects.toThrow('Missing log entry at index 2');
    });

    it('should throw when getting first index when log is empty', async () => {
        await logManager.initialize();
        expect(() => logManager.getFirstIndex()).toThrow('No log entries found');
    });

    it('should return first index when log is not empty', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const firstIndex = logManager.getFirstIndex();
        expect(firstIndex).toBe(1);
    });

    it('should get term at index', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const term = await logManager.getTermAtIndex(3);
        expect(term).toBe(1);
    });

    it('should return null for get term at index for non-existing entry', async () => {
        await logManager.initialize();
        const term = await logManager.getTermAtIndex(1);
        expect(term).toBeNull();
    });

    it('should return true for hasMatchingEntry for 0 index', async () => {
        await logManager.initialize();
        const hasEntry = await logManager.hasMatchingEntry(0, 2);
        expect(hasEntry).toBe(true);
    });

    it('should return true for hasMatchingEntry for a matching entry', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        const hasEntry = await logManager.hasMatchingEntry(1, 1);
        expect(hasEntry).toBe(true);
    });

    it('should return false for hasMatchingEntry for non-existing entry', async () => {
        await logManager.initialize();
        const hasEntry = await logManager.hasMatchingEntry(1, 1);
        expect(hasEntry).toBe(false);
    });

    it('should return false for hasMatchingEntry for non-matching term', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        const hasEntry = await logManager.hasMatchingEntry(1, 2);
        expect(hasEntry).toBe(false);
    });

    it('should return null for getting last term when log is empty', async () => {
        await logManager.initialize();
        const lastTerm = logManager.getLastTerm();
        expect(lastTerm).toBe(0);
    });

    it('should return null for getting last entry when log is empty', async () => {
        await logManager.initialize();
        const lastEntry = await logManager.getLastEntry();
        expect(lastEntry).toBeNull();
    });

    it('should return last entry when getting last entry', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const lastEntry = await logManager.getLastEntry();
        expect(lastEntry).toEqual(validLogEntry4);
    });

    it('should return last index when getting last index', async () => {
        await logManager.initialize();
        const lastIndex = logManager.getLastIndex();
        expect(lastIndex).toBe(0);
        await logManager.appendEntries(validEntries);
        const lastIndexAfterAppend = logManager.getLastIndex();
        expect(lastIndexAfterAppend).toBe(4);
    });

    it('should return last term when getting last term', async () => {
        await logManager.initialize();
        const lastTerm = logManager.getLastTerm();
        expect(lastTerm).toBe(0);
        await logManager.appendEntries(validEntries);
        const lastTermAfterAppend = logManager.getLastTerm();
        expect(lastTermAfterAppend).toBe(2);
    });

    it('should throw when deleting entries from index < 1', async () => {
        await logManager.initialize();
        await expect(logManager.deleteEntriesFrom(0)).rejects.toThrow('Cannot delete from index 0 as it is less than 1');
    });

    it('should throw when deleting entries from index > last index', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        await expect(logManager.deleteEntriesFrom(2)).rejects.toThrow('Cannot delete from index 2 as it is beyond last index 1');
    });

    it('should delete entries from given index with entries remaining', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        await logManager.deleteEntriesFrom(3);
        expect(logManager.getLastIndex()).toBe(2);
        expect(logManager.getLastTerm()).toBe(1);
        const entry2 = await logManager.getEntry(2);
        expect(entry2).toEqual(validLogEntry2);
        const entry3 = await logManager.getEntry(3);
        expect(entry3).toBeNull();
    });

    it('should delete entries from given index with no entries remaining', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        await logManager.deleteEntriesFrom(1);
        expect(logManager.getLastIndex()).toBe(0);
        expect(logManager.getLastTerm()).toBe(0);
        const entry1 = await logManager.getEntry(1);
        expect(entry1).toBeNull();
    });

    it('should delete entries from given index where there is a gap just before the index', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);

        const storage = logManager['storage'];
        await storage.delete(`raft:log:0000000000000001`);

        logManager['lastIndex'] = 2;
        logManager['lastTerm'] = 2;

        await logManager.deleteEntriesFrom(2);

        expect(logManager.getLastIndex()).toBe(1);
        expect(logManager.getLastTerm()).toBe(0);
    });

    it("should clear an already empty log", async () => {
        await logManager.initialize();
        await logManager.clear();
        expect(logManager.getLastIndex()).toBe(0);
        expect(logManager.getLastTerm()).toBe(0);
    });

    it('should clear the log', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        await logManager.clear();
        expect(logManager.getLastIndex()).toBe(0);
        expect(logManager.getLastTerm()).toBe(0);
        const entry1 = await logManager.getEntry(1);
        expect(entry1).toBeNull();
    });

    it('should throw StorageError when underlying storage throws an StorageError', async () => {
        const failingStorage = new FailingStorage();
        failingStorage.open();
        const logManagerWithFailingStorage = new LogManager(failingStorage);
        await expect(logManagerWithFailingStorage.initialize()).rejects.toThrow('Storage get error');
    });

    it('should throw an LogInconsistencyError when underlying storage throws an LogInconsistencyError', async () => {
        const failingStorage = new FailingStorage2();
        failingStorage.open();
        const logManagerWithFailingStorage = new LogManager(failingStorage);
        await expect(logManagerWithFailingStorage.initialize()).rejects.toThrow('Log inconsistency error');
    });

    it('should throw an StorageError when underlying storage throws an unexpected error', async () => {
        const failingStorage = new FailingStorage3();
        failingStorage.open();
        const logManagerWithFailingStorage = new LogManager(failingStorage);
        await expect(logManagerWithFailingStorage.initialize()).rejects.toThrow('Storage operation failed in context: initialize');
    });

    it('should throw when not initialized for getEntriesFromIndex', async () => {
        await expect(logManager.getEntriesFromIndex(1)).rejects.toThrow('LogManager is not initialized');
    });

    it('should throw when index < 1 for getEntriesFromIndex', async () => {
        await logManager.initialize();
        await expect(logManager.getEntriesFromIndex(0)).rejects.toThrow('Invalid fromIndex: 0 is less than 1');
    });

    it('should return empty array for getEntriesFromIndex when fromIndex > last index', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        const entries = await logManager.getEntriesFromIndex(2);
        expect(entries).toEqual([]);
    });

    it('should return all entries from given index for getEntriesFromIndex', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const entries = await logManager.getEntriesFromIndex(2);
        expect(entries).toEqual([validLogEntry2, validLogEntry3, validLogEntry4]);
    });

    it('should return all entries when index is 1 for getEntriesFromIndex', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const entries = await logManager.getEntriesFromIndex(1);
        expect(entries).toEqual(validEntries);
    });

    it('should return single entry when index equals lastIndex for getEntriesFromIndex', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const entries = await logManager.getEntriesFromIndex(4);
        expect(entries).toEqual([validLogEntry4]);
    });

    it('should throw when not initialized for appendEntriesFrom', async () => {
        await expect(logManager.appendEntriesFrom(1, validEntries)).rejects.toThrow('LogManager is not initialized');
    });

    it('should return lastIndex when entries is empty for appendEntriesFrom', async () => {
        await logManager.initialize();
        const result = await logManager.appendEntriesFrom(1, []);
        expect(result).toBe(0);
    });

    it('should append new entries that do not exist in the log for appendEntriesFrom', async () => {
        await logManager.initialize();
        const result = await logManager.appendEntriesFrom(2, validEntries);
        expect(result).toBe(4);
        expect(logManager.getLastIndex()).toBe(4);
    });

    it('should skip entries that already exist in the log with matching term for appendEntriesFrom', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const newEntry5: LogEntry = { index: 5, term: 2, command: validCommand};
        const result = await logManager.appendEntriesFrom(2, [ validLogEntry, validLogEntry2, newEntry5 ]);
        expect(result).toBe(5);
        expect(logManager.getLastIndex()).toBe(5);
    });

    it('should truncate from conflict index when term mismatches and append new entries for appendEntriesFrom', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const conflictingEntry3: LogEntry = { index: 3, term: 3, command: validCommand3 };
        const newEntry4: LogEntry = { index: 4, term: 3, command: validCommand4 };
        const result = await logManager.appendEntriesFrom(2, [ conflictingEntry3, newEntry4 ]);
        expect(result).toBe(4);
        expect(logManager.getLastIndex()).toBe(4);

        const entry3 = await logManager.getEntry(3);
        expect(entry3).toEqual(conflictingEntry3);
    });

    it('should return last index when all entries match for appendEntriesFrom', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const result = await logManager.appendEntriesFrom(1, validEntries);
        expect(result).toBe(4);
        expect(logManager.getLastIndex()).toBe(4);
    });

    it('should throw when not initialized for matchesPrevLog', async () => {
        await expect(logManager.matchesPrevLog(1, 1)).rejects.toThrow('LogManager is not initialized');
    });

    it('should return true when prevLogIndex is 0 and prevlogTerm is 0', async () => {
        await logManager.initialize();
        const matches = await logManager.matchesPrevLog(0, 0);
        expect(matches).toBe(true);
    });

    it('should return false when prevlogIndex is 0 and prevLogTerm is not 0', async () => {
        await logManager.initialize();
        const matches = await logManager.matchesPrevLog(0, 1);
        expect(matches).toBe(false);
    });

    it('should return false when entry does not exist at prevLogIndex for matchesPrevLog', async () => {
        await logManager.initialize();
        const matches = await logManager.matchesPrevLog(1, 1);
        expect(matches).toBe(false);
    });

    it('should return true when entry exists and term matches for matchesPrevLog', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        const matches = await logManager.matchesPrevLog(1, 1);
        expect(matches).toBe(true);
    });

    it('should return false when entry exists but term does not match for matchesPrevLog', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        const matches = await logManager.matchesPrevLog(1, 2);
        expect(matches).toBe(false);
    });

    it('should throw when not initialized for getConflictInfo', async () => {
        await expect(logManager.getConflictInfo(1)).rejects.toThrow('LogManager is not initialized');
    });

    it('should return lastIndex + 1 with term 0 when prevLogIndex is beyond last index for getConflictInfo', async () => {
        await logManager.initialize();
        await logManager.appendEntries(validEntries);
        const result = await logManager.getConflictInfo(5);
        expect(result).toEqual({ conflictIndex: 5, conflictTerm: 0 });
    });

    it('should return lastIndex + 1 with term 0 when entry is missing at prevLogIndex for getConflictInfo', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        logManager['lastIndex'] = 2;
        const result = await logManager.getConflictInfo(2);
        expect(result).toEqual({ conflictIndex: 3, conflictTerm: 0 });
    });

    it('should return first index of conflicting term when all previous entries have same term', async () => {
        await logManager.initialize();
        await logManager.appendEntries([validLogEntry, validLogEntry2, validLogEntry3]);
        const result = await logManager.getConflictInfo(3);
        expect(result).toEqual({ conflictIndex: 1, conflictTerm: 1 });
    });

    it('should stop walking back when previous entry has different term', async () => {
        await logManager.initialize();
        const entryTerm2: LogEntry = { index: 2, term: 2, command: validCommand2 };
        const entryTerm2_2: LogEntry = { index: 3, term: 2, command: validCommand3 };
        await logManager.appendEntries([validLogEntry, entryTerm2, entryTerm2_2]);
        const result = await logManager.getConflictInfo(3);
        expect(result).toEqual({ conflictIndex: 2, conflictTerm: 2 });
    });

    it('should return the entry itsself when prevLogIndes is 1', async () => {
        await logManager.initialize();
        await logManager.appendEntry(validLogEntry);
        const result = await logManager.getConflictInfo(1);
        expect(result).toEqual({ conflictIndex: 1, conflictTerm: 1 });
    });

    it('should throw when not initialized for appendCommand', async () => {
        await expect(logManager.appendCommand(validCommand, 1)).rejects.toThrow('LogManager is not initialized');
    });

    it('should append a command and return the new index', async () => {
        await logManager.initialize();
        const newIndex = await logManager.appendCommand(validCommand, 1);
        expect(newIndex).toBe(1);
        const entry = await logManager.getEntry(1);
        expect(entry).toEqual({ index: 1, term: 1, command: validCommand });
    });

    it('should append multiple commmands with incrementing indices', async () => {
        await logManager.initialize();
        const index1 = await logManager.appendCommand(validCommand, 1);
        const index2 = await logManager.appendCommand(validCommand2, 1);
        const index3 = await logManager.appendCommand(validCommand3, 2);
        expect(index1).toBe(1);
        expect(index2).toBe(2);
        expect(index3).toBe(3);
        expect(logManager.getLastTerm()).toBe(2);
    });

    it('should store the correct entry content', async () => {
        await logManager.initialize();
        await logManager.appendCommand(validCommand, 3);
        const entry = await logManager.getEntry(1);
        expect(entry).toEqual({ index: 1, term: 3, command: validCommand });
    });
});