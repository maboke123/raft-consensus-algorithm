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
    calculateCommitIndex(currentTerm: number, logManager: LogManager, voters: NodeId[]): Promise<number>;
    isReplicatedOnMajority(index: number, voters: NodeId[]): boolean;
    getMajorityMatchIndex(leaderLastIdx: number, voters: NodeId[]): number;
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
            // throw new LeaderStateError(`Next index must be greater than match index (${matchIdx}), got ${index}`);
            index = matchIdx + 1;
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

    async calculateCommitIndex(currentTerm: number, logManager: LogManager, voters: NodeId[]): Promise<number> {
        const leaderLastIdx = logManager.getLastIndex();

        const voterMatchIndices: number[] = [leaderLastIdx];

        for (const voter of voters) {
            voterMatchIndices.push(this.matchIndex.get(voter) ?? 0);
        }

        const majorityCount = Math.floor((voters.length + 1) / 2) + 1;

        const sortedIndices = [...new Set(voterMatchIndices)]
            .filter(idx => idx > 0)
            .sort((a, b) => b - a);

        for (const idx of sortedIndices) {
            const termAtIdx = await logManager.getTermAtIndex(idx);
            
            if (termAtIdx !== currentTerm) {
                continue;
            }

            const replicatedCount = voterMatchIndices.filter(matchIdx => matchIdx >= idx).length;

            if (replicatedCount >= majorityCount) {
                return idx;
            }
        }

        return 0;
    }

    isReplicatedOnMajority(index: number, voters: NodeId[]): boolean {
        const majorityCount = Math.floor((voters.length + 1) / 2) + 1;

        let count = 1;
        for (const voter of voters) {
            if (this.matchIndex.has(voter) && this.matchIndex.get(voter)! >= index) {
                count++;
            }
        }

        return count >= majorityCount;
    }

    getMajorityMatchIndex(leaderLastIdx: number, voters: NodeId[]): number {
        const majorityCount = Math.floor((voters.length + 1) / 2) + 1;

        const values: number[] = [leaderLastIdx];

        for (const voter of voters) {
            if (this.matchIndex.has(voter)) {
                values.push(this.matchIndex.get(voter)!);
            }
        }

        values.sort((a, b) => b - a);

        const result = values[majorityCount - 1]
        if (result === undefined) {
            throw new LeaderStateError(`Not enough match indices to determine majority. Cluster size: ${voters.length + 1}, majority count: ${majorityCount}`);
        }
        return result;
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

    async updateNextIndexWithConflict(peerId: NodeId, conflictIndex: number, conflictTerm: number, logManager: LogManager): Promise<void> {
        this.ensureValidPeer(peerId);

        if (conflictTerm === 0) {
            this.setNextIndex(peerId, conflictIndex);
        } else {
            const lastIndexOfTerm = await this.findLastIndexOfTerm(conflictTerm, logManager);

            if (lastIndexOfTerm !== null) {
                this.setNextIndex(peerId, lastIndexOfTerm + 1);
            } else {
                this.setNextIndex(peerId, conflictIndex);
            }
        }

        const newNextIndex = this.getNextIndex(peerId);
        if (newNextIndex < 1) {
            this.setNextIndex(peerId, 1);
        }
    }

    addPeer(peerId: NodeId, lastLogIndex: number): void {
        if (this.peers.includes(peerId)) {
            return
        }

        this.peers.push(peerId);
        this.nextIndex.set(peerId, lastLogIndex + 1);
        this.matchIndex.set(peerId, 0);
    }

    private async findLastIndexOfTerm(term: number, logManager: LogManager): Promise<number | null> {
        const lastIndex = logManager.getLastIndex();

        for (let idx = lastIndex; idx >= 1; idx--) {
            const entryTerm = await logManager.getTermAtIndex(idx) ?? 0;

            if (entryTerm === term) {
                return idx;
            }

            if (entryTerm < term) {
                break;
            }
        }

        return null;
    }

    private ensureValidPeer(peerId: NodeId): void {
        if (!this.peers.includes(peerId)) {
            throw new LeaderStateError(`Invalid peer ID: ${peerId}`);
        }
    }
}
