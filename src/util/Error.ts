export class RaftError extends Error {
    constructor(
        message: string,
        public readonly code: string
    ) {
        super(message);
        this.name = 'RaftError';
        Object.setPrototypeOf(this, RaftError.prototype); // anders kapotte prototype chain, blijkbaar niet meer nodig in ES2015+ maar nodig in ES5
    }
}

export class NotLeaderError extends RaftError {
    constructor(
        public readonly leaderId: string | null
    ) {
        super(
            leaderId
                 ? `Not the leader. Current leader is ${leaderId}.`
                 :'Not the leader. No leader currently known.',
            'NOT_LEADER'
        )
        this.name = 'NotLeaderError';
        Object.setPrototypeOf(this, NotLeaderError.prototype);
    }
}

export class LogInconsistencyError extends RaftError {
    constructor(
        message: string
    ) {
        super(message, 'LOG_INCONSISTENCY');
        this.name = 'LogInconsistencyError';
        Object.setPrototypeOf(this, LogInconsistencyError.prototype);
    }
}

export class StorageError extends RaftError {
    constructor(
        message: string, public readonly cause?: Error
    ) {
        super(message, 'STORAGE_ERROR');
        this.name = 'StorageError';
        Object.setPrototypeOf(this, StorageError.prototype);
    }
}

export class NetworkError extends RaftError {
    constructor(
        message: string, public readonly cause?: Error
    ) {
        super(message, 'NETWORK_ERROR');
        this.name = 'NetworkError';
        Object.setPrototypeOf(this, NetworkError.prototype);
    }
}

export class TermMismatchError extends RaftError {
    constructor(
        public readonly expectedTerm: number,
        public readonly actualTerm: number
    ) {
        super(`Term mismatch: expected ${expectedTerm}, got ${actualTerm}`, 'TERM_MISMATCH');
        this.name = 'TermMismatchError';
        Object.setPrototypeOf(this, TermMismatchError.prototype);
    }
}

export class TimeoutError extends RaftError {
    constructor(
        message: string, public readonly cause?: Error
    ) {
        super(message, 'TIMEOUT');
        this.name = 'TimeoutError';
        Object.setPrototypeOf(this, TimeoutError.prototype);
    }
}

export class InvalidStateError extends RaftError {
    constructor(
        public readonly fromState: string,
        public readonly toState: string,
    ) {
        super(`Invalid state transition: from ${fromState} to ${toState}`, 'INVALID_STATE');
        this.name = 'InvalidStateError';
        Object.setPrototypeOf(this, InvalidStateError.prototype);
    }
}

export class PersistentStateError extends RaftError {
    constructor(
        message: string, public readonly cause?: Error
    ) {
        super(message, 'PERSISTENT_STATE_ERROR');
        this.name = 'PersistentStateError';
        Object.setPrototypeOf(this, PersistentStateError.prototype);
    }
}

export class VolatileStateError extends RaftError {
    constructor(
        message: string, public readonly cause?: Error
    ) {
        super(message, 'VOLATILE_STATE_ERROR');
        this.name = 'VolatileStateError';
        Object.setPrototypeOf(this, VolatileStateError.prototype);
    }
}

export class LeaderStateError extends RaftError {
    constructor(
        message: string, public readonly cause?: Error
    ) {
        super(message, 'LEADER_STATE_ERROR');
        this.name = 'LeaderStateError';
        Object.setPrototypeOf(this, LeaderStateError.prototype);
    }
}
