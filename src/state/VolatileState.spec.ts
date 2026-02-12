import { describe, it, expect } from "vitest";
import { VolatileState } from "./VolatileState";
import { VolatileStateError } from "../util/Error";

describe('VolatileState.ts, VolatileState', () => {
    it('should initialize with commitIndex and lastApplied set to 0', () => {
        const volatileState = new VolatileState();
        expect(volatileState.getCommitIndex()).toBe(0);
        expect(volatileState.getLastApplied()).toBe(0);
    });

    it('should get and set commit index correctly', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        expect(volatileState.getCommitIndex()).toBe(5);
    });

    it('should throw an error when setting commit index to a non-integer value', () => {
        const volatileState = new VolatileState();
        expect(() => volatileState.setCommitIndex(3.5)).toThrow(VolatileStateError);
    });

    it('should throw an error when setting commit index to a negative value', () => {
        const volatileState = new VolatileState();
        expect(() => volatileState.setCommitIndex(-1)).toThrow(VolatileStateError);
    });

    it('should throw an error when setting commit index smaller than current commit index', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        expect(() => volatileState.setCommitIndex(4)).toThrow(VolatileStateError);
    });

    it('should advance commit index correctly', () => {
        const volatileState = new VolatileState();
        volatileState.advanceCommitIndex();
        expect(volatileState.getCommitIndex()).toBe(1);
        volatileState.advanceCommitIndex();
        expect(volatileState.getCommitIndex()).toBe(2);
    });

    it('should get and set last applied index correctly', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(3);
        volatileState.setLastApplied(3);
        expect(volatileState.getLastApplied()).toBe(3);
    });

    it('should throw an error when setting last applied index to a non-integer value', () => {
        const volatileState = new VolatileState();
        expect(() => volatileState.setLastApplied(2.5)).toThrow(VolatileStateError);
    });

    it('should throw an error when setting last applied index to a negative value', () => {
        const volatileState = new VolatileState();
        expect(() => volatileState.setLastApplied(-1)).toThrow(VolatileStateError);
    });

    it('should throw an error when setting index smaller than current last applied index', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(5);
        expect(() => volatileState.setLastApplied(4)).toThrow(VolatileStateError);
    });

    it('should throw an error when setting last applied index greater than commit index', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        expect(() => volatileState.setLastApplied(6)).toThrow(VolatileStateError);
    });

    it('should advance last applied index correctly', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(3);
        expect(volatileState.advanceLastApplied()).toBe(4);
        expect(volatileState.advanceLastApplied()).toBe(5);
    });

    it('should throw an error when advancing last applied index beyond commit index', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(5);
        expect(() => volatileState.advanceLastApplied()).toThrow(VolatileStateError);
    });

    it('should correctly report when application is needed', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(3);
        expect(volatileState.needsApplication()).toBe(true);
        volatileState.setLastApplied(5);
        expect(volatileState.needsApplication()).toBe(false);
    });

    it('should return the next index to apply correctly', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(3);
        expect(volatileState.getNextIndexToApply()).toBe(4);
        volatileState.setLastApplied(4);
        expect(volatileState.getNextIndexToApply()).toBe(5);
        volatileState.setLastApplied(5);
        expect(volatileState.getNextIndexToApply()).toBeNull();
    });

    it('should throw when nothing needs to be applied but getNextIndexToApply is called', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(5);
        expect(volatileState.getNextIndexToApply()).toBeNull();
    });

    it('should return the pending applications count correctly', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(3);
        expect(volatileState.getPendingApplicationsCount()).toBe(2);
        volatileState.setLastApplied(4);
        expect(volatileState.getPendingApplicationsCount()).toBe(1);
        volatileState.setLastApplied(5);
        expect(volatileState.getPendingApplicationsCount()).toBe(0);
    });

    it('should reset volatile state correctly', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(3);
        volatileState.reset();
        expect(volatileState.getCommitIndex()).toBe(0);
        expect(volatileState.getLastApplied()).toBe(0);
    });

    it('should create a snapshot of the volatile state correctly', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        volatileState.setLastApplied(3);
        const snapshot = volatileState.snapshot();
        expect(snapshot.commitIndex).toBe(5);
        expect(snapshot.lastApplied).toBe(3);
    });

    it('should restore volatile state from a snapshot correctly', () => {
        const volatileState = new VolatileState();
        const snapshot = { commitIndex: 5, lastApplied: 3 };
        volatileState.restoreFromSnapshot(snapshot);
        expect(volatileState.getCommitIndex()).toBe(5);
        expect(volatileState.getLastApplied()).toBe(3);
    });

    it('should throw when restoring from an invalid snapshot with non-integer commit index', () => {
        const volatileState = new VolatileState();
        const snapshot = { commitIndex: 2.5, lastApplied: 3 };
        expect(() => volatileState.restoreFromSnapshot(snapshot)).toThrow(VolatileStateError);
    });

    it('should throw when restoring from an invalid snapshot with negative commit index', () => {
        const volatileState = new VolatileState();
        const snapshot = { commitIndex: -1, lastApplied: 3 };
        expect(() => volatileState.restoreFromSnapshot(snapshot)).toThrow(VolatileStateError);
    });

    it('should throw when restoring from an invalid snapshot with non-integer last applied index', () => {
        const volatileState = new VolatileState();
        const snapshot = { commitIndex: 5, lastApplied: 2.5 };
        expect(() => volatileState.restoreFromSnapshot(snapshot)).toThrow(VolatileStateError);
    });

    it('should throw when restoring from an invalid snapshot with negative last applied index', () => {
        const volatileState = new VolatileState();
        const snapshot = { commitIndex: 5, lastApplied: -1 };
        expect(() => volatileState.restoreFromSnapshot(snapshot)).toThrow(VolatileStateError);
    });

    it('should throw when restoring from snapshot with commit index smaller than commit index', () => {
        const volatileState = new VolatileState();
        volatileState.setCommitIndex(5);
        const snapshot = { commitIndex: 4, lastApplied: 3 };
        expect(() => volatileState.restoreFromSnapshot(snapshot)).toThrow(VolatileStateError);
    });

    it('should throw when restoring form snapshot with last applied bigger than commit index', () => {
        const volatileState = new VolatileState();
        const snapshot = { commitIndex: 5, lastApplied: 6 };
        expect(() => volatileState.restoreFromSnapshot(snapshot)).toThrow(VolatileStateError);
    });
});