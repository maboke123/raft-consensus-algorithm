import { describe, it, expect, beforeEach, vi } from "vitest";
import { TimerManager } from "./TimerManager";
import { TimerManagerError } from "../util/Error";
import { MockClock } from "./Clock";
import { SeededRandom } from "../util/Random";
import { afterEach, before } from "node:test";
import { ConsoleLogger, Logger } from "../util/Logger";

describe("TimerManager.ts, TimerManager", () => {

    let clock: MockClock;
    let random: SeededRandom;
    let logger: Logger;

    const validConfig = {
        electionTimeoutMin: 300,
        electionTimeoutMax: 500,
        heartbeatInterval: 100,
    };

    const invalidConfig1 = {
        electionTimeoutMin: "not an integer" as any,
        electionTimeoutMax: 200,
        heartbeatInterval: 100,
    };
    const invalidConfig2 = {
        electionTimeoutMin: -1,
        electionTimeoutMax: 200,
        heartbeatInterval: 100,
    };
    const invalidConfig3 = {
        electionTimeoutMin: 300,
        electionTimeoutMax: "not an integer" as any,
        heartbeatInterval: 100,
    };
    const invalidConfig4 = {
        electionTimeoutMin: 300,
        electionTimeoutMax: -1,
        heartbeatInterval: 100,
    };
    const invalidConfig5 = {
        electionTimeoutMin: 300,
        electionTimeoutMax: 200,
        heartbeatInterval: 100,
    };
    const invalidConfig6 = {
        electionTimeoutMin: 300,
        electionTimeoutMax: 500,
        heartbeatInterval: "not an integer" as any,
    };
    const invalidConfig7 = {
        electionTimeoutMin: 300,
        electionTimeoutMax: 500,
        heartbeatInterval: -1,
    };
    const invalidConfig8 = {
        electionTimeoutMin: 100,
        electionTimeoutMax: 500,
        heartbeatInterval: 100,
    };

    beforeEach(() => {
        clock = new MockClock();
        random = new SeededRandom(123);
        logger = { 
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
        }
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should throw for non-integer electionTimeoutMin", () => {
        expect(() => new TimerManager(clock, random, logger, invalidConfig1)).toThrow(TimerManagerError);
    });

    it("should throw for non-positive electionTimeoutMin", () => {
        expect(() => new TimerManager(clock, random, logger, invalidConfig2)).toThrow(TimerManagerError);
    });

    it("should throw for non-integer electionTimeoutMax", () => {
        expect(() => new TimerManager(clock, random, logger, invalidConfig3)).toThrow(TimerManagerError);
    });

    it("should throw for electionTimeoutMax less than electionTimeoutMin", () => {
        expect(() => new TimerManager(clock, random, logger, invalidConfig4)).toThrow(TimerManagerError);
    });

    it("should throw for non-integer heartbeatInterval", () => {
        expect(() => new TimerManager(clock, random, logger, invalidConfig6)).toThrow(TimerManagerError);
    });

    it("should throw for non-positive heartbeatInterval", () => {
        expect(() => new TimerManager(clock, random, logger, invalidConfig7)).toThrow(TimerManagerError);
    });

    it("should throw if electionTimeoutMin is less than minRatio times heartbeatInterval", () => {
        expect(() => new TimerManager(clock, random, logger, invalidConfig8)).toThrow(TimerManagerError);
    });

    it("should create TimerManager with valid config", () => {
        expect(() => new TimerManager(clock, random, logger, validConfig)).not.toThrow();
    });

    it('should start and fire election timer', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        let called = false;
        timerManager.startElectionTimer(() => {
            called = true;
        });
        expect(timerManager.isElectionTimerActive()).toBe(true);
        clock.advanceMs(400);
        expect(called).toBe(true);
        expect(timerManager.isElectionTimerActive()).toBe(false);
    });

    it('should stop election timer', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        let called = false;
        timerManager.startElectionTimer(() => {
            called = true;
        });
        expect(timerManager.isElectionTimerActive()).toBe(true);
        timerManager.stopElectionTimer();
        clock.advanceMs(400);
        expect(called).toBe(false);
        expect(timerManager.isElectionTimerActive()).toBe(false);
    });

    it('should reset election timer', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        let called = false;
        timerManager.startElectionTimer(() => {
            called = true;
        });
        expect(timerManager.isElectionTimerActive()).toBe(true);
        timerManager.resetElectionTimer();
        clock.advanceMs(300);
        expect(called).toBe(false);
        expect(timerManager.isElectionTimerActive()).toBe(true);
        clock.advanceMs(200);
        expect(called).toBe(true);
        expect(timerManager.isElectionTimerActive()).toBe(false);
    });

    /* became irrelevant
    it('should start and fire heartbeat timer repeatedly until max', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        let callCount = 0;
        timerManager.startHeartbeatTimer(() => {
            callCount++;
        });

        for (let i = 0; i < 10; i++) {
            clock.advanceMs(100);
        }
        expect(callCount).toBe(10);
        expect(logger.warn).toHaveBeenCalledOnce();
        expect(timerManager.isHeartbeatTimerActive()).toBe(false);
    });
    */

    it('should stop heartbeat timer', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        let called = false;
        timerManager.startHeartbeatTimer(() => {
            called = true;
        });
        timerManager.stopHeartbeatTimer();
        expect(timerManager.isHeartbeatTimerActive()).toBe(false);
        clock.advanceMs(100);
        expect(called).toBe(false);
    });

    it('should stop all timers', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        let electionCalled = false;
        let heartbeatCalled = false;
        timerManager.startElectionTimer(() => {
            electionCalled = true;
        });
        timerManager.startHeartbeatTimer(() => {
            heartbeatCalled = true;
        });
        timerManager.stopAllTimers();
        expect(timerManager.isElectionTimerActive()).toBe(false);
        expect(timerManager.isHeartbeatTimerActive()).toBe(false);
        clock.advanceMs(500);
        expect(electionCalled).toBe(false);
        expect(heartbeatCalled).toBe(false);
    });

    it('should return correct election timeout range', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        const range = timerManager.getElectionTimeoutRange();
        expect(range).toEqual({ min: 300, max: 500 });
    });

    it('should return heartbeat interval', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        expect(timerManager.getHeartbeatInterval()).toBe(100);
    });

    it('should log error if election timer callback throws', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        const error = new Error("Test error");
        timerManager.startElectionTimer(() => {
            throw error;
        });
        clock.advanceMs(400);
        expect(logger.error).toHaveBeenCalledWith(`Error in election timer callback`, error);
    });

    it('should log error if heartbeat timer callback throws', () => {
        const timerManager = new TimerManager(clock, random, logger, validConfig);
        const error = new Error("Test error");
        timerManager.startHeartbeatTimer(() => {
            throw error;
        });
        clock.advanceMs(100);
        expect(logger.error).toHaveBeenCalledWith(`Error in heartbeat timer callback`, error);
    });

    it('should do nothing if resetElectionTimer is called before starting election timer', () => {
        const tm = new TimerManager(clock, random, logger, validConfig);

        expect(() => tm.resetElectionTimer()).not.toThrow();
        expect(tm.isElectionTimerActive()).toBe(false);
    });
});
