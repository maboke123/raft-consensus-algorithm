import { describe, it, expect } from "vitest";
import { RaftError,
         NotLeaderError,
         LogInconsistencyError,
         StorageError,
         NetworkError,
         TermMismatchError,
         TimeoutError,
         InvalidStateError,
         PersistentStateError
 } from "./Error";

describe('Error.ts, RaftError', () => {
    it('should create a RaftError with message and code', () => {
        const error = new RaftError('Test error', 'TEST_ERROR');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('RaftError');
        expect(error.message).toBe('Test error');
        expect(error.code).toBe('TEST_ERROR');
    });
});

describe('Error.ts, NotLeaderError', () => {
    it('should create a NotLeaderError with leaderId', () => {
        const error = new NotLeaderError('leader-1');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(NotLeaderError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('NotLeaderError');
        expect(error.message).toBe('Not the leader. Current leader is leader-1.');
        expect(error.code).toBe('NOT_LEADER');
        expect(error.leaderId).toBe('leader-1');
    });

    it('should create a NotLeaderError without leaderId', () => {
        const error = new NotLeaderError(null);
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(NotLeaderError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('NotLeaderError');
        expect(error.message).toBe('Not the leader. No leader currently known.');
        expect(error.code).toBe('NOT_LEADER');
        expect(error.leaderId).toBeNull();
    });
});

describe('Error.ts, LogInconsistencyError', () => {
    it('should create a LogInconsistencyError with message', () => {
        const error = new LogInconsistencyError('Log inconsistency detected');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(LogInconsistencyError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('LogInconsistencyError');
        expect(error.message).toBe('Log inconsistency detected');
        expect(error.code).toBe('LOG_INCONSISTENCY');
    });
});

describe('Error.ts, StorageError', () => {
    it('should create a StorageError with message and cause', () => {
        const cause = new Error('Underlying storage failure');
        const error = new StorageError('Storage error occurred', cause);
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(StorageError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('StorageError');
        expect(error.message).toBe('Storage error occurred');
        expect(error.code).toBe('STORAGE_ERROR');
        expect(error.cause).toBe(cause);
    });

    it('should create a StorageError with message and no cause', () => {
        const error = new StorageError('Storage error occurred');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(StorageError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('StorageError');
        expect(error.message).toBe('Storage error occurred');
        expect(error.code).toBe('STORAGE_ERROR');
        expect(error.cause).toBeUndefined();
    });
});

describe('Error.ts, NetworkError', () => {
    it('should create a NetworkError with message and cause', () => {
        const cause = new Error('Underlying network failure');
        const error = new NetworkError('Network error occurred', cause);
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(NetworkError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('NetworkError');
        expect(error.message).toBe('Network error occurred');
        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.cause).toBe(cause);
    });

    it('should create a NetworkError with message and no cause', () => {
        const error = new NetworkError('Network error occurred');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(NetworkError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('NetworkError');
        expect(error.message).toBe('Network error occurred');
        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.cause).toBeUndefined();
    });
});

describe('Error.ts, TermMismatchError', () => {
    it('should create a TermMismatchError with expected and actual term', () => {
        const error = new TermMismatchError(5, 3);
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(TermMismatchError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('TermMismatchError');
        expect(error.message).toBe('Term mismatch: expected 5, got 3');
        expect(error.code).toBe('TERM_MISMATCH');
        expect(error.expectedTerm).toBe(5);
        expect(error.actualTerm).toBe(3);
    });
});

describe('Error.ts, TimeoutError', () => {
    it('should create a TimeoutError with message and cause', () => {
        const cause = new Error('Underlying timeout');
        const error = new TimeoutError('Timeout error occurred', cause);
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(TimeoutError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('TimeoutError');
        expect(error.message).toBe('Timeout error occurred');
        expect(error.code).toBe('TIMEOUT');
        expect(error.cause).toBe(cause);
    });

    it('should create a TimeoutError with message and no cause', () => {
        const error = new TimeoutError('Timeout error occurred');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(TimeoutError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('TimeoutError');
        expect(error.message).toBe('Timeout error occurred');
        expect(error.code).toBe('TIMEOUT');
        expect(error.cause).toBeUndefined();
    });
});

describe('Error.ts, InvalidStateError', () => {
    it('should create an InvalidStateError with fromState and toState', () => {
        const error = new InvalidStateError('Follower', 'Leader');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(InvalidStateError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('InvalidStateError');
        expect(error.message).toBe('Invalid state transition: from Follower to Leader');
        expect(error.code).toBe('INVALID_STATE');
        expect(error.fromState).toBe('Follower');
        expect(error.toState).toBe('Leader');
    });
});

describe('Error.ts, PersistentStateError', () => {
    it('should create a PersistentStateError with message and cause', () => {
        const cause = new Error('Underlying persistent state error');
        const error = new PersistentStateError('Persistent state error occurred', cause);
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(PersistentStateError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('PersistentStateError');
        expect(error.message).toBe('Persistent state error occurred');
        expect(error.code).toBe('PERSISTENT_STATE_ERROR');
        expect(error.cause).toBe(cause);
    });

    it('should create a PersistentStateError with message and no cause', () => {
        const error = new PersistentStateError('Persistent state error occurred');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(RaftError);
        expect(error).toBeInstanceOf(PersistentStateError);
        expect(error.stack).toBeDefined();
        expect(error.name).toBe('PersistentStateError');
        expect(error.message).toBe('Persistent state error occurred');
        expect(error.code).toBe('PERSISTENT_STATE_ERROR');
        expect(error.cause).toBeUndefined();
    });
});
