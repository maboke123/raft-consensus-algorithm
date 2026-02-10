export interface VolatileStateSnapshot {
    commitIndex: number;
    lastApplied: number;
}

export interface VolatileStateInterface {
    getCommitIndex(): number;
    setCommitIndex(index: number): void;
    advanceCommitIndex(index: number): void;
    getLastApplied(): number;
    setLastApplied(index: number): void;
    advanceLastApplied(index: number): number;
    needsApplication(): boolean;
    getNextIndexToApply(): number | null;
    getPendingApplicationsCount(): number;
    reset(): void;
    snapshot(): VolatileStateSnapshot;
}