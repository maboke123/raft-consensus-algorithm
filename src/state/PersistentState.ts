import { NodeId } from '../core/Config';

export interface PersistentStateSnapshot {
    currentTerm: number;
    votedFor: NodeId | null;
}

export interface PersistentStateInterface {
    inittialize(): Promise<PersistentStateSnapshot>;
    getCurrentTerm(): number;
    getVotedFor(): NodeId | null;
    setCurrentTerm(term: number): Promise<void>;
    updateTermAndVote(term: number, votedFor: NodeId | null): Promise<void>;
    clear(): Promise<void>;
}