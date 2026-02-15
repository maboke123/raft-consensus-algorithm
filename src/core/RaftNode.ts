import { NodeId, RaftConfig, validateConfig } from "./Config";
import { Command, LogEntry } from "../log/LogEntry";
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

export interface CommandResult {
    success: boolean;
    index?: number;
    leaderId?: NodeId;
    error?: string;
}

export interface ApplicationStateMachine {
    apply(command: Command): Promise<any>;
    getState(): any;
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

    constructor(
        private config: RaftConfig,
        private storage: Storage,
        private transport: Transport,
        private applicationStateMachine: ApplicationStateMachine,
        private clock: Clock,
        private random: Random,
        logger?: Logger
    ) {

        validateConfig(config);

        this.logger = logger || new ConsoleLogger(config.nodeId, 'info');

        this.rpcHandler = new RPCHandler(
            config.nodeId,
            transport,
            this.logger,
            this.clock
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

        this.logManager = new LogManager(storage);

        this.stateMachine = new StateMachine(
            config.nodeId,
            config.peerIds,
            config,
            this.persistentState,
            this.volatileState,
            this.logManager,
            this.rpcHandler,
            this.timerManager,
            this.logger,
        );
    }

    async start(): Promise<void> {
        if (this.started) {
            throw new RaftError(`Node ${this.config.nodeId} is already started`, 'NodeAlreadyStarted');
        }

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
                    }
                });
            });

            this.stateMachine.start();

            this.startApplyLoop();

            this.started = true;
            this.logger.info(`Node ${this.config.nodeId} started successfully`);

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
                const result = await this.applicationStateMachine.apply(entry.command);
                this.logger.info(`Applied log entry at index ${nextIndex} with command ${JSON.stringify(entry.command)}, result: ${JSON.stringify(result)}`);
                this.volatileState.setLastApplied(nextIndex);
            } catch (error) {
                this.logger.error(`Error applying log entry at index ${nextIndex} with command ${JSON.stringify(entry.command)}`, error as Error);
                
                throw new RaftError(`Failed to apply log entry at index ${nextIndex}: ${(error as Error).message}`, 'ApplyEntryFailed');
            }
            }
        });
    }

    private async triggerReplication(): Promise<void> {
        if (this.stateMachine.isLeader()) {
            await this.stateMachine.triggerReplication();
        }
    }

    private async waitForCommit(index: number, timeoutMs: number, term: number): Promise<boolean> {
        const startTime = this.clock.now();

        while (this.clock.now() - startTime < timeoutMs) {

            if (!this.stateMachine.isLeader() || this.persistentState.getCurrentTerm() !== term) {
                this.logger.warn(`Node ${this.config.nodeId} is no longer the leader or term has changed while waiting for commit. Current term: ${this.persistentState.getCurrentTerm()}, expected term: ${term}`);
                return false;
            }

            const committedIndex = this.volatileState.getCommitIndex();

            if (committedIndex >= index) {
                return true;
            }

            await new Promise<void>(resolve => this.clock.setTimeout(() => resolve(), 10));
        }
        return false;
    }
}

