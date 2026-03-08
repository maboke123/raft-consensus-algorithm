import { NodeId, RaftConfig, validateConfig } from "./Config";
import { Command, LogEntry, LogEntryType } from "../log/LogEntry";
import { RaftState } from "./StateMachine";
import { PersistentState } from "../state/PersistentState";
import { VolatileState } from "../state/VolatileState";
import { LogManager } from "../log/LogManager";
import { StateMachine } from "./StateMachine";
import { RPCHandler } from "../rpc/RPCHandler";
import { TimerManager } from "../timing/TimerManager";
import { ConsoleLogger, Logger } from "../util/Logger";
import { Random } from "../util/Random";
import { Clock } from "../timing/Clock";
import { Storage } from "../storage/Storage";
import { Transport } from "../transport/Transport";
import { RaftError } from "../util/Error";
import { AsyncLock } from "../lock/AsyncLock";
import { RaftEventBus } from "../events/RaftEvents";
import { NoOpEventBus } from "../events/EventBus";
import { SnapshotManager } from "../snapshot/SnapshotManager";
import { InstallSnapshotRequest, InstallSnapshotResponse } from "../rpc/RPCTypes";
import { ConfigManager } from "../config/ConfigManager";
import { ClusterConfig } from "../config/ClusterConfig";
import { GrpcTransport } from "../transport/GRPCTransport";

export interface CommandResult {
    success: boolean;
    index?: number;
    leaderId?: NodeId;
    error?: string;
}

export interface ApplicationStateMachine {
    apply(command: Command): Promise<any>;
    getState(): any;
    takeSnapshot(): Promise<Buffer>;
    installSnapshot(data: Buffer): Promise<void>;
}

export interface RaftNodeInterface {
    start(): Promise<void>;
    stop(): Promise<void>;
    submitCommand(command: Command): Promise<CommandResult>;
    getState(): RaftState;
    isLeader(): boolean;
    getLeaderId(): NodeId | null;
    getCurrentTerm(): number;
    getCommittedIndex(): number;
    getLastApplied(): number;
    getLastLogIndex(): number;
    getNodeId(): NodeId;
    getApplicationState(): any;
    isStarted(): boolean;
    getEntries(startIndex: number, endIndex: number): Promise<LogEntry[]>;
}

export class RaftNode implements RaftNodeInterface {
    private persistentState: PersistentState;
    private volatileState: VolatileState;
    private logManager: LogManager;
    private stateMachine: StateMachine;
    private rpcHandler: RPCHandler;
    private timerManager: TimerManager;
    private logger: Logger;

    private started: boolean = false;
    private applyLoopRunning: boolean = false;

    private applyLock: AsyncLock = new AsyncLock();
    private commandLock: AsyncLock = new AsyncLock();

    private commitWaiters: Map<number, Array<(Commited: boolean) => void>> = new Map();

    private snapshotTreshold: number = 5;
    private snapshotManager: SnapshotManager;

    private configManager: ConfigManager;

    constructor(
        private config: RaftConfig,
        private storage: Storage,
        private transport: Transport,
        private applicationStateMachine: ApplicationStateMachine,
        private clock: Clock,
        private random: Random,
        logger?: Logger,
        private bus: RaftEventBus = new NoOpEventBus()
    ) {

        validateConfig(config);

        this.logger = logger || new ConsoleLogger(config.nodeId, 'info');

        this.rpcHandler = new RPCHandler(
            config.nodeId,
            transport,
            this.logger,
            this.clock,
            this.bus
        );

        const timerConfig = {
            electionTimeoutMin: config.electionTimeoutMinMs,
            electionTimeoutMax: config.electionTimeoutMaxMs,
            heartbeatInterval: config.heartbeatIntervalMs,
        };

        this.timerManager = new TimerManager(
            this.clock,
            this.random,
            this.logger,
            timerConfig
        );

        this.persistentState = new PersistentState(storage);

        this.volatileState = new VolatileState();

        this.logManager = new LogManager(storage, this.bus, config.nodeId);

        this.snapshotManager = new SnapshotManager(storage);

        const bootstrapConfig: ClusterConfig = {
            voters: [config.nodeId, ...config.peerIds],
            learners: []
        };

        this.configManager = new ConfigManager(storage, bootstrapConfig);

        this.stateMachine = new StateMachine(
            config.nodeId,
            this.configManager,
            config,
            this.persistentState,
            this.volatileState,
            this.logManager,
            this.snapshotManager,
            this.applicationStateMachine,
            this.rpcHandler,
            this.timerManager,
            this.logger,
            this.applyLock,
            (newCommitIndex) => this.notifyCommitWaiters(newCommitIndex),
            this.bus
        );
    }

    async start(): Promise<void> {
        if (this.started) {
            throw new RaftError(`Node ${this.config.nodeId} is already started`, 'NodeAlreadyStarted');
        }

        this.volatileState.reset();

        this.logger.info(`Starting Raft node ${this.config.nodeId}`);

        try {

            if (!this.storage.isOpen()) {
                await this.storage.open();
            }

            await this.persistentState.initialize();

            const restoredTerm = this.persistentState.getCurrentTerm();
            const restoredVotedFor = this.persistentState.getVotedFor();

            this.logger.info(`Node ${this.config.nodeId} initialized with term ${restoredTerm} and votedFor ${restoredVotedFor}`);

            await this.logManager.initialize();

            const lastLogIndex = this.logManager.getLastIndex();
            const lastLogTerm = this.logManager.getLastTerm();

            this.logger.info(`Node ${this.config.nodeId} log initialized with last index ${lastLogIndex} and last term ${lastLogTerm}`);

            await this.snapshotManager.initialize();

            await this.configManager.initialize();

            const snapshot = await this.snapshotManager.loadSnapshot();

            if (snapshot) {
                if (snapshot.config.voters.length > 0) {
                    this.configManager.applyConfigEntry(snapshot.config);
                    await this.configManager.commitConfig(snapshot.config);
                    this.logger.info(`Node ${this.config.nodeId} loaded cluster configuration from snapshot: voters=${snapshot.config.voters.join(',')}, learners=${snapshot.config.learners.join(',')}`);
                }
                await this.applicationStateMachine.installSnapshot(snapshot.data);
                this.volatileState.setCommitIndex(snapshot.lastIncludedIndex);
                this.volatileState.setLastApplied(snapshot.lastIncludedIndex);
                this.logger.info(`Node ${this.config.nodeId} loaded snapshot with last included index ${snapshot.lastIncludedIndex} and term ${snapshot.lastIncludedTerm}`);
            }

            const latestLogConfig = await this.logManager.getLastConfigEntry();

            if (latestLogConfig) {
                this.configManager.applyConfigEntry(latestLogConfig);
                this.logger.info(`Node ${this.config.nodeId} applied cluster configuration from log entry: voters=${latestLogConfig.voters.join(',')}, learners=${latestLogConfig.learners.join(',')}`);
            }

            if(!this.transport.isStarted()) {
                await this.transport.start();
            }

            this.transport.onMessage(async (from, message) => {
                return await this.rpcHandler.handleIncomingMessage(from, message, {
                    onRequestVote: async (request, from) => {
                        return await this.stateMachine.handleRequestVote(request, from);
                    },

                    onAppendEntries: async (request, from) => {
                        return await this.stateMachine.handleAppendEntries(request, from);
                    },

                    onInstallSnapshot: async (from, request) => {
                        return await this.stateMachine.handleInstallSnapshot(from, request);
                    }
                });
            });

            this.stateMachine.start();

            this.startApplyLoop();

            this.started = true;
            this.logger.info(`Node ${this.config.nodeId} started successfully`);

            this.bus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.config.nodeId,
                type: "NodeRecovered",
                term: restoredTerm,
                logLength: lastLogIndex,
                commitIndex: this.volatileState.getCommitIndex(),
                snapshotIndex: this.logManager.getSnapshotIndex(),
            });

        } catch (error) {
            this.logger.error(`Failed to start node ${this.config.nodeId}`, error as Error);
            throw new RaftError(`Failed to start node: ${(error as Error).message}`, 'NodeStartFailed');
        }
    }

    async stop(): Promise<void> {
        if (!this.started) {
            throw new RaftError(`Node ${this.config.nodeId} is not started`, 'NodeNotStarted');
        }

        this.logger.info(`Stopping Raft node ${this.config.nodeId}`);

        try {
            this.stopApplyLoop();

            await this.stateMachine.stop();

            if (this.transport.isStarted()) {
                await this.transport.stop();
            }

            if (this.storage.isOpen()) {
                await this.storage.close();
            }

            this.started = false;
            this.logger.info(`Node ${this.config.nodeId} stopped successfully`);

            this.bus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.config.nodeId,
                type: "NodeCrashed",
                reason: "stopped"
            });

        } catch (error) {
            this.logger.error(`Failed to stop node ${this.config.nodeId}`, error as Error);
            throw new RaftError(`Failed to stop node: ${(error as Error).message}`, 'NodeStopFailed');
        }
    }

    async submitCommand(command: Command): Promise<CommandResult> {

        const appendResult = await this.commandLock.runExclusive(async () => {
            if (!this.started) {
                return { success: false, error: 'Node is not started' };
            }

            if (!this.stateMachine.isLeader()) {
                return { success: false, leaderId: this.stateMachine.getCurrentLeader() ?? undefined, error: 'Not the leader' };
            }

            try {
                const term = this.persistentState.getCurrentTerm();

                const idx = await this.logManager.appendCommand(command, term);

                if (!this.stateMachine.isLeader() || this.persistentState.getCurrentTerm() !== term) {
                    this.logger.warn(`Node ${this.config.nodeId} is no longer the leader or term has changed after appending command. Current term: ${this.persistentState.getCurrentTerm()}, expected term: ${term}`);
                    return { success: false, leaderId: this.stateMachine.getCurrentLeader() ?? undefined, error: 'Not the leader or term has changed' };
                }

                this.logger.info(`Leader ${this.config.nodeId} appended command to log at index ${idx} for term ${term}`);

                return { success: true, index: idx, term: term };
            } catch (error) {
                this.logger.error(`Error appending command to log`, error as Error);
                return { success: false, error: (error as Error).message };
            }
        });

        if (!appendResult.success) {
            return appendResult;
        }
        const { index: idx, term } = appendResult;

        try {
            await this.triggerReplication();

            if (!this.stateMachine.isLeader() || this.persistentState.getCurrentTerm() !== term!) {
                this.logger.warn(`Node ${this.config.nodeId} is no longer the leader or term has changed after triggering replication. Current term: ${this.persistentState.getCurrentTerm()}, expected term: ${term}`);
                return { success: false, leaderId: this.stateMachine.getCurrentLeader() ?? undefined, error: 'Not the leader or term has changed' };
            }

            const committed = await this.waitForCommit(idx!, 5000, term);

            if (committed) {
                this.logger.info(`Command at index ${idx} committed successfully`);
                return { success: true, index: idx };
            } else {
                this.logger.warn(`Command at index ${idx} failed to commit within timeout`);
                return { success: false, error: 'Failed to commit command within timeout' };
            }

        } catch (error) {
                this.logger.error(`Error submitting command`, error as Error);
                return { success: false, error: (error as Error).message };
        }
    }

    getState(): RaftState {
        return this.stateMachine.getCurrentState();
    }

    isLeader(): boolean {
        return this.stateMachine.isLeader();
    }

    getLeaderId(): NodeId | null {
        return this.stateMachine.getCurrentLeader();
    }

    getCurrentTerm(): number {
        return this.persistentState.getCurrentTerm();
    }

    getCommittedIndex(): number {
        return this.volatileState.getCommitIndex();
    }

    getLastApplied(): number {
        return this.volatileState.getLastApplied();
    }

    getLastLogIndex(): number {
        return this.logManager.getLastIndex();
    }

    getNodeId(): NodeId {
        return this.config.nodeId;
    }

    getApplicationState(): any {
        return this.applicationStateMachine.getState();
    }

    isStarted(): boolean {
        return this.started;
    }

    async getEntries(startIndex: number, endIndex: number): Promise<LogEntry[]> {
        return await this.logManager.getEntries(startIndex, endIndex);
    }

    private startApplyLoop(): void {
        if (this.applyLoopRunning) {
            return;
        }

        this.applyLoopRunning = true;

        const runApplyLoop = async () => {
            while (this.applyLoopRunning) {
                try {
                    await this.applyCommittedEntries();
                } catch (error) {
                    if (error instanceof RaftError && error.code === 'ApplyEntryFailed') {
                        this.logger.error(`Failed to apply log entry, stopping node to prevent inconsistency`, error);
                        this.applyLoopRunning = false;

                        process.exit(1);
                    }
                    this.logger.error(`Error in apply loop`, error as Error);
                }

                await new Promise<void>(resolve => this.clock.setTimeout(() => resolve(), 10));
            }
        };

        runApplyLoop();
    }

    private stopApplyLoop(): void {
        this.applyLoopRunning = false;
    }

    private async applyCommittedEntries(): Promise<void> {
        await this.applyLock.runExclusive(async () => {
            while (true) {
                const lastApplied = this.volatileState.getLastApplied();
                const commitIndex = this.volatileState.getCommitIndex();

                if (lastApplied >= commitIndex) {
                    break;
                }

                const nextIndex = lastApplied + 1;

                const snapshotIndex = this.logManager.getSnapshotIndex();
                if (nextIndex <= snapshotIndex) {
                    this.volatileState.setLastApplied(snapshotIndex);
                    this.logger.info(`Skipping applying log entries up to index ${snapshotIndex} since they are included in the snapshot`);
                    continue;
                }

                const entry = await this.logManager.getEntry(nextIndex);
                if (!entry) {
                    this.logger.error(`Failed to retrieve log entry at index ${nextIndex} for application`);
                    break;
                }

                if (entry.index !== nextIndex) {
                    this.logger.error(`Log entry index mismatch at index ${nextIndex}. Expected ${nextIndex} but got ${entry.index}`);
                    break;
                }

                try {
                    if (entry.type === LogEntryType.CONFIG) {
                        this.logger.info('skipping CONFIG entry');
                    } else {
                        const result = await this.applicationStateMachine.apply(entry.command!);
                        this.logger.info(`Applied log entry at index ${nextIndex} with command ${JSON.stringify(entry.command)}, result: ${JSON.stringify(result)}`);
                    }

                    this.volatileState.setLastApplied(nextIndex);

                    const currentLastApplied = this.volatileState.getLastApplied();
                    const lastSnapshotIndex = this.snapshotManager.getSnapshotMetadata()?.lastIncludedIndex ?? 0;

                    if (currentLastApplied - lastSnapshotIndex >= this.snapshotTreshold) {
                        await this.takeSnapshot();
                    }

                } catch (error) {
                    this.logger.error(`Error applying log entry at index ${nextIndex} with command ${JSON.stringify(entry.command)}`, error as Error);
                    
                    throw new RaftError(`Failed to apply log entry at index ${nextIndex}: ${(error as Error).message}`, 'ApplyEntryFailed');
                }
            }
        });
    }

    // private async triggerReplication(): Promise<void> {
    async triggerReplication(): Promise<void> {
        if (this.stateMachine.isLeader()) {
            await this.stateMachine.triggerReplication();
        }
    }

    async addServer(nodeId: NodeId, address: string, asLearner: boolean = false): Promise<boolean> {
        if(!this.started){
            this.logger.warn(`Node ${this.config.nodeId} is not started, cannot add server ${nodeId}`);
            return false;
        }

        if (!this.stateMachine.isLeader()) {
            this.logger.warn(`Node ${this.config.nodeId} is not the leader, cannot add server ${nodeId}`);
            return false;
        }

        if (this.configManager.hasPendingChange()) {
            this.logger.warn(`Node ${this.config.nodeId} already has a pending configuration change, cannot add server ${nodeId} until it is committed`);
            return false;
        }

        const currentConfig = this.configManager.getActiveConfig();
        if (currentConfig.voters.includes(nodeId) || currentConfig.learners.includes(nodeId)) {
            this.logger.warn(`Node ${nodeId} is already part of the cluster configuration, cannot add again`);
            return false;
        }

        await this.transport.addPeer?.(nodeId, address);

        const newConfig: ClusterConfig = asLearner
            ? { voters: currentConfig.voters, learners: [...currentConfig.learners, nodeId] }
            : { voters: [...currentConfig.voters, nodeId], learners: currentConfig.learners };

        const result = await this.submitConfigChange(newConfig);

        this.logger.info(`Initiated adding server ${nodeId} as ${asLearner ? 'learner' : 'voter'} to the cluster`);

        if (result) {
            this.bus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.config.nodeId,
                type: "ServerAdded",
                addedNodeId: nodeId,
                asLearner: asLearner,
                config: this.configManager.getCommittedConfig()
            });
        } else {
            this.bus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.config.nodeId,
                type: "ConfigChangeRejected",
                voters: newConfig.voters,
                learners: newConfig.learners,
                reason: "Failed to commit configuration change"
            });
        }
        return result;
    }

    async removeServer(nodeId: NodeId): Promise<boolean> {
        if(!this.started){
            this.logger.warn(`Node ${this.config.nodeId} is not started, cannot remove server ${nodeId}`);
            return false;
        }

        if (!this.stateMachine.isLeader()) {
            this.logger.warn(`Node ${this.config.nodeId} is not the leader, cannot remove server ${nodeId}`);
            return false;
        }

        if (this.configManager.hasPendingChange()) {
            this.logger.warn(`Node ${this.config.nodeId} already has a pending configuration change, cannot remove server ${nodeId} until it is committed`);
            return false;
        }

        const currentConfig = this.configManager.getActiveConfig();
        if (!currentConfig.voters.includes(nodeId) && !currentConfig.learners.includes(nodeId)) {
            this.logger.warn(`Node ${nodeId} is not part of the cluster configuration, cannot remove`);
            return false;
        }

        if (currentConfig.voters.includes(nodeId) && currentConfig.voters.length <= 2) {
            this.logger.warn(`Cannot remove voter ${nodeId} since it would leave the cluster with less than 2 voters`);
            return false;
        }

        const newConfig: ClusterConfig = {
            voters: currentConfig.voters.filter(id => id !== nodeId),
            learners: currentConfig.learners.filter(id => id !== nodeId)
        };

        const result = await this.submitConfigChange(newConfig);

        if (result) {
            await this.transport.removePeer?.(nodeId);

            this.bus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.config.nodeId,
                type: "ServerRemoved",
                removedNodeId: nodeId,
                config: this.configManager.getCommittedConfig()
            });
        }

        return result;
    }

    async promoteServer(nodeId: NodeId): Promise<boolean> {
        if(!this.started){
            this.logger.warn(`Node ${this.config.nodeId} is not started, cannot promote server ${nodeId}`);
            return false;
        }

        if (!this.stateMachine.isLeader()) {
            this.logger.warn(`Node ${this.config.nodeId} is not the leader, cannot promote server ${nodeId}`);
            return false;
        }

        if (this.configManager.hasPendingChange()) {
            this.logger.warn(`Node ${this.config.nodeId} already has a pending configuration change, cannot promote server ${nodeId} until it is committed`);
            return false;
        }

        const currentConfig = this.configManager.getActiveConfig();
        if (!currentConfig.learners.includes(nodeId)) {
            this.logger.warn(`Node ${nodeId} is not a learner, cannot promote`);
            return false;
        }

        const newConfig: ClusterConfig = {
            voters: [...currentConfig.voters, nodeId],
            learners: currentConfig.learners.filter(id => id !== nodeId)
        };

        const result = await this.submitConfigChange(newConfig);

        this.logger.info(`Initiated promoting server ${nodeId} to voter`);

        if (result) {
            this.bus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.config.nodeId,
                type: "LearnerPromoted",
                promotedNodeId: nodeId,
                config: this.configManager.getCommittedConfig()
            });
        }
        return result;
    }

    private async submitConfigChange(newConfig: ClusterConfig): Promise<boolean> {
        let capturedIndex: number | null = null;
        let capturedTerm: number | null = null;

        const appendResult = await this.commandLock.runExclusive(async () => {
            const term = this.persistentState.getCurrentTerm();
            const idx = await this.logManager.appendConfigEntry(newConfig, term);
            this.configManager.applyConfigEntry(newConfig);

            this.bus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.config.nodeId,
                type: "ConfigChanged",
                voters: newConfig.voters,
                learners: newConfig.learners,
                commited: false
            });

            if (!this.stateMachine.isLeader() || this.persistentState.getCurrentTerm() !== term) {
                this.logger.warn(`Node ${this.config.nodeId} is no longer the leader or term has changed after appending config entry. Current term: ${this.persistentState.getCurrentTerm()}, expected term: ${term}`);
                return false;
            }

            capturedIndex = idx;
            capturedTerm = term;

            return true;
        });

        if(!appendResult || capturedIndex === null || capturedTerm === null) {
            return false;
        }

        await this.triggerReplication();

        const committed = await this.waitForCommit(capturedIndex, 5000, capturedTerm);

        if (committed) {
            this.bus.emit({
                eventId: crypto.randomUUID(),
                timestamp: performance.now(),
                wallTime: Date.now(),
                nodeId: this.config.nodeId,
                type: "ConfigChanged",
                voters: newConfig.voters,
                learners: newConfig.learners,
                commited: true
            });
        }

        return committed;
    }

    private async waitForCommit(index: number, timeoutMs: number, term: number): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const startTime = this.clock.now();

            if (this.volatileState.getCommitIndex() >= index) {
                resolve(true);
                return;
            }

            if (!this.commitWaiters.has(index)) {
                this.commitWaiters.set(index, []);
            }

            const callback = (committed: boolean) => {
                resolve(committed);
            }

            this.commitWaiters.get(index)!.push(callback);

            const timeoutHandle = this.clock.setTimeout(() => {
                const waiters = this.commitWaiters.get(index);
                if (waiters) {
                    const idx = waiters.indexOf(callback)
                    if (idx !== -1) {
                        waiters.splice(idx, 1);
                    }
                    if (waiters.length === 0) {
                        this.commitWaiters.delete(index);
                    }
                }

                const committed = this.volatileState.getCommitIndex() >= index;
                resolve(committed)
            }, timeoutMs);

            const checkLeadership = () => {
                if (!this.stateMachine.isLeader() || this.persistentState.getCurrentTerm() !== term) {

                    this.clock.clearTimeout(timeoutHandle);

                    const waiters = this.commitWaiters.get(index);
                    if (waiters) {
                        const idx = waiters.indexOf(callback);
                        if (idx !== -1) {
                            waiters.splice(idx, 1);
                        }
                    }

                    resolve(false);
                    return;
                }

                if (this.clock.now() - startTime < timeoutMs) {
                    this.clock.setTimeout(checkLeadership, 100);
                }
            };

            this.clock.setTimeout(checkLeadership, 100);
        });
    }

    private notifyCommitWaiters(newCommitIndex: number): void {
        for (const [index, resolvers] of this.commitWaiters.entries()) {
            if (index <= newCommitIndex) {
                resolvers.forEach(resolve => resolve(true));
                this.commitWaiters.delete(index);
            }
        }
    }

    private async takeSnapshot(): Promise<void> {
        const snapshotIndex = this.volatileState.getLastApplied();
        const snapshotTerm = await this.logManager.getTermAtIndex(snapshotIndex);

        if (snapshotTerm === null) {
            this.logger.error(`Failed to get term for snapshot index ${snapshotIndex}, skipping snapshot`);
            return;
        }

        const data = await this.applicationStateMachine.takeSnapshot();

        await this.snapshotManager.saveSnapshot({
            lastIncludedIndex: snapshotIndex,
            lastIncludedTerm: snapshotTerm,
            data: data,
            config: this.configManager.getCommittedConfig()
        });

        await this.logManager.discardEntriesUpTo(snapshotIndex, snapshotTerm);

        this.logger.info(`Took snapshot at index ${snapshotIndex} and term ${snapshotTerm}, discarded log entries up to index ${snapshotIndex}`);

        this.bus.emit({
            eventId: crypto.randomUUID(),
            timestamp: performance.now(),
            wallTime: Date.now(),
            nodeId: this.config.nodeId,
            type: "SnapshotTaken",
            lastIncludedIndex: snapshotIndex,
            lastIncludedTerm: snapshotTerm,
            snapshotSizeBytes: data.length
        });
    }
}

