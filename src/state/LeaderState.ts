import { NodeId } from "../core/Config";
import { LogManagerInterface } from "../log/LogManager";


export interface LeaderStateSnapshot {
    nextIndex: Map<NodeId, number>;
    matchIndex: Map<NodeId, number>;
}

export interface LeaderStateInterface {
    initialize(): Promise<void>;
    getNextIndex(peerId: NodeId): number;
    setNextIndex(peerId: NodeId, index: number): void;
    decrementNextIndex(peerId: NodeId): void;
    getMatchIndex(peerId: NodeId): number;
    updateMatchIndex(peerId: NodeId, index: number): void;
    calculateCommitIndex(currentTerm: number, logManager: LogManagerInterface): Promise<number>;
    isReplicatedOnMajority(index: number): boolean;
    getMajorityMatchIndex(): number;
    isFullyReplicated(index: number): boolean;
    getPeersBehind(targetIndex: number): NodeId[];
    snapshot(): ReadonlyMap<NodeId, LeaderStateSnapshot>;
    reset(): void;
    getPeers(): NodeId[];
}
