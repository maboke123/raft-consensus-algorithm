import { NodeId } from '../core/Config';
import { Storage, StorageCodec, StorageOperation } from '../storage/Storage';
import { PersistentStateError, StorageError } from '../util/Error';

export interface PersistentStateSnapshot {
    currentTerm: number;
    votedFor: NodeId | null;
}

export interface PersistentStateInterface {
    initialize(): Promise<PersistentStateSnapshot>;
    getCurrentTerm(): number;
    getVotedFor(): NodeId | null;
    setCurrentTerm(term: number): Promise<void>;
    updateTermAndVote(term: number, votedFor: NodeId | null): Promise<void>;
    clear(): Promise<void>;
}

const CURRENT_TERM_KEY = 'raft:currentTerm';
const VOTED_FOR_KEY = 'raft:votedFor';

export class PersistentState implements PersistentStateInterface {
    private currentTerm: number = 0;
    private votedFor: NodeId | null = null;
    private initialized: boolean = false;

    constructor(private readonly storage: Storage) {}

    async initialize(): Promise<PersistentStateSnapshot> {
        if (this.initialized) {
            throw new PersistentStateError('PersistentState is already initialized');
        }

        if(!this.storage.isOpen()) {
            throw new PersistentStateError('Storage must be open before initializing PersistentState');
        }

        const snapshot = await this.restore();
        this.currentTerm = snapshot.currentTerm;
        this.votedFor = snapshot.votedFor;
        this.initialized = true;
        return snapshot;
    }

    getCurrentTerm(): number {
        this.ensureInitialized();
        return this.currentTerm;
    }

    getVotedFor(): NodeId | null {
        this.ensureInitialized();
        return this.votedFor;
    }

    async setCurrentTerm(term: number): Promise<void> {
        // this.ensureInitialized();

        await this.updateTermAndVote(term, null);
    }

    async updateTermAndVote(term: number, votedFor: NodeId | null): Promise<void> {
        this.ensureInitialized();

        this.assertValidNewTerm(term);

        if (term === this.currentTerm && votedFor === this.votedFor) {
            return;
        }

        try {
            const operations: StorageOperation[] = [
                {
                    type: 'set',
                    key: CURRENT_TERM_KEY,
                    value: StorageCodec.encodeNumber(term),
                }];

            if (votedFor === null) {
                operations.push({
                    type: 'delete',
                    key: VOTED_FOR_KEY,
                });
            } else {
                operations.push({
                    type: 'set',
                    key: VOTED_FOR_KEY,
                    value: StorageCodec.encodeString(votedFor),
                });
            }

            await this.storage.batch(operations);

            this.currentTerm = term;
            this.votedFor = votedFor;
        } catch (error) {
            throw new PersistentStateError('Failed to update term and vote', error instanceof StorageError ? error : undefined);
        }
    }

    async clear(): Promise<void> {
        this.ensureInitialized();

        try {
            await this.storage.batch([
                { type: 'delete', key: CURRENT_TERM_KEY },
                { type: 'delete', key: VOTED_FOR_KEY },
            ]);

            this.currentTerm = 0;
            this.votedFor = null;
        } catch (error) {
            throw new PersistentStateError('Failed to clear persistent state', error instanceof StorageError ? error : undefined);
        }
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new PersistentStateError('PersistentState must be initialized before use');
        }
    }

    private async restore(): Promise<PersistentStateSnapshot> {
        try {
            const termBuf = await this.storage.get(CURRENT_TERM_KEY);

            if (termBuf !== null) {
                this.currentTerm = StorageCodec.decodeNumber(termBuf);
                this.validateTerm(this.currentTerm);
            }

            const votedForBuf = await this.storage.get(VOTED_FOR_KEY);
            this.votedFor = votedForBuf !== null ? StorageCodec.decodeString(votedForBuf) : null;

            if (votedForBuf !== null && termBuf === null) {
                throw new PersistentStateError('Inconsistent state: votedFor is set but currentTerm is missing');
            };

            return {
                currentTerm: this.currentTerm,
                votedFor: this.votedFor,
            };
        } catch (error) {
            throw new PersistentStateError('Failed to restore persistent state', error instanceof StorageError ? error : undefined);
        }
    }

    private validateTerm(term: number): void {
        if (!Number.isInteger(term) || term < 0) {
            throw new PersistentStateError(`Invalid term value in storage: ${term}`);
        }
    }

    private assertValidNewTerm(newTerm: number): void {
        this.validateTerm(newTerm);

        if (newTerm < this.currentTerm) {
            throw new PersistentStateError(`New term ${newTerm} must be greater than or equal to current term ${this.currentTerm}`);
        }
    }
}