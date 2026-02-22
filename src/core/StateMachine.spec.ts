import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateMachine, RaftState } from './StateMachine';
import { RaftError } from '../util/Error';

describe('StateMachine.ts, StateMachine', () => {

    const nodeId = 'node1';
    const peers = ['node2', 'node3'];

    let persistentState: { 
        getCurrentTerm: ReturnType<typeof vi.fn>,
        getVotedFor: ReturnType<typeof vi.fn>,
        updateTermAndVote: ReturnType<typeof vi.fn>,
    };

    let volatileState: {
        getCommitIndex: ReturnType<typeof vi.fn>,
        setCommitIndex: ReturnType<typeof vi.fn>,
    };

    let logManager: {
        getLastIndex: ReturnType<typeof vi.fn>,
        getLastTerm: ReturnType<typeof vi.fn>,
        getTermAtIndex: ReturnType<typeof vi.fn>,
        getEntriesFromIndex: ReturnType<typeof vi.fn>,
        appendEntriesFrom: ReturnType<typeof vi.fn>,
        matchesPrevLog: ReturnType<typeof vi.fn>,
        getConflictInfo: ReturnType<typeof vi.fn>,
        calculateCommitIndex: ReturnType<typeof vi.fn>
    };

    let rpcHandler: {
        sendRequestVote: ReturnType<typeof vi.fn>,
        sendAppendEntries: ReturnType<typeof vi.fn>,
    };

    let timerManager: {
        startElectionTimer: ReturnType<typeof vi.fn>,
        stopAllTimers: ReturnType<typeof vi.fn>,
        startHeartbeatTimer: ReturnType<typeof vi.fn>,
        stopHeartbeatTimer: ReturnType<typeof vi.fn>,
        resetElectionTimer: ReturnType<typeof vi.fn>,
    };

    let logger: {
        info: ReturnType<typeof vi.fn>,
        debug: ReturnType<typeof vi.fn>,
        error: ReturnType<typeof vi.fn>,
        warn: ReturnType<typeof vi.fn>,
    };

    let config: { electionTimeoutMs: number, heartbeatIntervalMs: number };

    let onCommitIndexAdvanced: ReturnType<typeof vi.fn>;

    let stateMachine: StateMachine;

    const baseRequest = {
        term: 1,
        candidateId: 'node2',
        lastLogIndex: 0,
        lastLogTerm: 0,
    };

    const baseRequest2 = {
        term: 1,
        leaderId: 'node2',
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [],
        leaderCommit: 0,
    };

    beforeEach(() => {
        persistentState = {
            getCurrentTerm: vi.fn().mockReturnValue(1),
            getVotedFor: vi.fn().mockReturnValue(null),
            updateTermAndVote: vi.fn().mockResolvedValue(undefined),
        };

        volatileState = {
            getCommitIndex: vi.fn().mockReturnValue(0),
            setCommitIndex: vi.fn(),
        };

        logManager = {
            getLastIndex: vi.fn().mockReturnValue(0),
            getLastTerm: vi.fn().mockReturnValue(0),
            getTermAtIndex: vi.fn().mockReturnValue(null),
            getEntriesFromIndex: vi.fn().mockReturnValue([]),
            appendEntriesFrom: vi.fn().mockResolvedValue(0),
            matchesPrevLog: vi.fn().mockReturnValue(true),
            getConflictInfo: vi.fn().mockReturnValue({ conflictIndex: 1, conflictTerm: 0 }),
            calculateCommitIndex: vi.fn().mockReturnValue(0),
        };

        rpcHandler = {
            sendRequestVote: vi.fn().mockResolvedValue({ term: 1, voteGranted: true }),
            sendAppendEntries: vi.fn().mockResolvedValue({ term: 1, success: true, matchIndex: 0 }),
        };

        timerManager = {
            startElectionTimer: vi.fn(),
            stopAllTimers: vi.fn(),
            startHeartbeatTimer: vi.fn(),
            stopHeartbeatTimer: vi.fn(),
            resetElectionTimer: vi.fn(),
        };

        logger = {
            info: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        };

        config = { electionTimeoutMs: 150, heartbeatIntervalMs: 50 };

        onCommitIndexAdvanced = vi.fn();

        stateMachine = new StateMachine(
            nodeId,
            peers,
            config as any,
            persistentState as any,
            volatileState as any,
            logManager as any,
            rpcHandler as any,
            timerManager as any,
            logger as any,
            onCommitIndexAdvanced as any
        );
    });

    it('should start as a follower', () => {
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
    });

    it('should have no leader initially', () => {
        expect(stateMachine.getCurrentLeader()).toBeNull();
    });

    it('should not be a leader initially', () => {
        expect(stateMachine.isLeader()).toBe(false);
    });

    it('should start as Follower and start election timer', async () => {
        await stateMachine.start();
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect(timerManager.startElectionTimer).toHaveBeenCalled();
    });

    it('should stop all timers on stop', async () => {
        await stateMachine.start();
        await stateMachine.stop();
        expect(timerManager.stopAllTimers).toHaveBeenCalled();
    });

    it('should transistion to follower state', async () => {
        await stateMachine.becomeFollower(1, null);
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
    });

    it('should update current leader', async () => {
        await stateMachine.becomeFollower(1, 'node2');
        expect(stateMachine.getCurrentLeader()).toBe('node2');
    });

    it('should update term and clear vote when new term is higher', async () => {
        await stateMachine.becomeFollower(2, null);
        expect(persistentState.updateTermAndVote).toHaveBeenCalledWith(2, null);
    });

    it('should not update term when same term is received', async () => {
        await stateMachine.becomeFollower(1, null);
        expect(persistentState.updateTermAndVote).not.toHaveBeenCalledWith(1, null);
    });

    it('should start election timer when becoming follower', async () => {
        await stateMachine.becomeFollower(1, null);
        expect(timerManager.startElectionTimer).toHaveBeenCalled();
    });

    it('should stop heartbeat timer and clear leader when transitioning from leader to follower', async () => {
        await stateMachine.becomeLeader();
        expect(stateMachine.isLeader()).toBe(true);

        await stateMachine.becomeFollower(2, null);
        expect(timerManager.stopHeartbeatTimer).toHaveBeenCalled();
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
    });

    it('should transition to candidate state', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 2, voteGranted: false });
        await stateMachine.becomeCandidate();
        expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
    });

    it('should increment term', async () => {
        await stateMachine.becomeCandidate();
        expect(persistentState.updateTermAndVote).toHaveBeenCalledWith(2, nodeId);
    });

    it('should vote for self when becoming candidate', async () => {
        await stateMachine.becomeCandidate();
        expect(persistentState.updateTermAndVote).toHaveBeenCalledWith(2, nodeId);
    });

    it('should clear current leader when becoming candidate', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 2, voteGranted: false });
        await stateMachine.becomeFollower(1, 'node2');
        await stateMachine.becomeCandidate();
        expect(stateMachine.getCurrentLeader()).toBeNull();
    });

    it('should send requestvote RPCs to peers when becoming candidate', async () => {
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(rpcHandler.sendRequestVote).toHaveBeenCalledTimes(peers.length);
        });
    });

    it('should become leader when majority votes received if there are no peers', async () => {
        const emptyPeersStateMachine = new StateMachine(
            nodeId,
            [],
            config as any,
            persistentState as any,
            volatileState as any,
            logManager as any,
            rpcHandler as any,
            timerManager as any,
            logger as any,
            onCommitIndexAdvanced as any
        );
        await emptyPeersStateMachine.becomeCandidate();
        expect(emptyPeersStateMachine.getCurrentState()).toBe(RaftState.Candidate);
    });

    it('should transition to leader state', async () => {
        await stateMachine.becomeLeader();
        expect(stateMachine.getCurrentState()).toBe(RaftState.Leader);
    });

    it('should set itself as leader', async () => {
        await stateMachine.becomeLeader();
        expect(stateMachine.getCurrentLeader()).toBe(nodeId);
    });

    it('should be recognized as leader', async () => {
        await stateMachine.becomeLeader();
        expect(stateMachine.isLeader()).toBe(true);
    });

    it('should start heartbeat timer when becoming leader', async () => {
        await stateMachine.becomeLeader();
        expect(timerManager.startHeartbeatTimer).toHaveBeenCalled();
    });

    it('should send initial heartbeats to all peers when becoming leader', async () => {
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });
    });

    it('should reject vote when request term is stale', async () => {
        persistentState.getCurrentTerm.mockReturnValue(5);
        const response = await stateMachine.handleRequestVote('node2', { ...baseRequest, term: 3 });
        expect(response).toEqual({ term: 5, voteGranted: false });
    });

    it('should step down and update term when request term is higher', async () => {
        const response = await stateMachine.handleRequestVote('node2', { ...baseRequest, term: 10 });
        expect(persistentState.updateTermAndVote).toHaveBeenCalledWith(10, null);
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
    });

    it('should reject vote when already voted for a different candidate in the same term', async () => {
        persistentState.getVotedFor.mockReturnValue('node3');
        const response = await stateMachine.handleRequestVote('node2', { ...baseRequest, term: 1 });
        expect(response).toEqual({ term: 1, voteGranted: false });
    });

    it('should grant vote when voted for same candidate in the same term', async () => {
        persistentState.getVotedFor.mockReturnValue('node2');
        const response = await stateMachine.handleRequestVote('node2', { ...baseRequest, term: 1 });
        expect(response).toEqual({ term: 1, voteGranted: true });
    });

    it('should reject vote when candidate log is not up-to-date term', async () => {
        logManager.getLastTerm.mockReturnValue(3);
        const response = await stateMachine.handleRequestVote('node2', { ...baseRequest, lastLogTerm: 2 });
        expect(response.voteGranted).toBe(false);
    });

    it('should reject vote when canidate log is not up to date lower index same term', async () => {
        logManager.getLastTerm.mockReturnValue(1);
        logManager.getLastIndex.mockReturnValue(5);
        const response = await stateMachine.handleRequestVote('node2', { ...baseRequest, lastLogTerm: 1, lastLogIndex: 3 });
        expect(response.voteGranted).toBe(false);
    });

    it('should grant vote when candidate log is up-to-date', async () => {
        const response = await stateMachine.handleRequestVote('node2', baseRequest);
        expect(response.voteGranted).toBe(true);
        expect(persistentState.updateTermAndVote).toHaveBeenCalledWith(1, 'node2');
    });

    it('should reset election timer when granting vote', async () => {
        const response = await stateMachine.handleRequestVote('node2', baseRequest);
        expect(timerManager.resetElectionTimer).toHaveBeenCalled();
    });

    it('should not reset election timer when rejecting vote', async () => {
        persistentState.getVotedFor.mockReturnValue('node3');
        const response = await stateMachine.handleRequestVote('node2', baseRequest);
        expect(timerManager.resetElectionTimer).not.toHaveBeenCalled();
    });

    it('should reject when request term is stale', async () => {
        persistentState.getCurrentTerm.mockReturnValue(5);
        const response = await stateMachine.handleAppendEntries('node2', { ...baseRequest2, term: 3 });
        expect(response).toEqual({ term: 5, success: false });
    });

    it('should step down and update leader when request term is higher', async () => {
        const response = await stateMachine.handleAppendEntries('node2', { ...baseRequest2, term: 10 });
        expect(persistentState.updateTermAndVote).toHaveBeenCalledWith(10, null);
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect(stateMachine.getCurrentLeader()).toBe('node2');
    });

    it('should step down when same term received', async () => {
        await stateMachine.becomeCandidate();
        persistentState.getCurrentTerm.mockReturnValue(2);
        const response = await stateMachine.handleAppendEntries('node2', { ...baseRequest2, term: 2 });
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect(stateMachine.getCurrentLeader()).toBe('node2');
    });

    it('should return conflict info when log does not match', async () => {
        logManager.matchesPrevLog.mockReturnValue(false);
        logManager.getConflictInfo.mockReturnValue({ conflictIndex: 5, conflictTerm: 3 });
        const response = await stateMachine.handleAppendEntries('node2', baseRequest2);
        expect(response).toEqual({ term: 1, success: false, conflictIndex: 5, conflictTerm: 3 });
    });

    it('should append entries when log matches', async () => {
        const entries = [{ index: 1, term: 1, command: { type: 'set', payload: { key: 'x', value: 10 } } }];
        const response = await stateMachine.handleAppendEntries('node2', { ...baseRequest2, entries });
        expect(logManager.appendEntriesFrom).toHaveBeenCalledWith(0, entries);
        expect(response).toEqual({ term: 1, success: true, matchIndex: 1 });
    });

    it('should not call appendEntriesFrom when entries is empty', async () => {
        await stateMachine.handleAppendEntries('node2', baseRequest2);
        expect(logManager.appendEntriesFrom).not.toHaveBeenCalled();
    });

    it('should update commit index when leaderCommit is higher than current commit index', async () => {
        volatileState.getCommitIndex.mockReturnValue(0);
        const response = await stateMachine.handleAppendEntries('node2', { ...baseRequest2, prevLogIndex: 2, entries: [{ index: 3, term: 1, command: { type: 'set', payload: { key: 'x', value: 10 } } }], leaderCommit: 3 });
        expect(volatileState.setCommitIndex).toHaveBeenCalledWith(3);
        expect(onCommitIndexAdvanced).toHaveBeenCalledWith(3);
    });

    it('should not update commit index when leaderCommit is not higher than current commit index', async () => {
        volatileState.getCommitIndex.mockReturnValue(3);
        await stateMachine.handleAppendEntries('node2', { ...baseRequest2, leaderCommit: 3 });
        expect(volatileState.setCommitIndex).not.toHaveBeenCalled();
        expect(onCommitIndexAdvanced).not.toHaveBeenCalled();
    });

    it('should clamp new commit index to last new entry index', async () => {
        volatileState.getCommitIndex.mockReturnValue(0);
        await stateMachine.handleAppendEntries('node2', { ...baseRequest2, prevLogIndex: 1, entries: [{ index: 2, term: 1, command: { type: 'set', payload: { key: 'x', value: 10 } } }], leaderCommit: 10 });
        expect(volatileState.setCommitIndex).toHaveBeenCalledWith(2);
    });

    it('should return correct matchindex on succes', async () => {
        const response = await stateMachine.handleAppendEntries('node2', { ...baseRequest2, prevLogIndex: 3, entries: [{ index: 4, term: 1, command: { type: 'set', payload: { key: 'x', value: 10 } } }] });
        expect(response).toEqual({ term: 1, success: true, matchIndex: 4 });
    });

    it('should become leader when majority of votes received', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: true });
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Leader);
        });
    });

    it('should become follower when response has higher term', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 10, voteGranted: false });
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        });
    });

    it('should not become leader when vote is rejected', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).not.toBe(RaftState.Leader);
        });
        expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
    });

    it('shoulld log error when sendRequestVote RPC fails', async () => {
        rpcHandler.sendRequestVote.mockRejectedValue(new Error('RPC failed'));
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalled();
        });
    });

    it('should ignore response with mismatched term', async () => {
        persistentState.getCurrentTerm
            .mockReturnValueOnce(1)
            .mockReturnValueOnce(2)
            .mockReturnValue(2);
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: true });
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(rpcHandler.sendRequestVote).toHaveBeenCalled();
        });
        expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
    });

    it('should update match index on succes and try to advance commit index', async () => {
        rpcHandler.sendAppendEntries.mockResolvedValue({ term: 1, success: true, matchIndex: 3 });
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(logManager.getLastIndex).toHaveBeenCalled();
        });
    });

    it('should become follower when response has higher term on appendEntries response', async () => {
        rpcHandler.sendAppendEntries.mockResolvedValue({ term: 10, success: false, matchIndex: 0 });
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        });
    });

    it('should decrement nextIndex when failure has no conflict info', async () => {
        logManager.getLastIndex.mockReturnValue(5);
        logManager.getEntriesFromIndex.mockReturnValue([]);
        rpcHandler.sendAppendEntries.mockResolvedValue({ term: 1, success: false });
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalled();
        });
    });

    it('should use conflict info to update nextIndex on appendEntries failure', async () => {
        logManager.getTermAtIndex.mockResolvedValue(null);
        rpcHandler.sendAppendEntries.mockResolvedValue({ term: 1, success: false, conflictIndex: 3, conflictTerm: 2 });
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalled();
        });
    });

    it('should log error when sendAppendEntries RPC fails', async () => {
        rpcHandler.sendAppendEntries.mockRejectedValue(new Error('RPC failed'));
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalled();
        });
    });

    it('should log error when succes response has undefined matchIndex', async () => {
        rpcHandler.sendAppendEntries.mockResolvedValue({ term: 1, success: true, matchIndex: undefined });
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalled();
        });
    });

    it('should send appendEntreis to peers when leader', async () => {
        await stateMachine.becomeLeader();
        rpcHandler.sendAppendEntries.mockClear();
        await stateMachine.triggerReplication();
        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });
    });

    it('should not send appendEntries when not leader', async () => {
        await stateMachine.triggerReplication();
        expect(rpcHandler.sendAppendEntries).not.toHaveBeenCalled();
    });

    it('should call onCommitIndexAdvanced when commit index advances as a follower', async () => {
        volatileState.getCommitIndex.mockReturnValue(0);
        await stateMachine.handleAppendEntries('node2', {
            term: 1,
            leaderId: 'node2',
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [{ index: 1, term: 1, command: { type: 'set', payload: { key: 'x', value: 10 } } }],
            leaderCommit: 1
        });
        expect(onCommitIndexAdvanced).toHaveBeenCalledWith(1);
    });

    it('should trigger election timeout and become candidate when election timer expires', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });
        timerManager.startElectionTimer.mockImplementationOnce((callback: () => void) => {
            callback();
        });
        await stateMachine.becomeFollower(1, null);
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
        });
    });

    it('should trigger election timeout and become candidate when election timer expires', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });
        timerManager.startElectionTimer.mockImplementationOnce((callback: () => void) => {
            callback();
        });
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
        });
    });

    it('should send heartbeats when heartbeat timer fires during becomeing leader', async () => {
        timerManager.startHeartbeatTimer.mockImplementationOnce((callback: () => void) => {
            callback();
        });

        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length * 2);
        });
    });

    it('should grant vote when candidate log term is higher than local log term', async () => {
        logManager.getLastTerm.mockReturnValue(1);
        logManager.getLastIndex.mockReturnValue(5);

        const response = await stateMachine.handleRequestVote('node2', {
            term: 1,
            candidateId: 'node2',
            lastLogIndex: 1,
            lastLogTerm: 2,
        });
        expect(response.voteGranted).toBe(true);
    });

    it('should return early from election timeout handler if not follower or candidate', async () => {
        let captureCallback: (() => void) | null = null;
        timerManager.startElectionTimer.mockImplementationOnce((callback: () => void) => {
            captureCallback = callback;
        });

        await stateMachine.start();
        await stateMachine.becomeLeader();
        expect(captureCallback).not.toBeNull();
        await captureCallback!();
        expect(stateMachine.getCurrentState()).toBe(RaftState.Leader);
        expect(persistentState.updateTermAndVote).not.toHaveBeenCalled();
    });

    it('should trigger election timeout callback registered in becomeFollowerUnlocked', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });
        let captureCallback: (() => void) | null = null;
        timerManager.startElectionTimer.mockImplementationOnce((callback: () => void) => {
            captureCallback = callback;
        });

        await stateMachine.handleRequestVote('node2', {
            term: 5,
            candidateId: 'node2',
            lastLogIndex: 0,
            lastLogTerm: 0,
        });
        expect(captureCallback).not.toBeNull();
        await captureCallback!();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
        });
    });

    it('"should trigger election timeout callback registered in becomeCandidateUnlocked', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });
        let callCounter = 0;
        let captureCallback: (() => void) | null = null;
        timerManager.startElectionTimer.mockImplementation((callback: () => void) => {
            callCounter++;
            if (callCounter ===  1) {
                callback();
            } else {
                captureCallback = callback;
            }
        });
        await stateMachine.becomeFollower(1, null);
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
        });
        expect(captureCallback).not.toBeNull();
        await captureCallback!();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
        });
    });

    it('should trigger hearbeat callback registered in becomeLeaderUnlocked', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: true });
        let captureCallback: (() => void) | null = null;
        timerManager.startHeartbeatTimer.mockImplementationOnce((callback: () => void) => {
            captureCallback = callback;
        });
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Leader);
        });
        rpcHandler.sendAppendEntries.mockClear();
        expect(captureCallback).not.toBeNull();
        await captureCallback!();
        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });
    });

    it('should log error with String() when sendRequestVote RPC fails', async () => {
        rpcHandler.sendRequestVote.mockRejectedValue('plain string error');
        await stateMachine.becomeCandidate();
        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('plain string error'));
        });
    });

    it('should log error with String() when sendAppendEntries RPC fails', async () => {
        rpcHandler.sendAppendEntries.mockRejectedValue('plain string error');
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('plain string error'));
        });
    });

    it('should return ealr from sendHeartbeatsUnlocked when node is not a leader', async () => {
        let captureCallback: (() => void) | null = null;
        timerManager.startHeartbeatTimer.mockImplementation((callback: () => void) => {
            captureCallback = callback;
        });
        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        rpcHandler.sendAppendEntries.mockClear();

        (stateMachine as any)['currentState'] = RaftState.Follower;

        expect(captureCallback).not.toBeNull();
        await captureCallback!();
        expect(rpcHandler.sendAppendEntries).not.toHaveBeenCalled();
    });

    it('should throw raftError from sendheartbeatsUnlocked when leaderId is null', async () => {
        let captureCallback: (() => void) | null = null;
        timerManager.startHeartbeatTimer.mockImplementation((callback: () => void) => {
            captureCallback = callback;
        });
        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        (stateMachine as any)['leaderState'] = null;

        expect(captureCallback).not.toBeNull();
        await expect(captureCallback!()).rejects.toThrow(RaftError);
    });

    it('should log debug and return early from sendappendEntries when leaderId is null', async () => {
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        rpcHandler.sendAppendEntries.mockClear();

        (stateMachine as any)['leaderState'] = null;

        await (stateMachine as any)['sendAppendEntries']('node2');
        expect(logger.debug).toHaveBeenCalled();
        // expect(rpcHandler.sendAppendEntries).toHaveBeenCalledWith('node2', undefined); not the case anymore
    });

    it('should return early when AppendEntriesResponse term does not match current term', async () => {
        await stateMachine.becomeLeader();
        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        rpcHandler.sendAppendEntries.mockResolvedValue({ term: 0, success: true, matchIndex: 1 });

        await (stateMachine as any)['sendAppendEntries']('node2');
        expect(logger.info).toHaveBeenCalled();
    });

    it('should return early when AppendEntriesResponse received but node is no longer leader', async () => {
        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        rpcHandler.sendAppendEntries.mockResolvedValue({ term: 1, success: true, matchIndex: 1 });
        (stateMachine as any)['currentState'] = RaftState.Follower;

        await (stateMachine as any)['sendAppendEntries']('node2');
        expect(logger.info).toHaveBeenCalled();
    });

    it('should throw raftError in tryAdvanceCommitIndex when leaderState is null', async () => {
        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        (stateMachine as any)['leaderState'] = null;

        await expect((stateMachine as any)['tryAdvanceCommitIndex']()).rejects.toThrow(RaftError);
    });

    it('should advance commit index and call onCommitIndexAdvanced when newCommitIndex is higher', async () => {
        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        const leaderState = (stateMachine as any)['leaderState'];

        vi.spyOn(leaderState, 'calculateCommitIndex').mockResolvedValue(3);

        volatileState.getCommitIndex.mockReturnValue(0);

        await (stateMachine as any)['tryAdvanceCommitIndex']();
        expect(volatileState.setCommitIndex).toHaveBeenCalledWith(3);
        expect(onCommitIndexAdvanced).toHaveBeenCalledWith(3);
    });

    it('should call becomeFollowerUnlocked when appendEntries term equals current term', async () => {
        persistentState.getCurrentTerm.mockReturnValue(1);

        const response = await stateMachine.handleAppendEntries('node2', {
            term: 1,
            leaderId: 'node2',
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [],
            leaderCommit: 0,
        });
        expect(response.success).toBe(true);
        expect(stateMachine.getCurrentLeader()).toBe('node2');
        expect(persistentState.updateTermAndVote).not.toHaveBeenCalled();
    });

    it('should not become leader when vote is granted but majority is not achieved', async () => {
        const largePeers = ['node2', 'node3', 'node4'];
        const largeMachine = new StateMachine(
            nodeId,
            largePeers,
            config as any,
            persistentState as any,
            volatileState as any,
            logManager as any,
            rpcHandler as any,
            timerManager as any,
            logger as any,
            onCommitIndexAdvanced as any
        );

        rpcHandler.sendRequestVote
            .mockResolvedValueOnce({ term: 1, voteGranted: true })
            .mockResolvedValueOnce({ term: 1, voteGranted: false })
            .mockResolvedValueOnce({ term: 1, voteGranted: false });

        await largeMachine.becomeCandidate();

        await vi.waitFor(() => {
            expect(largeMachine.getCurrentState()).toBe(RaftState.Candidate);
        });

        expect(largeMachine.getCurrentState()).not.toBe(RaftState.Leader);
        expect(logger.info).toHaveBeenCalled();
    });
});
