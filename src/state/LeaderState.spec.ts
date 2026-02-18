import { describe, it, expect, vi } from "vitest";
import { LeaderState } from "./LeaderState";
import { LeaderStateError } from "../util/Error";
import { get } from "node:http";

describe('LeaderState.ts, LeaderState', () => {
    const peers = ['node1', 'node2', 'node3'];
    const lastLogIndex = 5;

    it('should initialize correctly', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        for (const peer of peers) {
            expect(leaderState.getNextIndex(peer)).toBe(lastLogIndex + 1);
            expect(leaderState.getMatchIndex(peer)).toBe(0);
        }
    });

    it('should initialize with a new instance of peers array', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(leaderState['peers']).not.toBe(peers);
        expect(leaderState['peers']).toEqual(peers);
    });

    it('should set and get next index correctly', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.setNextIndex('node1', 7);
        expect(leaderState.getNextIndex('node1')).toBe(7);
    });

    it('should throw for invalid peer in getNextIndex', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.getNextIndex('invalidNode')).toThrow(LeaderStateError);
    });

    it('should throw for invalid peer in setNextIndex', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.setNextIndex('invalidNode', 7)).toThrow(LeaderStateError);
    });

    it('should throw for non-integer next index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.setNextIndex('node1', "not an integer" as any)).toThrow(LeaderStateError);
    });

    it('should throw for negative next index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.setNextIndex('node1', -1)).toThrow(LeaderStateError);
    });

    it('should not allow setting next index less than or equal to match index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(leaderState.getNextIndex('node1')).toBe(lastLogIndex + 1);
        expect(leaderState.getMatchIndex('node1')).toBe(0);
        leaderState.setNextIndex('node1', 0);
        expect(leaderState.getNextIndex('node1')).toBe(1);
    });

    it('should set next index to match index + 1 when next index is less than or equal to match index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        // expect(() => leaderState.setNextIndex('node1', 5)).toThrow(LeaderStateError);
        // expect(() => leaderState.setNextIndex('node1', 4)).toThrow(LeaderStateError);
        expect(leaderState.getNextIndex('node1')).toBe(6);
    });

    it('should decrement next index correctly', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.setNextIndex('node1', 7);
        leaderState.decrementNextIndex('node1');
        expect(leaderState.getNextIndex('node1')).toBe(6);
    });

    it('should not decrement next index below match index + 1', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.setNextIndex('node1', 7);
        leaderState.decrementNextIndex('node1');
        expect(leaderState.getNextIndex('node1')).toBe(6);
        leaderState.decrementNextIndex('node1');
        expect(leaderState.getNextIndex('node1')).toBe(6);
    });

    it('should throw for invalid peer in decrementNextIndex', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.decrementNextIndex('invalidNode')).toThrow(LeaderStateError);
    });

    it('should get and update match index correctly', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        expect(leaderState.getMatchIndex('node1')).toBe(5);
    });

    it('should throw for invalid peer in getMatchIndex', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.getMatchIndex('invalidNode')).toThrow(LeaderStateError);
    });

    it('should throw for invalid peer in updateMatchIndex', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.updateMatchIndex('invalidNode', 5)).toThrow(LeaderStateError);
    });

    it('should throw for non-integer match index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.updateMatchIndex('node1', "not an integer" as any)).toThrow(LeaderStateError);
    });

    it('should throw for negative match index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(() => leaderState.updateMatchIndex('node1', -1)).toThrow(LeaderStateError);
    });

    it('should return early for index less than or equal to current match index in updateMatchIndex', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node1', 4);
        expect(leaderState.getMatchIndex('node1')).toBe(5);
        leaderState.updateMatchIndex('node1', 5);
        expect(leaderState.getMatchIndex('node1')).toBe(5);
    });

    it('should commit highest index replicated on majority in current term', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);

        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 5);
        leaderState.updateMatchIndex('node3', 2);

        const logManager = {
            getLastIndex: vi.fn().mockReturnValue(5),
            getTermAtIndex: vi.fn().mockResolvedValue(2)
        } as any;

        const commitIdx = await leaderState.calculateCommitIndex(2, logManager);

        expect(commitIdx).toBe(5);
    });

    it('should not commit index replicated on majority if term does not match', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);

        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 5);
        leaderState.updateMatchIndex('node3', 2);

        const logManager = {
            getLastIndex: vi.fn().mockReturnValue(5),
            getTermAtIndex: vi.fn().mockResolvedValue(1)
        } as any;

        const commitIdx = await leaderState.calculateCommitIndex(2, logManager);

        expect(commitIdx).toBe(0);
    });

    it('should return 0 if no index is replicated on majority in current term', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);

        leaderState.updateMatchIndex('node1', 5);
        // leaderState.updateMatchIndex('node2', 2);
        // leaderState.updateMatchIndex('node3', 2);

        const logManager = {
            getLastIndex: vi.fn().mockReturnValue(5),
            getTermAtIndex: vi.fn().mockResolvedValue(2)
        } as any;

        const commitIdx = await leaderState.calculateCommitIndex(2, logManager);

        expect(commitIdx).toBe(0);
    });

    it('should commit highest index replicated on majority even if some nodes are behind', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);

        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 4);
        leaderState.updateMatchIndex('node3', 2);

        const logManager = {
            getLastIndex: vi.fn().mockReturnValue(5),
            getTermAtIndex: vi.fn().mockResolvedValue(2)
        } as any;

        const commitIdx = await leaderState.calculateCommitIndex(2, logManager);

        expect(commitIdx).toBe(4);
    });

    it('should commit when in single node cluster', async () => {
        const leaderState = new LeaderState([], lastLogIndex);

        const logManager = {
            getLastIndex: vi.fn().mockReturnValue(5),
            getTermAtIndex: vi.fn().mockResolvedValue(2)
        } as any;

        const commitIdx = await leaderState.calculateCommitIndex(2, logManager);

        expect(commitIdx).toBe(5);
    });

    it('should ignore index 0 in commit index calculation', async () => {
        const leaderState = new LeaderState(peers, 0);

        leaderState.updateMatchIndex('node1', 0);
        leaderState.updateMatchIndex('node2', 0);
        leaderState.updateMatchIndex('node3', 0);

        const logManager = {
            getLastIndex: vi.fn().mockReturnValue(0),
            getTermAtIndex: vi.fn().mockResolvedValue(2)
        } as any;

        const commitIdx = await leaderState.calculateCommitIndex(2, logManager);

        expect(commitIdx).toBe(0);
    });

    it('should determine if index is replicated on majority', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 5);
        leaderState.updateMatchIndex('node3', 2);
        expect(leaderState.isReplicatedOnMajority(5)).toBe(true);
    });

    it('should determine if index is not replicated on majority', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 4);
        leaderState.updateMatchIndex('node3', 2);
        expect(leaderState.isReplicatedOnMajority(5)).toBe(false);
    });

    it('should get majority match index correctly', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 4);
        leaderState.updateMatchIndex('node3', 2);
        expect(leaderState.getMajorityMatchIndex(5)).toBe(4);
    });

    it('should get majority match index correctly when some nodes are at same index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 5);
        leaderState.updateMatchIndex('node3', 2);
        expect(leaderState.getMajorityMatchIndex(5)).toBe(5);
    });

    it('should get majority match index correctly when all nodes are behind', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 3);
        leaderState.updateMatchIndex('node2', 2);
        leaderState.updateMatchIndex('node3', 1);
        expect(leaderState.getMajorityMatchIndex(5)).toBe(2);
    });
    
    it('should get majority match index correctly in single node cluster', () => {
        const leaderState = new LeaderState([], lastLogIndex);
        expect(leaderState.getMajorityMatchIndex(5)).toBe(5);
    });

    it('should return if an index is fully replicated on every node', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 5);
        leaderState.updateMatchIndex('node3', 5);
        expect(leaderState.isFullyReplicated(5)).toBe(true);
    });

    it('should return if an index is not fully replicated on every node', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 4);
        leaderState.updateMatchIndex('node3', 5);
        expect(leaderState.isFullyReplicated(5)).toBe(false);
    });

    it('should get peers behind a target index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 4);
        leaderState.updateMatchIndex('node3', 2);
        expect(leaderState.getPeersBehind(5)).toEqual(['node2', 'node3']);
    });

    it('should get empty array for peers behind if all are at or ahead of target index', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 5);
        leaderState.updateMatchIndex('node3', 5);
        expect(leaderState.getPeersBehind(5)).toEqual([]);
    });

    it('should get snapshot correctly', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 4);
        leaderState.updateMatchIndex('node3', 2);
        const snapshot = leaderState.snapshot();
        expect(snapshot.get('node1')).toEqual({ nextIndex: 6, matchIndex: 5 });
        expect(snapshot.get('node2')).toEqual({ nextIndex: 5, matchIndex: 4 });
        expect(snapshot.get('node3')).toEqual({ nextIndex: 3, matchIndex: 2 });
    });

    it('should reset correctly', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 4);
        leaderState.updateMatchIndex('node3', 2);
        leaderState.reset(3);
        expect(leaderState.getNextIndex('node1')).toBe(4);
        expect(leaderState.getNextIndex('node2')).toBe(4);
        expect(leaderState.getNextIndex('node3')).toBe(4);
        expect(leaderState.getMatchIndex('node1')).toBe(0);
        expect(leaderState.getMatchIndex('node2')).toBe(0);
        expect(leaderState.getMatchIndex('node3')).toBe(0);
    });

    it('should reset with default lastLogIndex of 0', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        leaderState.updateMatchIndex('node1', 5);
        leaderState.updateMatchIndex('node2', 4);
        leaderState.updateMatchIndex('node3', 2);
        leaderState.reset();
        expect(leaderState.getNextIndex('node1')).toBe(1);
        expect(leaderState.getNextIndex('node2')).toBe(1);
        expect(leaderState.getNextIndex('node3')).toBe(1);
        expect(leaderState.getMatchIndex('node1')).toBe(0);
        expect(leaderState.getMatchIndex('node2')).toBe(0);
        expect(leaderState.getMatchIndex('node3')).toBe(0);
    });

    it('should return a list of peers', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        expect(leaderState.getPeers()).toEqual(peers);
        expect(leaderState.getPeers()).not.toBe(peers);
    });

    it('should throw if matchIndex size is inconsistent with peers size in getMajorityMatchIndex', () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        (leaderState as any)['matchIndex'].clear();
        expect(() => leaderState.getMajorityMatchIndex(5)).toThrow(LeaderStateError);
    });

    it('should set next index to conflict index when conflict term is 0', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        const logManager = {
            getLastIndex: vi.fn(),
            getTermAtIndex: vi.fn()
        } as any;
        await leaderState.updateNextIndexWithConflict('node1', 3, 0, logManager);
        expect(leaderState.getNextIndex('node1')).toBe(3);
    });

    it('should set next index to last index of termm + 1 when term is found in log', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        const logManager = {
            getLastIndex: vi.fn().mockReturnValue(5),
            getTermAtIndex: vi.fn().mockImplementation(async (idx: number) => {
                const terms: { [index: number]: number } = { 5:3, 4:3, 3:2, 2:1, 1:1 };
                return terms[idx];
            })
        } as any;
        await leaderState.updateNextIndexWithConflict('node1', 2, 2, logManager);
        expect(leaderState.getNextIndex('node1')).toBe(4);
    });

    it('should fall back to conflict index when term is not found in log', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        const logManager = {
            getLastIndex: vi.fn().mockReturnValue(5),
            getTermAtIndex: vi.fn().mockResolvedValue(1)
        } as any;
        await leaderState.updateNextIndexWithConflict('node1', 3, 2, logManager);
        expect(leaderState.getNextIndex('node1')).toBe(3);
    });

    it('should set next indexx to minimum of 1 when result would be less than 1', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        const logManager = {
            getLastIndex: vi.fn(),
            getTermAtIndex: vi.fn()
        } as any;
        const getNextIndexSpy = vi.spyOn(leaderState, 'getNextIndex')
        const setNextIndexSpy = vi.spyOn(leaderState, 'setNextIndex')

        getNextIndexSpy.mockReturnValueOnce(0);
        getNextIndexSpy.mockRestore();

        vi.spyOn(leaderState, 'getNextIndex').mockReturnValueOnce(0);

        await leaderState.updateNextIndexWithConflict('node1', 0, 0, logManager);

        expect(setNextIndexSpy).toHaveBeenCalledWith('node1', 1);
        expect(leaderState.getNextIndex('node1')).toBe(1);
    });

    it('should throw for invalid peer', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        const logManager = {
            getLastIndex: vi.fn(),
            getTermAtIndex: vi.fn()
        } as any;
        await expect(leaderState.updateNextIndexWithConflict('invalidNode', 3, 0, logManager)).rejects.toThrow(LeaderStateError);
    });

    it('should stop searching when a term is found that is less than the conflict term', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        const getTermAtIndexMock = vi.fn().mockImplementation(async (idx: number) => {
            const terms: { [index: number]: number } = { 5:4, 4:3, 3:1, 2:1, 1:1 };
            return terms[idx];
        });
        const logManager = {
             getLastIndex: vi.fn().mockReturnValue(5),
             getTermAtIndex: getTermAtIndexMock
        } as any;
        await leaderState.updateNextIndexWithConflict('node1', 3, 2, logManager);
        expect(leaderState.getNextIndex('node1')).toBe(3);
        expect(getTermAtIndexMock).not.toHaveBeenCalledWith(2);
        expect(getTermAtIndexMock).not.toHaveBeenCalledWith(1);
    });

    it('should treat missing log entries as having term 0 in findLastIndexOfTerm', async () => {
        const leaderState = new LeaderState(peers, lastLogIndex);
        const logManager = {
             getLastIndex: vi.fn().mockReturnValue(5),
             getTermAtIndex: vi.fn().mockResolvedValue(undefined)
        } as any;
        await leaderState.updateNextIndexWithConflict('node1', 3, 2, logManager);
        expect(leaderState.getNextIndex('node1')).toBe(3);
        expect(logManager.getTermAtIndex).toHaveBeenCalledTimes(1);
    });
});