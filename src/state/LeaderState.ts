import { NodeId } from "../core/Config";
import { LogManager } from "../log/LogManager";
import { LeaderStateError } from "../util/Error";


export interface LeaderStateSnapshot {
    nextIndex: number;
    matchIndex: number;
}

export interface LeaderStateInterface {
    initialize(lastLogIndex: number): void;
    getNextIndex(peerId: NodeId): number;
    setNextIndex(peerId: NodeId, index: number): void;
    decrementNextIndex(peerId: NodeId): void;
    getMatchIndex(peerId: NodeId): number;
    updateMatchIndex(peerId: NodeId, index: number): void;
    calculateCommitIndex(currentTerm: number, logManager: LogManager): Promise<number>;
    isReplicatedOnMajority(index: number): boolean;
    getMajorityMatchIndex(leaderLastIdx: number): number;
    isFullyReplicated(index: number): boolean;
    getPeersBehind(targetIndex: number): NodeId[];
    snapshot(): ReadonlyMap<NodeId, LeaderStateSnapshot>;
    reset(lastLogIndex: number): void;
    getPeers(): NodeId[];
}

export class LeaderState implements LeaderStateInterface {
    private readonly nextIndex: Map<NodeId, number> = new Map();
    private readonly matchIndex: Map<NodeId, number> = new Map();
    private readonly peers: NodeId[];

    constructor(peers: NodeId[], lastLogIndex: number = 0) {
        this.peers = [...peers];

        this.initialize(lastLogIndex);
    }

    initialize(lastLogIndex: number): void {
        this.nextIndex.clear();
        this.matchIndex.clear();

        for (const peerId of this.peers) {
            this.nextIndex.set(peerId, lastLogIndex + 1);
            this.matchIndex.set(peerId, 0);
        }
    }

    getNextIndex(peerId: NodeId): number {
        this.ensureValidPeer(peerId);

        return this.nextIndex.get(peerId)!;
    }

    setNextIndex(peerId: NodeId, index: number): void {
        this.ensureValidPeer(peerId);

        if (!Number.isInteger(index) || index < 0) {
            throw new LeaderStateError(`Next index must be a non-negative integer, got ${index}`);
        }

        const matchIdx = this.matchIndex.get(peerId)!;

        if (index <= matchIdx) {
            throw new LeaderStateError(`Next index must be greater than match index (${matchIdx}), got ${index}`);

        }

        this.nextIndex.set(peerId, index);
    }

    decrementNextIndex(peerId: NodeId): void {
        this.ensureValidPeer(peerId);

        const currentNextIdx = this.getNextIndex(peerId);
        const matchIdx = this.matchIndex.get(peerId)!;
        const newNextIdx = Math.max(matchIdx + 1, currentNextIdx - 1);

        this.nextIndex.set(peerId, newNextIdx);
    }

    getMatchIndex(peerId: NodeId): number {
        this.ensureValidPeer(peerId);

        return this.matchIndex.get(peerId)!;
    }

    updateMatchIndex(peerId: NodeId, index: number): void {
        this.ensureValidPeer(peerId);

        if (!Number.isInteger(index) || index < 0) {
            throw new LeaderStateError(`Match index must be non-negative integer, got ${index}`);
        }

        const currentMatchIdx = this.matchIndex.get(peerId)!;

        if (index <= currentMatchIdx) {
            // throw new LeaderStateError(`Match index must be greater than current match index (${currentMatchIdx}), got ${index}`);
            return;
        }

        this.matchIndex.set(peerId, index);
        this.nextIndex.set(peerId, index + 1);
    }

    async calculateCommitIndex(currentTerm: number, logManager: LogManager): Promise<number> {
        const leaderLastIdx = logManager.getLastIndex();
        const candidateIndices: number[] = Array.from(this.matchIndex.values());
        candidateIndices.push(leaderLastIdx);

        const sorted = [...new Set(candidateIndices)]
            .filter(idx => idx > 0)
            .sort((a, b) => b - a);

        const clusterSize = this.peers.length + 1;
        const majorityCount = Math.floor(clusterSize / 2) + 1;

        for (const candidateIdx of sorted) {
            const termAtIdx = await logManager.getTermAtIndex(candidateIdx);

            if (termAtIdx !== currentTerm) {
                continue;
            }

            const replicatedCount = 1 + Array.from(this.matchIndex.values())
                .filter(matchIdx => matchIdx >= candidateIdx)
                .length;
            
            if (replicatedCount >= majorityCount) {
                return candidateIdx;
            }
        }

        return 0;
    }

    isReplicatedOnMajority(index: number): boolean {
        const clusterSize = this.peers.length + 1;
        const majorityCount = Math.floor(clusterSize / 2) + 1;

        const replicatedOnPeers = 1 + Array.from(this.matchIndex.values())
            .filter(matchIdx => matchIdx >= index)
            .length;

        return replicatedOnPeers >= majorityCount;
    }

    getMajorityMatchIndex(leaderLastIdx: number): number {
        const clusterSize = this.peers.length + 1;
        const majorityCount = Math.floor(clusterSize / 2) + 1;

        const values: number[] = [
            ...Array.from(this.matchIndex.values()),
            leaderLastIdx
        ];

        values.sort((a, b) => b - a);

        return values[majorityCount - 1] ?? 0;
    }

    isFullyReplicated(index: number): boolean {
        return this.peers.every(peerId => this.getMatchIndex(peerId) >= index);
    }

    getPeersBehind(targetIndex: number): NodeId[] {
        return this.peers.filter(peer => this.getMatchIndex(peer) < targetIndex);
    }

    snapshot(): ReadonlyMap<NodeId, LeaderStateSnapshot> {
        const snapshotMap: Map<NodeId, LeaderStateSnapshot> = new Map();

        for (const peer of this.peers) {
            snapshotMap.set(peer, {
                nextIndex: this.getNextIndex(peer),
                matchIndex: this.getMatchIndex(peer)
            });
        }

        return new Map(snapshotMap);
    }

    reset(lastLogIndex: number = 0): void {
        this.initialize(lastLogIndex);
    }

    getPeers(): NodeId[] {
        return [...this.peers];
    }

    private ensureValidPeer(peerId: NodeId): void {
        if (!this.peers.includes(peerId)) {
            throw new LeaderStateError(`Invalid peer ID: ${peerId}`);
        }
    }
}
