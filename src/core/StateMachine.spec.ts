import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateMachine, RaftState } from './StateMachine';
import { RaftError } from '../util/Error';
import { AsyncLock } from '../lock/AsyncLock';
import { ConfigManager } from '../config/ConfigManager';
import { getQuorumSize } from '../config/ClusterConfig';
import { LogEntry, LogEntryType } from '../log/LogEntry';

describe('StateMachine.ts, StateMachine', () => {

    const nodeId = 'node1';
    const peers = ['node2', 'node3'];
    const allVoters = [nodeId, ...peers];
    const defaultConfig = { 
        voters: [
            { id: 'node1', address: 'address1'},
            { id: 'node2', address: 'address2' },
            { id: 'node3', address: 'address3' }
        ],
        learners: []
    };

    let configManager: {
        isVoter: ReturnType<typeof vi.fn>,
        isLearner: ReturnType<typeof vi.fn>,
        getQuorumSize: ReturnType<typeof vi.fn>,
        getAllPeers: ReturnType<typeof vi.fn>,
        getVoters: ReturnType<typeof vi.fn>,
        applyConfigEntry: ReturnType<typeof vi.fn>,
        commitConfig: ReturnType<typeof vi.fn>,
    }

    let persistentState: { 
        getCurrentTerm: ReturnType<typeof vi.fn>,
        getVotedFor: ReturnType<typeof vi.fn>,
        updateTermAndVote: ReturnType<typeof vi.fn>,
    };

    let volatileState: {
        getCommitIndex: ReturnType<typeof vi.fn>,
        setCommitIndex: ReturnType<typeof vi.fn>,
        setLastApplied: ReturnType<typeof vi.fn>,
    };

    let logManager: {
        getLastIndex: ReturnType<typeof vi.fn>,
        getLastTerm: ReturnType<typeof vi.fn>,
        getTermAtIndex: ReturnType<typeof vi.fn>,
        getEntriesFromIndex: ReturnType<typeof vi.fn>,
        appendEntriesFrom: ReturnType<typeof vi.fn>,
        matchesPrevLog: ReturnType<typeof vi.fn>,
        getConflictInfo: ReturnType<typeof vi.fn>,
        calculateCommitIndex: ReturnType<typeof vi.fn>,
        discardEntriesUpTo: ReturnType<typeof vi.fn>,
        resetToSnapshot: ReturnType<typeof vi.fn>,
        getEntry: ReturnType<typeof vi.fn>,
        appendNoOpEntry: ReturnType<typeof vi.fn>,
    };

    let snapshotManager: {
        saveSnapshot: ReturnType<typeof vi.fn>,
        loadSnapshot: ReturnType<typeof vi.fn>,
        hasSnapshot: ReturnType<typeof vi.fn>,
        getSnapshotMetadata: ReturnType<typeof vi.fn>,
    };

    let applicationStateMachine: {
        apply: ReturnType<typeof vi.fn>,
        getState: ReturnType<typeof vi.fn>,
        takeSnapshot: ReturnType<typeof vi.fn>,
        installSnapshot: ReturnType<typeof vi.fn>,
    }

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

    let config: { electionTimeoutMinMs: number, electionTimeoutMaxMs: number, heartbeatIntervalMs: number };

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

        configManager = {
            isVoter: vi.fn().mockReturnValue(true),
            isLearner: vi.fn().mockReturnValue(false),
            getQuorumSize: vi.fn().mockReturnValue(2),
            getAllPeers: vi.fn().mockReturnValue(peers),
            getVoters: vi.fn().mockReturnValue(allVoters),
            applyConfigEntry: vi.fn(),
            commitConfig: vi.fn().mockResolvedValue(undefined),
        };

        persistentState = {
            getCurrentTerm: vi.fn().mockReturnValue(1),
            getVotedFor: vi.fn().mockReturnValue(null),
            updateTermAndVote: vi.fn().mockResolvedValue(undefined),
        };

        volatileState = {
            getCommitIndex: vi.fn().mockReturnValue(0),
            setCommitIndex: vi.fn(),
            setLastApplied: vi.fn(),
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
            discardEntriesUpTo: vi.fn().mockResolvedValue(undefined),
            resetToSnapshot: vi.fn().mockResolvedValue(undefined),
            getEntry: vi.fn().mockReturnValue(null),
            appendNoOpEntry: vi.fn().mockResolvedValue(1),
        };

        snapshotManager = {
            saveSnapshot: vi.fn().mockResolvedValue(undefined),
            loadSnapshot: vi.fn().mockResolvedValue(null),
            hasSnapshot: vi.fn().mockReturnValue(false),
            getSnapshotMetadata: vi.fn().mockReturnValue(null),
        };

        applicationStateMachine = {
            apply: vi.fn().mockResolvedValue(undefined),
            getState: vi.fn().mockReturnValue({}),
            takeSnapshot: vi.fn().mockResolvedValue(Buffer.alloc(0)),
            installSnapshot: vi.fn().mockResolvedValue(undefined),
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

        config = { electionTimeoutMinMs: 150, electionTimeoutMaxMs: 300, heartbeatIntervalMs: 50 };

        onCommitIndexAdvanced = vi.fn();

        stateMachine = new StateMachine(
            nodeId,
            configManager as any,
            config as any,
            persistentState as any,
            volatileState as any,
            logManager as any,
            snapshotManager as any,
            applicationStateMachine as any,
            rpcHandler as any,
            timerManager as any,
            logger as any,
            new AsyncLock(),
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

    it('should skip self vote when second voter check is false during candidate transition', async () => {
        configManager.isVoter.mockReset();
        configManager.isVoter
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);

        await stateMachine.becomeCandidate();

        const votesReceived = (stateMachine as any)['votesReceived'] as Set<string>;
        expect(votesReceived.has(nodeId)).toBe(false);
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

        const emptyConfigManager = {
            ...ConfigManager,
            isVoter: vi.fn().mockReturnValue(true),
            getQuorumSize: vi.fn().mockReturnValue(1),
            getAllPeers: vi.fn().mockReturnValue([]),
            getVoters: vi.fn().mockReturnValue([nodeId]),
        }

        const emptyPeersStateMachine = new StateMachine(
            nodeId,
            emptyConfigManager as any,
            config as any,
            persistentState as any,
            volatileState as any,
            logManager as any,
            snapshotManager as any,
            applicationStateMachine as any,
            rpcHandler as any,
            timerManager as any,
            logger as any,
            new AsyncLock(),
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

    it('should append initial no-op entry and log success when becoming leader', async () => {
        persistentState.getCurrentTerm.mockReturnValue(4);

        await stateMachine.becomeLeader();

        expect(logManager.appendNoOpEntry).toHaveBeenCalledWith(4);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('appended initial no-op entry for term 4'));
    });

    it('should log error when initial no-op append fails', async () => {
        logManager.appendNoOpEntry.mockRejectedValue(new Error('append no-op failed'));

        await stateMachine.becomeLeader();

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('failed to append initial no-op entry as Leader: append no-op failed'));
    });

    it('should stringify non-Error values when initial no-op append fails', async () => {
        logManager.appendNoOpEntry.mockRejectedValue('plain append no-op failure');

        await stateMachine.becomeLeader();

        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('failed to append initial no-op entry as Leader: plain append no-op failure'));
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

    it('should reject vote when candidate is not a voter', async () => {
        configManager.isVoter.mockReset();
        configManager.isVoter
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false);
        const response = await stateMachine.handleRequestVote('node4', { ...baseRequest, candidateId: 'node4', term: 1 });
        expect(response).toEqual({ term: 1, voteGranted: false });
        expect(persistentState.updateTermAndVote).not.toHaveBeenCalledWith(1, 'node4');
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
        const entries = [{ index: 1, term: 1, type: LogEntryType.COMMAND, command: { type: 'set', payload: { key: 'x', value: 10 } } }];
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
        const response = await stateMachine.handleAppendEntries('node2', { ...baseRequest2, prevLogIndex: 2, entries: [{ index: 3, term: 1, type: LogEntryType.COMMAND, command: { type: 'set', payload: { key: 'x', value: 10 } } }], leaderCommit: 3 });
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
        await stateMachine.handleAppendEntries('node2', { ...baseRequest2, prevLogIndex: 1, entries: [{ index: 2, term: 1, type: LogEntryType.COMMAND, command: { type: 'set', payload: { key: 'x', value: 10 } } }], leaderCommit: 10 });
        expect(volatileState.setCommitIndex).toHaveBeenCalledWith(2);
    });

    it('should return correct matchindex on succes', async () => {
        const response = await stateMachine.handleAppendEntries('node2', { ...baseRequest2, prevLogIndex: 3, entries: [{ index: 4, term: 1, type: LogEntryType.COMMAND, command: { type: 'set', payload: { key: 'x', value: 10 } } }] });
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
            entries: [{ index: 1, term: 1, type: LogEntryType.COMMAND, command: { type: 'set', payload: { key: 'x', value: 10 } } }],
            leaderCommit: 1
        });
        expect(onCommitIndexAdvanced).toHaveBeenCalledWith(1);
    });

    it('should trigger election timeout and become candidate when election timer expires', async () => {
        rpcHandler.sendRequestVote.mockImplementation((_peerId: string, request: any) =>
            Promise.resolve({ term: 1, voteGranted: !!request.preVote })
        );
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
        rpcHandler.sendRequestVote.mockImplementation((_peerId: string, request: any) =>
            Promise.resolve({ term: 1, voteGranted: !!request.preVote })
        );
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
        rpcHandler.sendRequestVote.mockImplementation((_peerId: string, request: any) =>
            Promise.resolve({ term: 1, voteGranted: !!request.preVote })
        );
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

        const largeConfigManager = {
            ...ConfigManager,
            isVoter: vi.fn().mockReturnValue(true),
            getQuorumSize: vi.fn().mockReturnValue(3),
            getAllPeers: vi.fn().mockReturnValue(largePeers),
            getVoters: vi.fn().mockReturnValue(['node1', ...largePeers]),
        };

        const largeMachine = new StateMachine(
            nodeId,
            largeConfigManager as any,
            config as any,
            persistentState as any,
            volatileState as any,
            logManager as any,
            snapshotManager as any,
            applicationStateMachine as any,
            rpcHandler as any,
            timerManager as any,
            logger as any,
            new AsyncLock(),
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

    it('should call updateTermAndVote when snapshot term exceeds current term', async () => {
        (rpcHandler as any).sendInstallSnapshot = vi.fn().mockResolvedValue({ term: 5, success: true });
        logManager.getLastIndex.mockReturnValue(10);

        await stateMachine.handleInstallSnapshot('node2', {
            term: 5, leaderId: 'node2',
            lastIncludedIndex: 5, lastIncludedTerm: 1,
            data: Buffer.from('snap'),
            config: { voters: [], learners: [] },
        });

        expect(persistentState.updateTermAndVote).toHaveBeenCalledWith(5, null);
    });

    it('should call resetToSnapshot when lastIncludedIndex exceeds lastIndex', async () => {
        persistentState.getCurrentTerm.mockReturnValue(1);
        logManager.getLastIndex.mockReturnValue(3);

        const resetSpy = vi.fn().mockResolvedValue(undefined);
        logManager['resetToSnapshot'] = resetSpy;

        await stateMachine.handleInstallSnapshot('node2', {
            term: 1,
            leaderId: 'node2',
            lastIncludedIndex: 10,
            lastIncludedTerm: 1,
            data: Buffer.from('snapshot'),
            config: { voters: [], learners: [] },
        });

        expect(resetSpy).toHaveBeenCalledWith(10, 1);
    });

    it('should reject InstallSnapshot with stale term and return current term', async () => {
        persistentState.getCurrentTerm.mockReturnValue(10);

        const response = await stateMachine.handleInstallSnapshot('node2', {
            term: 5,
            leaderId: 'node2',
            lastIncludedIndex: 3,
            lastIncludedTerm: 5,
            data: Buffer.from('snap'),
            config: { voters: [], learners: [] },
        });

        expect(response).toEqual({ term: 10, success: false });
        expect(persistentState.updateTermAndVote).not.toHaveBeenCalled();
        expect(snapshotManager.saveSnapshot).not.toHaveBeenCalled();
    });

    it('should trigger sendSnapshot path when nextIndex <= snapshotIndex', async () => {
        snapshotManager.getSnapshotMetadata.mockReturnValue({ lastIncludedIndex: 5 });

        const fakeSnapshot = {
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snapshot-data'),
            config: { voters: [], learners: [] },
        };
        snapshotManager.loadSnapshot.mockResolvedValue(fakeSnapshot);

        (rpcHandler as any).sendInstallSnapshot = vi.fn().mockResolvedValue({
            term: 1,
            success: true,
        });

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect((rpcHandler as any).sendInstallSnapshot).toHaveBeenCalled();
        });

        expect(rpcHandler.sendAppendEntries).not.toHaveBeenCalled();
    });

    it('should log error and return early from sendSnapshot when no snapshot is available', async () => {
        snapshotManager.getSnapshotMetadata.mockReturnValue({ lastIncludedIndex: 5 });
        snapshotManager.loadSnapshot.mockResolvedValue(null);

        (rpcHandler as any).sendInstallSnapshot = vi.fn();

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('has no snapshot to send'),
            );
        });

        expect((rpcHandler as any).sendInstallSnapshot).not.toHaveBeenCalled();
    });

    it('should become follower when InstallSnapshot response has higher term', async () => {
        snapshotManager.getSnapshotMetadata.mockReturnValue({ lastIncludedIndex: 5 });
        snapshotManager.loadSnapshot.mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snap'),
            config: { voters: [], learners: [] },
        });

        (rpcHandler as any).sendInstallSnapshot = vi.fn().mockResolvedValue({
            term: 99,
            success: false,
        });

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        });
    });

    it('should update matchIndex when InstallSnapshot succeeds', async () => {
        snapshotManager.getSnapshotMetadata.mockReturnValue({ lastIncludedIndex: 5 });
        snapshotManager.loadSnapshot.mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snap'),
            config: { voters: [], learners: [] },
        });

        (rpcHandler as any).sendInstallSnapshot = vi.fn().mockResolvedValue({
            term: 1,
            success: true,
        });

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('successfully sent snapshot'),
            );
        });
    });

    it('should log debug and return early from sendSnapshot response handler when leaderState is null', async () => {
        snapshotManager.getSnapshotMetadata.mockReturnValue({ lastIncludedIndex: 5 });
        snapshotManager.loadSnapshot.mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snap'),
            config: { voters: [], learners: [] },
        });

        (rpcHandler as any).sendInstallSnapshot = vi.fn().mockImplementation(async () => {
            (stateMachine as any)['leaderState'] = null;
            return { term: 1, success: true };
        });

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(logger.debug).toHaveBeenCalledWith(
                expect.stringContaining('received InstallSnapshotResponse'),
            );
        });
    });

    it('should log Error instance when sendInstallSnapshot RPC throws', async () => {
        snapshotManager.getSnapshotMetadata.mockReturnValue({ lastIncludedIndex: 5 });
        snapshotManager.loadSnapshot.mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snap'),
            config: { voters: [], learners: [] },
        });

        (rpcHandler as any).sendInstallSnapshot = vi
            .fn()
            .mockRejectedValue(new Error('snapshot RPC failed'));

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('snapshot RPC failed'),
            );
        });
    });

    it('should log plain string error when sendInstallSnapshot RPC throws non-Error', async () => {
        snapshotManager.getSnapshotMetadata.mockReturnValue({ lastIncludedIndex: 5 });
        snapshotManager.loadSnapshot.mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snap'),
            config: { voters: [], learners: [] },
        });

        (rpcHandler as any).sendInstallSnapshot = vi
            .fn()
            .mockRejectedValue('plain string snapshot error');

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining('plain string snapshot error'),
            );
        });
    });

    it("should not decrement nextIndex in catch block when leaderState is null at catch time", async () => {
        rpcHandler.sendAppendEntries.mockImplementation(async () => {
            (stateMachine as any)["leaderState"] = null;
            throw new Error("rpc error");
        });

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining("rpc error"),
            );
        });

        const decrementLog = (logger.debug as ReturnType<typeof vi.fn>).mock.calls.some(
            (args: unknown[]) => typeof args[0] === "string" && args[0].includes("decremented nextIndex"),
        );
        expect(decrementLog).toBe(false);
    });

    it("should do nothing when sendInstallSnapshot response is success:false with non-higher term", async () => {
        snapshotManager.getSnapshotMetadata.mockReturnValue({ lastIncludedIndex: 5 });
        snapshotManager.loadSnapshot.mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from("snap"),
            config: { voters: [], learners: [] }
        });

        (rpcHandler as any).sendInstallSnapshot = vi.fn().mockResolvedValue({
            term: 1,
            success: false,
        });

        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect((rpcHandler as any).sendInstallSnapshot).toHaveBeenCalled();
        });

        expect(stateMachine.getCurrentState()).toBe(RaftState.Leader);

        const successLog = (logger.info as ReturnType<typeof vi.fn>).mock.calls.some(
            (args: unknown[]) => typeof args[0] === "string" && args[0].includes("successfully sent snapshot"),
        );
        expect(successLog).toBe(false);
    });

    it('should not start election when node is not a voter', async () => {
        configManager.isVoter.mockReturnValue(false);

        let captureCallback: (() => void) | null = null;

        timerManager.startElectionTimer.mockImplementationOnce((callback: () => void) => {
            captureCallback = callback;
        });

        await stateMachine.becomeFollower(1, null);
        expect(captureCallback).not.toBeNull();
        await captureCallback!();

        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect(rpcHandler.sendRequestVote).not.toHaveBeenCalled();
    });

    it('should not add self to votes when node is not a voter during candidate transition', async () => {
        configManager.isVoter.mockReturnValue(false);
        configManager.getQuorumSize.mockReturnValue(2);
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: true });

        await stateMachine.becomeCandidate();

        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect(rpcHandler.sendRequestVote).not.toHaveBeenCalled();
    });

    it('should refuse transition to leader when node is not a voter', async () => {
        configManager.isVoter.mockReturnValue(false);

        await stateMachine.becomeLeader();

        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
    });

    it('should step down after advancing commit index when node is no longer a voter', async () => {
        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        const leaderState = (stateMachine as any)['leaderState'];
        vi.spyOn(leaderState, 'calculateCommitIndex').mockResolvedValue(3);
        volatileState.getCommitIndex.mockReturnValue(0);

        configManager.isVoter.mockReturnValue(false);

        await (stateMachine as any)['tryAdvanceCommitIndex']();

        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
    });

    it('should apply config entry from appendEntries when entry type is CONFIG', async () => {
        const configEntry: LogEntry = {
            index: 1,
            term: 1,
            type: LogEntryType.CONFIG,
            config: defaultConfig
        };

        await stateMachine.handleAppendEntries('node2', {...baseRequest2, entries: [configEntry] });

        expect(configManager.applyConfigEntry).toHaveBeenCalledWith(defaultConfig);
    });

    it('should commit config entry when leaderCommit advances past a CONFIG entry', async () => {
        const configEntry: LogEntry = {
            index: 1,
            term: 1,
            type: LogEntryType.CONFIG,
            config: defaultConfig
        };

        logManager.getEntry.mockReturnValue(configEntry);
        volatileState.getCommitIndex.mockReturnValue(0);

        await stateMachine.handleAppendEntries('node2', {...baseRequest2, entries: [configEntry], leaderCommit: 1, prevLogIndex: 0 });

        expect(configManager.applyConfigEntry).toHaveBeenCalledWith(defaultConfig);
    });

    it('should commit config entry when tryAdvanceCommitIndex passes a CONFIG log entry', async () => {
        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        const configEntry: LogEntry = {
            index: 1,
            term: 1,
            type: LogEntryType.CONFIG,
            config: defaultConfig
        };

        logManager.getEntry.mockReturnValue(configEntry);
        volatileState.getCommitIndex.mockReturnValue(0);

        const leaderState = (stateMachine as any)['leaderState'];
        vi.spyOn(leaderState, 'calculateCommitIndex').mockResolvedValue(1);
        volatileState.getCommitIndex.mockReturnValue(0);

        await (stateMachine as any)['tryAdvanceCommitIndex']();

        expect(configManager.commitConfig).toHaveBeenCalledWith(defaultConfig);
    });

    it('should apply and commit config form InstallSnapshot when voters are non-empty', async () => {
        logManager.getLastIndex.mockReturnValue(10);

        await stateMachine.handleInstallSnapshot('node2', {
            term: 1,
            leaderId: 'node2',
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snap'),
            config: defaultConfig
        });

        expect(configManager.applyConfigEntry).toHaveBeenCalledWith(defaultConfig);
        expect(configManager.commitConfig).toHaveBeenCalledWith(defaultConfig);
    });

    it('should not apply config from InstallSnapshot when voters list is empty', async () => {
        logManager.getLastIndex.mockReturnValue(10);

        await stateMachine.handleInstallSnapshot('node2', {
            term: 1,
            leaderId: 'node2',
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snap'),
            config: { voters: [], learners: [] }
        });

        expect(configManager.applyConfigEntry).not.toHaveBeenCalled();
        expect(configManager.commitConfig).not.toHaveBeenCalled();
    });

    it('should add new peer to leaderState and call onPeerDiscovered when peer not yet tracked', async () => {
        const onPeerDiscovered = vi.fn();

        const smWithCallback = new StateMachine(
            nodeId,
            configManager as any,
            config as any,
            persistentState as any,
            volatileState as any,
            logManager as any,
            snapshotManager as any,
            applicationStateMachine as any,
            rpcHandler as any,
            timerManager as any,
            logger as any,
            new AsyncLock(),
            onCommitIndexAdvanced as any,
            undefined,
            onPeerDiscovered
        );

        await smWithCallback.becomeLeader();

        configManager.getAllPeers.mockReturnValue([...peers, 'node4']);

        await smWithCallback.triggerReplication();

        await vi.waitFor(() => {
            expect(onPeerDiscovered).toHaveBeenCalledWith('node4', expect.any(Number));
        });
    });

    it('should deny pre-vote when request term is below current term', async () => {
        persistentState.getCurrentTerm.mockReturnValue(5);
        const response = await stateMachine.handleRequestVote('node2', {
            term: 3,
            candidateId: 'node2',
            lastLogIndex: 0,
            lastLogTerm: 0,
            preVote: true,
        });
        expect(response).toEqual({ term: 5, voteGranted: false });
    });

    it('should deny pre-vote when candidate is not a voter', async () => {
        configManager.isVoter.mockImplementation((node: string) => node !== 'node4');
        const response = await stateMachine.handleRequestVote('node4', {
            term: 1,
            candidateId: 'node4',
            lastLogIndex: 0,
            lastLogTerm: 0,
            preVote: true,
        });
        expect(response).toEqual({ term: 1, voteGranted: false });
    });

    it('should grant pre-vote when no recent leader contact and candidate log is up-to-date', async () => {
        const response = await stateMachine.handleRequestVote('node2', {
            term: 1,
            candidateId: 'node2',
            lastLogIndex: 0,
            lastLogTerm: 0,
            preVote: true,
        });
        expect(response.voteGranted).toBe(true);
    });

    it('should deny pre-vote when there has been recent leader contact', async () => {
        (stateMachine as any)['lastLeaderContactAt'] = performance.now();
        const response = await stateMachine.handleRequestVote('node2', {
            term: 1,
            candidateId: 'node2',
            lastLogIndex: 0,
            lastLogTerm: 0,
            preVote: true,
        });
        expect(response.voteGranted).toBe(false);
    });

    it('should deny pre-vote when candidate log is not up-to-date', async () => {
        logManager.getLastTerm.mockReturnValue(3);
        const response = await stateMachine.handleRequestVote('node2', {
            term: 1,
            candidateId: 'node2',
            lastLogIndex: 0,
            lastLogTerm: 2,
            preVote: true,
        });
        expect(response.voteGranted).toBe(false);
    });

    it('should restart pre-vote when election timeout fires during pre-vote phase', async () => {
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });
        const callbacks: Array<() => void> = [];
        timerManager.startElectionTimer.mockImplementation((callback: () => void) => {
            callbacks.push(callback);
        });
        await stateMachine.becomeFollower(1, null);
        (stateMachine as any)['preVoteInProgress'] = true;
        const countBefore = callbacks.length;
        await callbacks[callbacks.length - 1]();
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect(callbacks.length).toBeGreaterThan(countBefore);
    });

    it('should immediately become candidate during pre-vote when node is the sole voter', async () => {
        configManager.getVoters.mockReturnValue([nodeId]);
        configManager.getAllPeers.mockReturnValue([]);
        configManager.getQuorumSize.mockReturnValue(1);
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });
        let captureCallback: (() => void) | null = null;
        timerManager.startElectionTimer.mockImplementationOnce((callback: () => void) => {
            captureCallback = callback;
        });
        await stateMachine.becomeFollower(1, null);
        expect(captureCallback).not.toBeNull();
        await captureCallback!();
        await vi.waitFor(() => {
            expect(stateMachine.getCurrentState()).toBe(RaftState.Candidate);
        });
    });

    it('should log error message when sendPreVote RPC throws an Error', async () => {
        rpcHandler.sendRequestVote.mockImplementation((_peer: string, req: any) => {
            if (req.preVote) return Promise.reject(new Error('pre-vote rpc failed'));
            return Promise.resolve({ term: 1, voteGranted: false });
        });
        timerManager.startElectionTimer.mockImplementationOnce((callback: () => void) => {
            callback();
        });
        await stateMachine.becomeFollower(1, null);
        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('pre-vote rpc failed'));
        });
    });

    it('should log String() error when sendPreVote RPC throws a non-Error value', async () => {
        rpcHandler.sendRequestVote.mockImplementation((_peer: string, req: any) => {
            if (req.preVote) return Promise.reject('pre-vote plain error');
            return Promise.resolve({ term: 1, voteGranted: false });
        });
        timerManager.startElectionTimer.mockImplementationOnce((callback: () => void) => {
            callback();
        });
        await stateMachine.becomeFollower(1, null);
        await vi.waitFor(() => {
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('pre-vote plain error'));
        });
    });

    it('should cancel pre-vote when response arrives but node is no longer a follower', async () => {
        (stateMachine as any)['preVoteInProgress'] = true;
        (stateMachine as any)['preVoteTerm'] = 1;
        (stateMachine as any)['currentState'] = RaftState.Candidate;
        await (stateMachine as any)['handlePreVoteResponse']('node2', { term: 1, voteGranted: true });
        expect((stateMachine as any)['preVoteInProgress']).toBe(false);
    });

    it('should step down to follower when pre-vote response has a higher term', async () => {
        (stateMachine as any)['preVoteInProgress'] = true;
        (stateMachine as any)['preVoteTerm'] = 1;
        persistentState.getCurrentTerm.mockReturnValue(1);
        await (stateMachine as any)['handlePreVoteResponse']('node2', { term: 5, voteGranted: false });
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect((stateMachine as any)['preVoteInProgress']).toBe(false);
    });

    it('should abandon pre-vote when current term has advanced past the pre-vote term', async () => {
        (stateMachine as any)['preVoteInProgress'] = true;
        (stateMachine as any)['preVoteTerm'] = 1;
        persistentState.getCurrentTerm.mockReturnValue(2);
        await (stateMachine as any)['handlePreVoteResponse']('node2', { term: 2, voteGranted: true });
        expect((stateMachine as any)['preVoteInProgress']).toBe(false);
    });

    it('should log denial and remain in pre-vote phase when a peer denies the pre-vote', async () => {
        (stateMachine as any)['preVoteInProgress'] = true;
        (stateMachine as any)['preVoteTerm'] = 1;
        persistentState.getCurrentTerm.mockReturnValue(1);
        await (stateMachine as any)['handlePreVoteResponse']('node2', { term: 1, voteGranted: false });
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect((stateMachine as any)['preVoteInProgress']).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('pre-vote denial'));
    });

    it('should not add self to pre-votes when node is not a voter', async () => {
        configManager.isVoter.mockReturnValue(false);
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });
        await (stateMachine as any)['startPreVoteUnlocked']();
        const preVotesReceived = (stateMachine as any)['preVotesReceived'] as Set<string>;
        expect(preVotesReceived.size).toBe(0);
    });

    it('should accumulate pre-votes without becoming candidate when quorum is not yet reached', async () => {
        (stateMachine as any)['preVoteInProgress'] = true;
        (stateMachine as any)['preVoteTerm'] = 1;
        (stateMachine as any)['preVotesReceived'] = new Set([nodeId]);
        configManager.getQuorumSize.mockReturnValue(3);
        persistentState.getCurrentTerm.mockReturnValue(1);
        await (stateMachine as any)['handlePreVoteResponse']('node2', { term: 1, voteGranted: true });
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect((stateMachine as any)['preVoteInProgress']).toBe(true);
        expect((stateMachine as any)['preVotesReceived'].has('node2')).toBe(true);
    });

    it('should invoke pre-vote timer callback when pre-vote phase times out naturally', async () => {
        const callbacks: Array<() => void> = [];
        timerManager.startElectionTimer.mockImplementation((callback: () => void) => {
            callbacks.push(callback);
        });
        rpcHandler.sendRequestVote.mockResolvedValue({ term: 1, voteGranted: false });

        await stateMachine.becomeFollower(1, null);
        expect(callbacks.length).toBe(1);

        await callbacks[0]();
        expect(callbacks.length).toBe(2);

        await callbacks[1]();
        expect(stateMachine.getCurrentState()).toBe(RaftState.Follower);
        expect(callbacks.length).toBe(3);
    });

    it('should skip addPeer loop when leaderState becomes null during config commit', async () => {
        await stateMachine.becomeLeader();

        await vi.waitFor(() => {
            expect(rpcHandler.sendAppendEntries).toHaveBeenCalledTimes(peers.length);
        });

        const configEntry: LogEntry = {
            index: 1,
            term: 1,
            type: LogEntryType.CONFIG,
            config: defaultConfig
        };

        configManager.commitConfig.mockImplementation(async () => {
            (stateMachine as any)['leaderState'] = null;
        });

        logManager.getEntry.mockReturnValue(configEntry);
        volatileState.getCommitIndex.mockReturnValue(0);

        const leaderState = (stateMachine as any)['leaderState'];
        vi.spyOn(leaderState, 'calculateCommitIndex').mockResolvedValue(1);

        await (stateMachine as any)['tryAdvanceCommitIndex']();

        expect(configManager.commitConfig).toHaveBeenCalledWith(defaultConfig);
    });
});