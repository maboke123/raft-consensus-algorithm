import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RaftNode } from './RaftNode';
import { RaftState } from './StateMachine';
import { RaftError } from '../util/Error';
import { InMemoryStorage } from '../storage/InMemoryStorage';
import { createConfig } from './Config';
import { MockClock } from '../timing/Clock';
import { SeededRandom } from '../util/Random';
import { ConsoleLogger } from '../util/Logger';
import { LeaderState } from '../state/LeaderState';
import { LogEntryType } from '../log/LogEntry';
import { ClusterConfig } from '../config/ClusterConfig';

describe('RaftNode.ts, RaftNode', () => {
    const nodeId = 'node1';
    const peers = ['node2', 'node3'];

    let storage: InMemoryStorage;
    let transport: {
        isStarted: ReturnType<typeof vi.fn>;
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
        onMessage: ReturnType<typeof vi.fn>;
        addPeer?: ReturnType<typeof vi.fn>;
        removePeer?: ReturnType<typeof vi.fn>;
    };
    let clock: MockClock;
    let random: SeededRandom;
    let appStateMachine: {
        apply: ReturnType<typeof vi.fn>;
        getState: ReturnType<typeof vi.fn>;
        takeSnapshot: ReturnType<typeof vi.fn>;
        installSnapshot: ReturnType<typeof vi.fn>;
    };
    let node: RaftNode;
    let config: ReturnType<typeof createConfig>;

    let logger: {
        info: ReturnType<typeof vi.fn>;
        debug: ReturnType<typeof vi.fn>;
        warn: ReturnType<typeof vi.fn>;
        error: ReturnType<typeof vi.fn>;
    };

    const forceLeader = (n: RaftNode, term = 1) => {
        const stateMachine = (n as any)['stateMachine'];
        stateMachine['currentState'] = RaftState.Leader;
        stateMachine['currentLeader'] = nodeId;
        const logManager = (n as any)['logManager'];
        stateMachine['leaderState'] = new LeaderState(peers, logManager.getLastIndex());
        (n as any)['persistentState']['currentTerm'] = term;
    };

    const tickApplyLoop = async (times = 3) => {
        for (let i = 0; i < times; i++) {
            clock.advanceMs(15);
            await clock.tick();
            await new Promise(r => setTimeout(r, 0));
        }
    };

    const command = { type: 'set', payload: { key: 'x', value: 10 }};

    const silentLogger = {
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {}
    };

    beforeEach(async () => {
        storage = new InMemoryStorage();
        await storage.open();

        transport = {
            isStarted: vi.fn().mockReturnValue(false),
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            send: vi.fn().mockResolvedValue(undefined),
            onMessage: vi.fn(),
            addPeer: vi.fn().mockResolvedValue(undefined),
            removePeer: vi.fn().mockResolvedValue(undefined)
        };

        clock = new MockClock();
        random = new SeededRandom(12345);

        appStateMachine = {
            apply: vi.fn().mockResolvedValue('ok'),
            getState: vi.fn().mockReturnValue({}),
            takeSnapshot: vi.fn().mockResolvedValue(Buffer.alloc(0)),
            installSnapshot: vi.fn().mockResolvedValue(undefined)
        };

        config = createConfig(nodeId, 'localhost:52000',[
                { id: 'node2', address: 'localhost:52001' },
                { id: 'node3', address: 'localhost:52002' }
            ], 150, 300, 50);

        node = new RaftNode(config, storage, transport as any, appStateMachine as any, clock, random, silentLogger);
    });

    afterEach(async () => {
        try {
            if (node.isStarted()) {
                await node.stop();
            }
        } catch (e) {
        }
    });

    it('should throw when config is invalid', () => {
        expect(() => new RaftNode(
            { ...config, nodeId: '' } as any,
            storage, transport as any, appStateMachine as any, clock, random
        )).toThrow();
    });

    it('should not be started initially', () => {
        expect(node.isStarted()).toBe(false);
    });

    it('should use provided logger if given', () => {
        const logger = {
            info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn()
        };
        const nodeWithLogger = new RaftNode(config, storage, transport as any, appStateMachine as any, clock, random, logger);
        expect((nodeWithLogger as any)['logger']).toBe(logger);
    });

    it('should fall back to console if logger is not provided', () => {
        const nodeWithoutLogger = new RaftNode(config, storage, transport as any, appStateMachine as any, clock, random);
        expect((nodeWithoutLogger as any)['logger']).toBeInstanceOf(ConsoleLogger);
    });

    it('should start succesfully', async () => {
        await node.start();
        expect(node.isStarted()).toBe(true);
    });

    it('should throw RaftError if already started', async () => {
        await node.start();
        await expect(node.start()).rejects.toThrow(RaftError);
    });

    it('should open storage if not already open on start', async () => {
        const raftNode = new RaftNode(config, storage, transport as any, appStateMachine as any, clock, random, silentLogger);

        const openSpy = vi.spyOn(storage, 'open').mockResolvedValue(undefined);
        vi.spyOn(storage, 'isOpen').mockReturnValueOnce(false);

        await raftNode.start();
        expect(openSpy).toHaveBeenCalled();
        await raftNode.stop();
    });

    it('should not re open storage if already open on start', async () => {
        const openSpy = vi.spyOn(storage, 'open').mockResolvedValue(undefined);
        await node.start();
        expect(openSpy).not.toHaveBeenCalled();
    });

    it('should start transport if not already started on start', async () => {
        transport.isStarted.mockReturnValueOnce(false);
        await node.start();
        expect(transport.start).toHaveBeenCalled();
        await node.stop();
    });

    it('should not re start transport if already started on start', async () => {
        transport.isStarted.mockReturnValueOnce(true);
        await node.start();
        expect(transport.start).not.toHaveBeenCalled();
        await node.stop();
    });

    it('should register onMessage handler on transport start', async () => {
        await node.start();
        expect(transport.onMessage).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should initialize with term 0 on first start', async () => {
        await node.start();
        expect(node.getCurrentTerm()).toBe(0);
    });

    it('should initialize with empty log on first start', async () => {
        await node.start();
        expect(node.getLastLogIndex()).toBe(0);
    });

    it('should restore persisted term after restart', async () => {
        await node.start();
        await (node as any)['persistentState'].updateTermAndVote(5, null);
        await node.stop();

        await storage.open();

        const newNode = new RaftNode(config, storage, transport as any, appStateMachine as any, clock, random, silentLogger);
        await newNode.start();
        expect(newNode.getCurrentTerm()).toBe(5);
        await newNode.stop();
    });

    it('should restore persisted log after restart', async () => {
        await node.start();
        const logManager = (node as any)['logManager'];
        await logManager.appendCommand({ type: 'set', payload: { key: 'x', value: 10}}, 1);
        await node.stop()

        await storage.open();

        const newNode = new RaftNode(config, storage, transport as any, appStateMachine as any, clock, random, silentLogger);
        await newNode.start();
        expect(newNode.getLastLogIndex()).toBe(1);
        await newNode.stop();
    });

    it('should throw RaftError wrapping underlying error on start failure', async () => {
        transport.start.mockRejectedValue(new Error('Transport failed to start'));
        await expect(node.start()).rejects.toThrow(RaftError);
    });

    it('should start apply loop on start', async () => {
        await node.start();
        expect((node as any)['applyLoopRunning']).toBe(true);
    });

    it('should stop succesfully', async () => {
        await node.start();
        await node.stop();
        expect(node.isStarted()).toBe(false);
    });

    it('should trhow RaftError if not started', async () => {
        await expect(node.stop()).rejects.toThrow(RaftError);
    })

    it('should stop transport if it is started', async () => {
        transport.isStarted.mockReturnValue(true);
        await node.start();
        await node.stop();
        expect(transport.stop).toHaveBeenCalled();
    });

    it('should not stop transport if it is not started', async () => {
        transport.isStarted.mockReturnValue(false);
        await node.start();
        await node.stop();
        expect(transport.stop).not.toHaveBeenCalled();
    });

    it('should close storage on stop', async () => {
        await node.start();
        await node.stop();
        expect(storage.isOpen()).toBe(false);
    });

    it('should stop apply loop on stop', async () => {
        await node.start();
        await node.stop();
        expect((node as any)['applyLoopRunning']).toBe(false);
    });

    it('should trhow RaftError wrapping underlying error on stop failure', async () => {
        await node.start();
        transport.isStarted.mockReturnValue(true);
        transport.stop.mockRejectedValue(new Error('Transport failed to stop'));
        await expect(node.stop()).rejects.toThrow(RaftError);
    });

    it('should return error when node is not started', async () => {
        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('not started');
    });

    it('should return error when node is not leader', async () => {
        await node.start();
        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Not the leader');
    });

    it('should include leaderId in error response when not leader', async () => {
        await node.start();
        (node as any)['stateMachine']['currentLeader'] = 'node2';
        const result = await node.submitCommand(command);
        expect(result.leaderId).toBe('node2');
    });

    it('should return undefined leaderId when no leader known', async () => {
        await node.start();
        const result = await node.submitCommand(command);
        expect(result.leaderId).toBeUndefined();
    });

    it('should return error if no longer leader after appending log', async () => {
        await node.start();

        forceLeader(node);

        const logManager = (node as any)['logManager'];
        const originalAppendCommand = logManager.appendCommand.bind(logManager);
        vi.spyOn(logManager, 'appendCommand').mockImplementation(async (...args: any[]) => {
            const result = await originalAppendCommand(...args);
            (node as any)['stateMachine']['currentState'] = RaftState.Follower;
            return result;
        });

        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Not the leader');
    });

    it('should return error if term is outdated after appending log', async () => {
        await node.start();
        forceLeader(node, 1);

        const logManager = (node as any)['logManager'];
        const originalAppendCommand = logManager.appendCommand.bind(logManager);
        vi.spyOn(logManager, 'appendCommand').mockImplementation(async (...args: any[]) => {
            const result = await originalAppendCommand(...args);
            (node as any)['persistentState']['currentTerm'] = 2;
            return result;
        });

        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('term has changed');
    });

    it('should return error when appendCommand throws', async () => {
        await node.start();

        forceLeader(node);

        const logManager = (node as any)['logManager'];
        vi.spyOn(logManager, 'appendCommand').mockRejectedValue(new Error('appendcommand error'))

        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('appendcommand error');
    });

    it('should return error if no longer leader after triggering replication', async () => {
        await node.start();
        forceLeader(node, 1);

        vi.spyOn(node as any, 'triggerReplication').mockImplementation(async () => {
            (node as any)['stateMachine']['currentState'] = RaftState.Follower;
        });

        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Not the leader');
    });

    it('should return error when trigger replication throws', async () => {
        await node.start();
        forceLeader(node, 1);

        vi.spyOn(node as any, 'triggerReplication').mockRejectedValue(new Error('triggerReplication error'));

        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('triggerReplication error');
    });

    it('should return succes when commit is confirmed', async () => {
        await node.start();
        forceLeader(node, 1);

        vi.spyOn(node as any, 'triggerReplication').mockImplementation(async () => {
            setTimeout(() => {
                (node as any)['notifyCommitWaiters'](1);
            }, 0);
        });

        const result = await node.submitCommand(command);
        expect(result.success).toBe(true);
        expect(result.index).toBe(1);
    });

    it('should return error when commit times out', async () => {
        await node.start();
        forceLeader(node, 1);

        vi.spyOn(node as any, 'triggerReplication').mockResolvedValue(undefined);
        vi.spyOn(node as any, 'waitForCommit').mockResolvedValue(false);

        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('timeout');
    });

    it('should return folower as initial state', async () => {
        await node.start();
        expect(node.getState()).toBe(RaftState.Follower);
    });

    it('should return false for isLeader initially', async () => {
        await node.start();
        expect(node.isLeader()).toBe(false);
    });

    it('should return null for getLeaderId initially', async () => {
        await node.start();
        expect(node.getLeaderId()).toBeNull();
    });

    it('should return 0 for getCommitIndex initially', async () => {
        await node.start();
        expect(node.getCommittedIndex()).toBe(0);
    });

    it('should return 0 for getLastApplied initially', async () => {
        await node.start();
        expect(node.getLastApplied()).toBe(0);
    });

    it('should return 0 for getLastLogIndex initially', async () => {
        await node.start();
        expect(node.getLastLogIndex()).toBe(0);
    });

    it('should return nodeId correctly', async () => {
        await node.start();
        expect(node.getNodeId()).toBe(nodeId);
    });

    it('should return application state from state machine', async () => {
        appStateMachine.getState.mockReturnValue({ x: 10 });
        await node.start();
        expect(node.getApplicationState()).toEqual({ x: 10 });
    });

    it('should return true for isleader when forced to leader', async () => {
        await node.start();
        forceLeader(node);
        expect(node.isLeader()).toBe(true);
    });

    it('should return leader state when forced to leader', async () => {
        await node.start();
        forceLeader(node);
        expect(node.getState()).toBe(RaftState.Leader);
    });

    it('should return updated commitIndex after setting it', async () => {
        await node.start();
        (node as any)['volatileState'].setCommitIndex(5);
        expect(node.getCommittedIndex()).toBe(5);
    });

    it('should return updated lastApplied after setting it', async () => {
        await node.start();
        (node as any)['volatileState'].setCommitIndex(5);
        (node as any)['volatileState'].setLastApplied(3);
        expect(node.getLastApplied()).toBe(3);
    });

    it('should throw when range is invalid (fromIndex < 1)', async () => {
        await node.start();
        await expect(node.getEntries(0,1)).rejects.toThrow();
    });

    it('should throw wen toIndex exceeds last log index', async () => {
        await node.start();
        await expect(node.getEntries(1,2)).rejects.toThrow();
    });

    it('should return entries in valid range', async () => {
        await node.start();

        const logManager = (node as any)['logManager'];
        await logManager.appendCommand({ type: 'set', payload: { key: 'x', value: 10}}, 1);
        await logManager.appendCommand({ type: 'set', payload: { key: 'y', value: 20}}, 1);

        const entries = await node.getEntries(1, 2);
        expect(entries).toHaveLength(2);
        expect(entries[0].command).toEqual({ type: 'set', payload: { key: 'x', value: 10}});
        expect(entries[1].command).toEqual({ type: 'set', payload: { key: 'y', value: 20}});
    });

    it('should not start a second loop if already running', async () => {
        await node.start();
        (node as any)['startApplyLoop']();
        await tickApplyLoop(1);
        expect((node as any)['applyLoopRunning']).toBe(true);
    });

    it('should not apply when commitIndex equals lastApplied', async () => {
        await node.start();
        await tickApplyLoop(1);
        expect(appStateMachine.apply).not.toHaveBeenCalled();
    });

    it('should apply commited entries and advance lastApplied', async () => {
        await node.start();

        const logManager = (node as any)['logManager'];
        const volatileState = (node as any)['volatileState'];

        await logManager.appendCommand({ type: 'set', payload: { key: 'x', value: 10}}, 1);
        volatileState.setCommitIndex(1);

        await tickApplyLoop();

        await vi.waitFor(() => {
            expect(appStateMachine.apply).toHaveBeenCalledWith({ type: 'set', payload: { key: 'x', value: 10}});
            expect(volatileState.getLastApplied()).toBe(1);
        });
    });

    it('should apply multiple entries in order', async () => {
        await node.start();

        const logManager = (node as any)['logManager'];
        const volatileState = (node as any)['volatileState'];

        await logManager.appendCommand({ type: 'set', payload: { key: 'x', value: 10}}, 1);
        await logManager.appendCommand({ type: 'set', payload: { key: 'y', value: 20}}, 1);
        await logManager.appendCommand({ type: 'set', payload: { key: 'z', value: 30}}, 1);
        volatileState.setCommitIndex(3);

        await tickApplyLoop();

        await vi.waitFor(() => {
            expect(appStateMachine.apply).toHaveBeenNthCalledWith(1, { type: 'set', payload: { key: 'x', value: 10}});
            expect(appStateMachine.apply).toHaveBeenNthCalledWith(2, { type: 'set', payload: { key: 'y', value: 20}});
            expect(appStateMachine.apply).toHaveBeenNthCalledWith(3, { type: 'set', payload: { key: 'z', value: 30}});
            expect(volatileState.getLastApplied()).toBe(3);
        });
    });

    it('should break and lor error when entry is missing', async () => {
        await node.start();

        const volatileState = (node as any)['volatileState'];
        volatileState.setCommitIndex(1);

        await tickApplyLoop();
        expect(appStateMachine.apply).not.toHaveBeenCalled();
    });

    it('should break and log error when entry index mismatch', async () => {
        await node.start();

        const logManager = (node as any)['logManager'];
        const volatileState = (node as any)['volatileState'];

        await logManager.appendCommand({ type: 'set', payload: { key: 'x', value: 10}}, 1);
        volatileState.setCommitIndex(1);

        const entry = await logManager.getEntry(1);
        vi.spyOn(logManager, 'getEntry').mockResolvedValue({ ...entry, index: 2 });

        await tickApplyLoop();
        expect(appStateMachine.apply).not.toHaveBeenCalled();
    });

    it('should call process.exit(1) and stop loop when apply throws', async () => {
        await node.start();

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

        appStateMachine.apply.mockRejectedValue(new Error('apply error'));

        const logManager = (node as any)['logManager'];
        const volatileState = (node as any)['volatileState'];

        await logManager.appendCommand({ type: 'set', payload: { key: 'x', value: 10}}, 1);
        volatileState.setCommitIndex(1);

        await tickApplyLoop();

        await vi.waitFor(() => {
            expect(exitSpy).toHaveBeenCalledWith(1);
        })

        exitSpy.mockRestore();
    });

    it('should log error and continue on non-ApplyEntryFailed RaftError', async () => {
        await node.start();

        vi.spyOn(node as any, 'applyCommittedEntries').mockRejectedValueOnce(
            new RaftError('error', 'ERROR')
        );

        await tickApplyLoop(2);

        expect((node as any)['applyLoopRunning']).toBe(true);
    });

    it('should not throw when not the leader', async () => {
        await node.start();

        await expect(node.triggerReplication()).resolves.not.toThrow();
    });

    it('should call stateMachine.triggerReplication when leader', async () => {
        await node.start();

        forceLeader(node);
        const stateMachineSpy = vi.spyOn((node as any)['stateMachine'], 'triggerReplication').mockResolvedValue(undefined);

        await node.triggerReplication();
        expect(stateMachineSpy).toHaveBeenCalled();
    });

    it('should resolve true immediately if already committed', async () => {
        await node.start();
        const volatileState = (node as any)['volatileState'];
        volatileState.setCommitIndex(5);
        const result = await (node as any)['waitForCommit'](5, 5000, 1);
        expect(result).toBe(true);
    });

    it('should resolve true when notified via notifyCommitWaiters', async () => {
        await node.start();
        const waitPromise = (node as any)['waitForCommit'](1, 5000, 1);
        (node as any)['notifyCommitWaiters'](1);
        const result = await waitPromise;
        expect(result).toBe(true);
    });

    it('should resolve false on timeout when not commited', async () => {
        await node.start();
        const waitPromise = (node as any)['waitForCommit'](99, 100, 1);
        clock.advanceMs(100);
        await clock.tick();
        const result = await waitPromise;
        expect(result).toBe(false);
    });

    it('should resolve true on timeout if commit happend before timeout fires', async () => {
        await node.start();
        const waitPromise = (node as any)['waitForCommit'](1, 100, 1);
        const volatileState = (node as any)['volatileState'];
        volatileState.setCommitIndex(1);
        clock.advanceMs(100);
        await clock.tick();
        const result = await waitPromise;
        expect(result).toBe(true);
    });

    it('should resolve false when leadership is lost during checkLeadership', async () => {
        await node.start();
        forceLeader(node, 1);
        const waitPromise = (node as any)['waitForCommit'](1, 5000, 1);
        (node as any)['stateMachine']['currentState'] = RaftState.Follower;
        clock.advanceMs(100);
        await clock.tick();
        const result = await waitPromise;
        expect(result).toBe(false);
    });

    it('should resolve false when term changes during checkLeadership', async () => {
        await node.start();
        forceLeader(node, 1);
        const waitPromise = (node as any)['waitForCommit'](1, 5000, 1);
        (node as any)['persistentState']['currentTerm'] = 2;
        clock.advanceMs(100);
        await clock.tick();
        const result = await waitPromise;
        expect(result).toBe(false);
    });

    it('should not re check leadership after timeout has passed', async () => {
        await node.start();
        forceLeader(node, 1);
        const checkSpy = vi.spyOn(node as any, 'waitForCommit');
        (node as any)['waitForCommit'](1, 50, 1);

        clock.advanceMs(100);
        await clock.tick();

        clock.advanceMs(500);
        await clock.tick();

        expect(checkSpy).toHaveBeenCalledTimes(1);
    });

    it('should reschedule checkLeaderShip when still leader and within timeout', async () => {
        await node.start();
        forceLeader(node, 1);

        const waitPromise = (node as any)['waitForCommit'](1, 5000, 1);

        clock.advanceMs(110);
        await clock.tick();

        let resolved = false;
        waitPromise.then(() => resolved = true);
        await new Promise(r => setTimeout(r, 0));

        expect(resolved).toBe(false);

        (node as any)['notifyCommitWaiters'](1);
        expect(await waitPromise).toBe(true);
    });

    it('should notify all waiters at or below newCommitIndex', async () => {
        await node.start();

        const result1 = (node as any)['waitForCommit'](1, 5000, 1);
        const result2 = (node as any)['waitForCommit'](2, 5000, 1);
        const result3 = (node as any)['waitForCommit'](3, 100, 1);

        (node as any)['notifyCommitWaiters'](2);

        expect(await result1).toBe(true);
        expect(await result2).toBe(true);

        clock.advanceMs(100);
        await clock.tick();

        expect(await result3).toBe(false);
    });

    it('should clean up waiters map after notifying', async () => {
        await node.start();
        const result1 = (node as any)['waitForCommit'](1, 5000, 1);
        (node as any)['notifyCommitWaiters'](1);
        await result1;
        expect((node as any)['commitWaiters'].has(1)).toBe(false);
    });

    it('should handle RequestVote messages and return a response', async () => {
        await node.start();

        const handler = transport.onMessage.mock.calls[0][0];
        const requestVoteMsg = {
            type: 'RequestVote',
            direction: 'request',
            payload: {
                term: 1,
                candidateId: 'node2',
                lastLogIndex: 0,
                lastLogTerm: 0
            }
        };

        const response = await handler('node2', requestVoteMsg);
        expect(response.type).toBe('RequestVote');
        expect(response.direction).toBe('response');
        expect(response.payload).toHaveProperty('term');
        expect(response.payload).toHaveProperty('voteGranted');
    });

    it('should handle AppendEntries messages and return a response', async () => {
        await node.start();

        const handler = transport.onMessage.mock.calls[0][0];
        const appendEntriesMsg = {
            type: 'AppendEntries',
            direction: 'request',
            payload: {
                term: 1,
                leaderId: 'node2',
                prevLogIndex: 0,
                prevLogTerm: 0,
                entries: [],
                leaderCommit: 0
            }
        };

        const response = await handler('node2', appendEntriesMsg);
        expect(response.type).toBe('AppendEntries');
        expect(response.direction).toBe('response');
        expect(response.payload).toHaveProperty('term');
        expect(response.payload).toHaveProperty('success');
    });

    it('should call notifyCommitWaiters when StateMachine advances commitIndex', async () => {
        await node.start();

        const notifySpy = vi.spyOn(node as any, 'notifyCommitWaiters')

        await (node as any)['stateMachine'].handleAppendEntries('node2', {
            term: 1,
            leaderId: 'node2',
            prevLogIndex: 0,
            prevLogTerm: 0,
            entries: [{ index: 1, term: 1, type: LogEntryType.COMMAND, command: { type: 'set', payload: { key: 'x', value: 10}}}],
            leaderCommit: 1
        });

        expect(notifySpy).toHaveBeenCalledWith(1);
    });

    it('should not close storage if already closed during stop', async () => {
        await node.start();
        const closeSpy = vi.spyOn(storage, 'close')
        vi.spyOn(storage, 'isOpen').mockReturnValueOnce(false);

        await node.stop();
        expect(closeSpy).not.toHaveBeenCalled();
    });

    it('should return undefined leaderId when no longer leader after appending and leader is unknown', async () => {
        await node.start();
        forceLeader(node, 1);

        const logManager = (node as any)['logManager'];
        const originalAppendCommand = logManager.appendCommand.bind(logManager);
        vi.spyOn(logManager, 'appendCommand').mockImplementation(async (...args: any[]) => {
            const result = await originalAppendCommand(...args);
            (node as any)['stateMachine']['currentState'] = RaftState.Follower;
            (node as any)['stateMachine']['currentLeader'] = null;
            return result;
        });

        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Not the leader');
        expect(result.leaderId).toBeUndefined();
    });

    it('should return undefined leaderId when no longer leader after triggering replication and leader is unknown', async () => {
        await node.start();
        forceLeader(node, 1);

        vi.spyOn(node as any, 'triggerReplication').mockImplementation(async () => {
            (node as any)['stateMachine']['currentState'] = RaftState.Follower;
            (node as any)['stateMachine']['currentLeader'] = null;
        });

        const result = await node.submitCommand(command);
        expect(result.success).toBe(false);
        expect(result.error).toContain('Not the leader');
        expect(result.leaderId).toBeUndefined();
    });

    it('should reuse existing waiter array when same index registed twice', async () => {
        await node.start();
        const waitPromise1 = (node as any)['waitForCommit'](1, 5000, 1);
        const waitPromise2 = (node as any)['waitForCommit'](1, 5000, 1);

        (node as any)['notifyCommitWaiters'](1);
        expect(await waitPromise1).toBe(true);
        expect(await waitPromise2).toBe(true);
    });

    it('should handle timeout gracefully when waiters already cleaned up', async () => {
        await node.start();
        const waitPromise = (node as any)['waitForCommit'](1, 100, 1);

        (node as any)['notifyCommitWaiters'](1);
        expect(await waitPromise).toBe(true);

        clock.advanceMs(100);
        await clock.tick();
    });

    it('should handle timeout when callback already removed form waiters', async () => {
        await node.start();

        const waitPromise1 = (node as any)['waitForCommit'](1, 100, 1);
        const waitPromise2 = (node as any)['waitForCommit'](1, 200, 1);

        clock.advanceMs(150);
        await clock.tick();
        expect(await waitPromise1).toBe(false);

        clock.advanceMs(150);
        await clock.tick();
        expect(await waitPromise2).toBe(false);
    });

    it('should not delete waiter entry when other callbacks still pending', async () => {
        await node.start();

        const waitPromise1 = (node as any)['waitForCommit'](1, 100, 1);
        const waitPromise2 = (node as any)['waitForCommit'](1, 5000, 1);

        clock.advanceMs(150);
        await clock.tick();
        expect(await waitPromise1).toBe(false);

        expect((node as any)['commitWaiters'].has(1)).toBe(true);

        (node as any)['notifyCommitWaiters'](1);
        await waitPromise2;
    });

    it('should handle checkLeadership gracefully when callback already removed', async () => {
        await node.start();
        forceLeader(node, 1);

        const waitPromise = (node as any)['waitForCommit'](1, 100, 1);

        (node as any)['notifyCommitWaiters'](1);
        expect(await waitPromise).toBe(true);

        (node as any)['stateMachine']['currentState'] = RaftState.Follower;
        clock.advanceMs(150);
        clock.tick();
    });

    it('should handle timeout when callback already removed by checkLeadership', async () => {
        await node.start();

        const captured: Array<{ fn: () => void; ms: number }> = [];
        vi.spyOn(clock, 'setTimeout').mockImplementation((fn: () => void, ms: number) => {
            captured.push({ fn, ms });
            return captured.length;
        });

        (node as any)['waitForCommit'](1, 200, 1);

        const timeoutFn = captured.find(c => c.ms === 200)!.fn;

        (node as any)['commitWaiters'].set(1, [(_: boolean) => {}]);

        timeoutFn();
    });

    it('should install snapshot on start if one exists', async () => {
        const snapshotManager = (node as any)['snapshotManager'];
        vi.spyOn(snapshotManager, 'initialize').mockResolvedValue(undefined);
        vi.spyOn(snapshotManager, 'loadSnapshot').mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snapshot'),
            config: { voters: [], learners: []}
        });

        const installSpy = vi.fn().mockResolvedValue(undefined);
        (node as any)['applicationStateMachine'].installSnapshot = installSpy;

        await node.start();

        expect(installSpy).toHaveBeenCalledWith(Buffer.from('snapshot'));
        expect(node.getCommittedIndex()).toBe(5);
        expect(node.getLastApplied()).toBe(5);
    });

    it('should handle InstallSnapshot messages and return a response', async () => {
        await node.start();

        const handler = transport.onMessage.mock.calls[0][0];
        const installSnapshotMsg = {
            type: 'InstallSnapshot',
            direction: 'request',
            payload: {
                term: 1,
                leaderId: 'node2',
                lastIncludedIndex: 5,
                lastIncludedTerm: 1,
                data: Buffer.from('snapshot'),
                config: { voters: [], learners: [] }
            }
        };

        const response = await handler('node2', installSnapshotMsg);
        expect(response.type).toBe('InstallSnapshot');
        expect(response.direction).toBe('response');
        expect(response.payload).toHaveProperty('success');
    });

    it('should skip applying entries already covered by snapshot', async () => {
        await node.start();

        const logManager = (node as any)['logManager'];
        const volatileState = (node as any)['volatileState'];

        await logManager.appendCommand({ type: 'set', payload: { key: 'x', value: 10 }}, 1);
        await logManager.appendCommand({ type: 'set', payload: { key: 'y', value: 20 }}, 1);

        logManager['snapshotIndex'] = 2;
        volatileState.setCommitIndex(2);

        await tickApplyLoop();

        await vi.waitFor(() => {
            expect(volatileState.getLastApplied()).toBe(2);
        });
        expect(appStateMachine.apply).not.toHaveBeenCalled();
    });

    it('should take snapshot when threshold is reached', async () => {
        await node.start();

        const logManager = (node as any)['logManager'];
        const volatileState = (node as any)['volatileState'];
        const snapshotManager = (node as any)['snapshotManager'];

        (node as any)['snapshotTreshold'] = 2;

        const takeSnapshotSpy = vi.spyOn(node as any, 'takeSnapshot');
        const saveSnapshotSpy = vi.spyOn(snapshotManager, 'saveSnapshot').mockResolvedValue(undefined);

        appStateMachine.takeSnapshot = vi.fn().mockResolvedValue(Buffer.from('snap'));

        for (let i = 1; i <= 3; i++) {
            await logManager.appendCommand({ type: 'set', payload: { key: `k${i}`, value: i }}, 1);
        }
        volatileState.setCommitIndex(3);

        await tickApplyLoop();

        await vi.waitFor(() => {
            expect(takeSnapshotSpy).toHaveBeenCalled();
        });
    });

    it('should skip snapshot when term cannot be retrieved for snapshot index', async () => {
        await node.start();

        const logManager = (node as any)['logManager'];
        const volatileState = (node as any)['volatileState'];
        const snapshotManager = (node as any)['snapshotManager'];

        (node as any)['snapshotTreshold'] = 1;

        vi.spyOn(logManager, 'getTermAtIndex').mockResolvedValue(null);
        const saveSnapshotSpy = vi.spyOn(snapshotManager, 'saveSnapshot');

        await logManager.appendCommand({ type: 'set', payload: { key: 'x', value: 10 }}, 1);
        volatileState.setCommitIndex(1);

        await tickApplyLoop();

        await vi.waitFor(() => {
            expect(appStateMachine.apply).toHaveBeenCalled();
        });

        expect(saveSnapshotSpy).not.toHaveBeenCalled();
    });

    it('should return false when node is not started', async () => {
        const result = await node.addServer('node49', 'localhost:4030');
        expect(result).toBe(false);
    });

    it('should return false when node is not leader', async () => {
        await node.start();
        const result = await node.addServer('node49', 'localhost:4030');
        expect(result).toBe(false);
    });

    it('should return false when there is a pending config change', async () => {
        await node.start();

        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'hasPendingChange').mockReturnValue(true);

        const result = await node.addServer('node4', 'localhost:3943');
        expect(result).toBe(false);
    });

    it('should return false when node is already a voter', async () => {
        await node.start();

        forceLeader(node);

        (node as any)['configManager']['commitedConfig'] = { voters: [ { id: 'node1', address: 'localhost:52000'} , { id: 'node2', address: 'localhost:52001' }, { id: 'node3', address: 'localhost:52002' } ], learners: []};
        (node as any)['configManager']['activeConfig'] = { voters: [{ id: 'node1', address: 'localhost:52000'} , { id: 'node2', address: 'localhost:52001' }, { id: 'node3', address: 'localhost:52002' } ], learners: []};

        const result = await node.addServer('node2', 'localhost:3943');
        expect(result).toBe(false);
    });

    it('should return false when node is already a learner', async () => {
        await node.start();

        forceLeader(node);

        (node as any)['configManager']['commitedConfig'] = { voters: [ { id: 'node1', address: 'localhost:52000'} , { id: 'node2', address: 'localhost:52001' }, { id: 'node3', address: 'localhost:52002' } ], learners: [{ id: 'node4', address: 'localhost:52003' }]};
        (node as any)['configManager']['activeConfig'] = { voters: [{ id: 'node1', address: 'localhost:52000'} , { id: 'node2', address: 'localhost:52001' }, { id: 'node3', address: 'localhost:52002' } ], learners: [{ id: 'node4', address: 'localhost:52003' }]};

        const result = await node.addServer('node4', 'localhost:3943');
        expect(result).toBe(false);
    });

    it('should call transport.addPeer when adding a new server', async () => {
        await node.start();

        forceLeader(node);

        transport.addPeer = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(true);

        const result = await node.addServer('node4', 'localhost:3943');
        expect(transport.addPeer).toHaveBeenCalledWith('node4', 'localhost:3943');
        expect(result).toBe(true);
    });

    it('should add a node as voter by default', async () => {
        await node.start();

        forceLeader(node);

        transport.addPeer = vi.fn().mockResolvedValue(undefined);
        const submitConfigChangeSpy = vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(true);

        const result = await node.addServer('node4', 'localhost:3943');
        const calledConfig = submitConfigChangeSpy.mock.calls[0][0] as ClusterConfig;
        expect(calledConfig.voters.map(m => m.id)).toContain('node4');
        expect(calledConfig.learners.map(m => m.id)).not.toContain('node4');
        expect(result).toBe(true);
    });

    it('should add a node as learner when specified', async () => {
        await node.start();

        forceLeader(node);

        transport.addPeer = vi.fn().mockResolvedValue(undefined);
        const submitConfigChangeSpy = vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(true);

        const result = await node.addServer('node4', 'localhost:3943', true);
        const calledConfig = submitConfigChangeSpy.mock.calls[0][0] as ClusterConfig;
        expect(calledConfig.learners.map(m => m.id)).toContain('node4');
        expect(calledConfig.voters.map(m => m.id)).not.toContain('node4');
        expect(result).toBe(true);
    });

    it('should return false when node is not started', async () => {
        const result = await node.removeServer('node2');
        expect(result).toBe(false);
    });

    it('should return false when node is not leader', async () => {
        await node.start();
        const result = await node.removeServer('node2');
        expect(result).toBe(false);
    });

    it('should return false when there is a pending config change', async () => {
        await node.start();

        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'hasPendingChange').mockReturnValue(true);
        const result = await node.removeServer('node2');
        expect(result).toBe(false);
    });

    it('should return false when node is not a voter or learner', async () => {
        await node.start();

        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'getActiveConfig').mockReturnValue({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }], learners: [{ id: 'node4', address: 'localhost:52004'}, { id: 'node5', address: 'localhost:52005' }]});

        const result = await node.removeServer('node49');
        expect(result).toBe(false);
    });

    it('should return false when removing voter would leave fewer than 2 voters', async () => {
        await node.start();

        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'getActiveConfig').mockReturnValue({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }], learners: []});

        const result = await node.removeServer('node2');
        expect(result).toBe(false);
    });

    it('should submit config change removing the voter', async () => {
        await node.start();
        forceLeader(node);
        const submitConfigChangeSpy = vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(true);
        const result = await node.removeServer('node2');
        const calledConfig = submitConfigChangeSpy.mock.calls[0][0] as ClusterConfig;
        expect(calledConfig.voters.map(m => m.id)).not.toContain('node2');
        expect(calledConfig.learners.map(m => m.id)).not.toContain('node2');
        expect(result).toBe(true);
    });

    it('should call transport.removePeer when removing a server', async () => {
        await node.start();
        forceLeader(node);
        transport.removePeer = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(true);
        const result = await node.removeServer('node2');
        expect(transport.removePeer).toHaveBeenCalledWith('node2');
        expect(result).toBe(true);
    });

    it('should not call transport.removePeer if submitConfigChange fails', async () => {
        await node.start();
        forceLeader(node);
        transport.removePeer = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(false);
        const result = await node.removeServer('node2');
        expect(transport.removePeer).not.toHaveBeenCalled();
        expect(result).toBe(false);
    });

    it('should remove a learner without the voter count check', async () => {
        await node.start();

        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'getActiveConfig').mockReturnValue({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }], learners: [{ id: 'node3', address: 'localhost:52003' }]});

        const submitConfigChangeSpy = vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(true);
        transport.removePeer = vi.fn().mockResolvedValue(undefined);

        const result = await node.removeServer('node3');
        const calledConfig = submitConfigChangeSpy.mock.calls[0][0] as ClusterConfig;
        expect(calledConfig.learners.map(m => m.id)).not.toContain('node3');
        expect(result).toBe(true);
    });

    it('should return false when node is not started', async () => {
        const result = await node.promoteServer('node3');
        expect(result).toBe(false);
    });

    it('should return false when node is not leader', async () => {
        await node.start();
        const result = await node.promoteServer('node3');
        expect(result).toBe(false);
    });

    it('should return false when there is a pending config change', async () => {
        await node.start();

        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'hasPendingChange').mockReturnValue(true);
        const result = await node.promoteServer('node3');
        expect(result).toBe(false);
    });

    it('should return false when node is not a learner', async () => {
        await node.start();

        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'getActiveConfig').mockReturnValue({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }], learners: [{ id: 'node3', address: 'localhost:52003' }]});

        const result = await node.promoteServer('node2');
        expect(result).toBe(false);
    });

    it('should move node from learners to voters', async () => {
        await node.start();

        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'getActiveConfig').mockReturnValue({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }], learners: [{ id: 'node3', address: 'localhost:52003' }]});

        const submitConfigChangeSpy = vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(true);
        const result = await node.promoteServer('node3');
        const calledConfig = submitConfigChangeSpy.mock.calls[0][0] as ClusterConfig;
        expect(calledConfig.voters.map(m => m.id)).toContain('node3');
        expect(calledConfig.learners.map(m => m.id)).not.toContain('node3');
        expect(result).toBe(true);
    });

    it('should return false when no longer leader after appending config entry', async () => {
        await node.start();

        forceLeader(node, 1);

        const logManager = (node as any)['logManager'];

        vi.spyOn(logManager, 'appendConfigEntry').mockImplementation(async () => {
            (node as any)['stateMachine']['currentState'] = RaftState.Follower;
            return 1;
        });

        const result = await (node as any)['submitConfigChange']({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }, { id: 'node4', address: 'localhost:52004' }], learners: []});
        expect(result).toBe(false);
    });

    it('should return false when commit times out', async () => {
        await node.start();

        forceLeader(node, 1);

        const logManager = (node as any)['logManager'];

        vi.spyOn(logManager, 'appendConfigEntry').mockResolvedValue(1);
        vi.spyOn(node as any, 'triggerReplication').mockResolvedValue(undefined);
        vi.spyOn(node as any, 'waitForCommit').mockResolvedValue(false);

        const result = await (node as any)['submitConfigChange']({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }, { id: 'node4', address: 'localhost:52004' }], learners: []});
        expect(result).toBe(false);
    });

    it('should call applyConfigEntry on configManager when appending', async () => {
        await node.start();

        forceLeader(node, 1);

        const newConfig = { voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }, { id: 'node4', address: 'localhost:52004' }], learners: []};
        const logManager = (node as any)['logManager'];

        vi.spyOn(logManager, 'appendConfigEntry').mockResolvedValue(1);
        vi.spyOn(node as any, 'triggerReplication').mockResolvedValue(undefined);
        vi.spyOn(node as any, 'waitForCommit').mockResolvedValue(true);

        const applyConfigEntrySpy = vi.spyOn((node as any)['configManager'], 'applyConfigEntry').mockResolvedValue(undefined);

        const result = await (node as any)['submitConfigChange'](newConfig);
        expect(applyConfigEntrySpy).toHaveBeenCalledWith(newConfig);
        expect(result).toBe(true);
    });

    it('should return true when commit succeeds', async () => {
        await node.start();

        forceLeader(node, 1);

        const logManager = (node as any)['logManager'];

        vi.spyOn(logManager, 'appendConfigEntry').mockResolvedValue(1);
        vi.spyOn(node as any, 'triggerReplication').mockResolvedValue(undefined);
        vi.spyOn(node as any, 'waitForCommit').mockResolvedValue(true);

        const result = await (node as any)['submitConfigChange']({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }, { id: 'node4', address: 'localhost:52004' }], learners: []});
        expect(result).toBe(true);
    });

    it('should apply and commit config from snapshot when voters non-empty', async () => {
        const snapshotManager = (node as any)['snapshotManager'];
        const snapshotConfig = { voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }], learners: []};
        vi.spyOn(snapshotManager, 'initialize').mockResolvedValue(undefined);
        vi.spyOn(snapshotManager, 'loadSnapshot').mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snapshot'),
            config: snapshotConfig
        });

        const applyConfigEntrySpy = vi.spyOn((node as any)['configManager'], 'applyConfigEntry').mockResolvedValue(undefined);
        const commitConfigSpy = vi.spyOn((node as any)['configManager'], 'commitConfig').mockResolvedValue(undefined);

        await node.start();

        expect(applyConfigEntrySpy).toHaveBeenCalledWith(snapshotConfig);
        expect(commitConfigSpy).toHaveBeenCalledWith(snapshotConfig);
    });

    it('should not apply config from snapshot when voters list is empty', async () => {
        const snapshotManager = (node as any)['snapshotManager'];
        const snapshotConfig = { voters: [], learners: [{ id: 'node4', address: 'localhost:52004' }]};
        vi.spyOn(snapshotManager, 'initialize').mockResolvedValue(undefined);
        vi.spyOn(snapshotManager, 'loadSnapshot').mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snapshot'),
            config: snapshotConfig
        });

        const applyConfigEntrySpy = vi.spyOn((node as any)['configManager'], 'applyConfigEntry').mockResolvedValue(undefined);

        await node.start();

        expect(applyConfigEntrySpy).not.toHaveBeenCalled();
    });

    it('should apply config from latest log entry on start', async () => {
        const logManager = (node as any)['logManager'];
        const latestConfig = { voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }, { id: 'node4', address: 'localhost:52004' }], learners: []};

        vi.spyOn(logManager, 'getLastConfigEntry').mockResolvedValue(latestConfig);

        const applyConfigEntrySpy = vi.spyOn((node as any)['configManager'], 'applyConfigEntry').mockResolvedValue(undefined);

        await node.start();

        expect(applyConfigEntrySpy).toHaveBeenCalledWith(latestConfig);
    });

    it('should not apply log ocnfig when no config entry exists', async () => {
        const logManager = (node as any)['logManager'];
        vi.spyOn(logManager, 'getLastConfigEntry').mockResolvedValue(null);

        const applyConfigEntrySpy = vi.spyOn((node as any)['configManager'], 'applyConfigEntry').mockResolvedValue(undefined);

        await node.start();

        expect(applyConfigEntrySpy).not.toHaveBeenCalled();
    });

    it('should skip applying CONFIG entries and still advance lastApplied', async () => {
        await node.start();

        const logManager = (node as any)['logManager'];
        const volatileState = (node as any)['volatileState'];

        await logManager.appendConfigEntry({ voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }, { id: 'node4', address: 'localhost:52004' }], learners: []}, 1);
        volatileState.setCommitIndex(1);

        await tickApplyLoop();

        await vi.waitFor(() => {
            expect(volatileState.getLastApplied()).toBe(1);
        });

        expect(appStateMachine.apply).not.toHaveBeenCalled();
    });

    it('should emit ConfigChangeRejected when submitConfigChange fails', async () => {
        await node.start();
        forceLeader(node);

        transport.addPeer = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(false);

        const emittedEvents: any[] = [];
        (node as any)['bus'] = {
            emit: (e: any) => emittedEvents.push(e),
            subscribe: vi.fn()
        };

        await node.addServer('node4', 'localhost:52003');

        const rejected = emittedEvents.find(e => e.type === 'ConfigChangeRejected');
        expect(rejected).toBeDefined();
        expect(rejected.reason).toBe('Failed to commit configuration change');
    });

    it('should call transport.addPeer via onPeerDiscovered callback using address from configManager', async () => {
        await node.start();

        forceLeader(node);

        (node as any)['configManager']['activeConfig'] = {
            voters: [{ id: 'node1', address: 'localhost:52001' }, { id: 'node2', address: 'localhost:52002' }, { id: 'node3', address: 'localhost:52003' }, { id: 'node4', address: 'localhost:52004' }],
            learners: []
        };

        transport.addPeer = vi.fn().mockResolvedValue(undefined);

        const onPeerDiscovered = (node as any)['stateMachine']['onPeerDiscovered'];
        onPeerDiscovered('node4', 0);

        expect(transport.addPeer).toHaveBeenCalledWith('node4', 'localhost:52004');
    });

    it('should not call transport.addPeer via onPeerDiscovered when address is not found', async () => {
        await node.start();

        transport.addPeer = vi.fn().mockResolvedValue(undefined);

        const onPeerDiscovered = (node as any)['stateMachine']['onPeerDiscovered'];
        onPeerDiscovered('node49', 0);

        expect(transport.addPeer).not.toHaveBeenCalled();
    });

    it('should call transport.addPeer when registerPeer is called', async () => {
        await node.start();

        transport.addPeer = vi.fn().mockResolvedValue(undefined);

        await node.registerPeer('node4', 'localhost:52003');
        expect(transport.addPeer).toHaveBeenCalledWith('node4', 'localhost:52003');
    });

    it('should not emit LearnerPromoted event when promoteServer fails', async () => {
        await node.start();
        forceLeader(node);

        vi.spyOn((node as any)['configManager'], 'getActiveConfig').mockReturnValue({
            voters: [{ id: 'node1', address: 'localhost:52000' }, { id: 'node2', address: 'localhost:52001' }],
            learners: [{ id: 'node3', address: 'localhost:52002' }]
        });

        vi.spyOn(node as any, 'submitConfigChange').mockResolvedValue(false);

        const emittedEvents: any[] = [];
        (node as any)['bus'] = {
            emit: (e: any) => emittedEvents.push(e),
            subscribe: vi.fn()
        };

        const result = await node.promoteServer('node3');

        expect(result).toBe(false);
        const promoted = emittedEvents.find(e => e.type === 'LearnerPromoted');
        expect(promoted).toBeUndefined();
    });

        it('should log learners when loading snapshot config with learners', async () => {
        const snapshotManager = (node as any)['snapshotManager'];
        vi.spyOn(snapshotManager, 'initialize').mockResolvedValue(undefined);
        vi.spyOn(snapshotManager, 'loadSnapshot').mockResolvedValue({
            lastIncludedIndex: 5,
            lastIncludedTerm: 1,
            data: Buffer.from('snapshot'),
            config: {
                voters: [{ id: 'node1', address: 'localhost:52000' }],
                learners: [{ id: 'node4', address: 'localhost:52003' }]
            }
        });
        vi.spyOn((node as any)['configManager'], 'applyConfigEntry').mockReturnValue(undefined);
        vi.spyOn((node as any)['configManager'], 'commitConfig').mockResolvedValue(undefined);
        await node.start();
        expect(node.isStarted()).toBe(true);
    });

    it('should log learners when applying config from log entry with learners', async () => {
        const logManager = (node as any)['logManager'];
        vi.spyOn(logManager, 'getLastConfigEntry').mockResolvedValue({
            voters: [{ id: 'node1', address: 'localhost:52000' }, { id: 'node2', address: 'localhost:52001' }],
            learners: [{ id: 'node4', address: 'localhost:52003' }]
        });
        vi.spyOn((node as any)['configManager'], 'applyConfigEntry').mockReturnValue(undefined);
        await node.start();
        expect(node.isStarted()).toBe(true);
    });

    it('should return false when node is already a learner via mock', async () => {
        await node.start();
        forceLeader(node);
        vi.spyOn((node as any)['configManager'], 'getActiveConfig').mockReturnValue({
            voters: [{ id: 'node1', address: 'localhost:52000' }, { id: 'node2', address: 'localhost:52001' }, { id: 'node3', address: 'localhost:52002' }],
            learners: [{ id: 'node4', address: 'localhost:52003' }]
        });
        const result = await node.addServer('node4', 'localhost:52003');
        expect(result).toBe(false);
    });

    it('should not throw when transport.removePeer is undefined', async () => {
        await node.start();

        transport.removePeer = undefined;

        await expect(
            node.removePeer('node4')
        ).resolves.not.toThrow();
    });
});

