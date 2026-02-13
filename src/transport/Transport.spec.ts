import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockTransport } from "./Transport";
import { NetworkError } from "../util/Error";
import { SeededRandom } from "../util/Random";
import { RPCMessage } from "../rpc/RPCTypes";

describe("Transport.ts, MockTransport", () => {
    let transportA: MockTransport;
    let transportB: MockTransport;
    let random: SeededRandom;

    const validMessage: RPCMessage = {
        type: "RequestVote",
        direction: "request",
        payload: {
            term: 1,
            candidateId: "node1",
            lastLogIndex: 0,
            lastLogTerm: 0
        }
    };

    beforeEach(() => {
        MockTransport.reset();
        random = new SeededRandom(123);
        transportA = new MockTransport("A", random);
        transportB = new MockTransport("B", random);
    });

    it('should start and stop transport', async () => {
        await transportA.start();
        expect(transportA.isStarted()).toBe(true);
        await expect(transportA.start()).rejects.toThrow(NetworkError);
        await transportA.stop();
        expect(transportA.isStarted()).toBe(false);
        await expect(transportA.stop()).rejects.toThrow(NetworkError);
    });

    it('should throw if sending message when transport is not started', async () => {
        await expect(transportA.send("B", validMessage)).rejects.toThrow(NetworkError);
    });

    it('should throw when message is dropped due to drop rate', async () => {
        transportA.setDropRate(1);
        await transportA.start();
        await expect(transportA.send("B", validMessage)).rejects.toThrow(NetworkError);
    });

    it('should throw when message is dropped due to partition', async () => {
        MockTransport.partition(["A"], ["B"]);
        await transportA.start();
        await expect(transportA.send("B", validMessage)).rejects.toThrow(NetworkError);
    });

    it('should throw when peer has no transport', async () => {
        await transportA.start();
        await expect(transportA.send("C", validMessage)).rejects.toThrow(NetworkError);
    });

    it('should throw if peer is not started', async () => {
        await transportA.start();
        await expect(transportA.send("B", validMessage)).rejects.toThrow(NetworkError);
    });

    it('should throw if peer has no handler', async () => {
        await transportA.start();
        await transportB.start();
        await expect(transportA.send("B", validMessage)).rejects.toThrow(NetworkError);
    });

    it('should send message successfully', async () => {
        await transportA.start();
        await transportB.start();
        let handlerCalled = false;
        transportB.onMessage(async (from, message) => {
            expect(from).toBe("A");
            expect(message).toEqual(validMessage);
            handlerCalled = true;
        });
        await transportA.send("B", validMessage);
        expect(handlerCalled).toBe(true);
    });

    it('should catch error thrown by handler and rethrow as NetworkError', async () => {
        await transportA.start();
        await transportB.start();
        transportB.onMessage(async () => {
            throw new Error("Handler error");
        });
        await expect(transportA.send("B", validMessage)).rejects.toThrow(NetworkError);
    });

    it('should throw error for invalid drop rate', () => {
        expect(() => transportA.setDropRate(-0.1)).toThrow(NetworkError);
        expect(() => transportA.setDropRate(1.1)).toThrow(NetworkError);
        expect(() => transportA.setDropRate('not an integer' as any)).toThrow(NetworkError);
    });

    it('should set and get drop rate correctly', () => {
        transportA.setDropRate(0.5);
        expect(transportA.getDropRate()).toBe(0.5);
    });

    it('should partition and heal network correctly', async () => {
        MockTransport.partition(["A"], ["B"]);
        await transportA.start();
        await transportB.start();
        await expect(transportA.send("B", validMessage)).rejects.toThrow(NetworkError);
        MockTransport.healPartition();
        let handlerCalled = false;
        transportB.onMessage(async (from, message) => {
            expect(from).toBe("A");
            expect(message).toEqual(validMessage);
            handlerCalled = true;
        });
        await transportA.send("B", validMessage);
        expect(handlerCalled).toBe(true);
    });

    it('should check isPartitioned correctly', () => {
        MockTransport.partition(["A", "D"], ["B"]);
        expect(MockTransport.isPartitioned("A", "B")).toBe(true);
        expect(MockTransport.isPartitioned("A", "C")).toBe(true);
        expect(MockTransport.isPartitioned("B", "C")).toBe(true);
        expect(MockTransport.isPartitioned("A", "D")).toBe(false);
        expect(MockTransport.isPartitioned("B", "D")).toBe(true);
        expect(MockTransport.isPartitioned("C", "D")).toBe(true);
    });

    it('should reset transports and partitions correctly', async () => {
        await transportA.start();
        await transportB.start();
        MockTransport.partition(["A"], ["B"]);
        MockTransport.reset();
        expect(MockTransport.getRegisteredNodes()).toEqual([]);
        expect(MockTransport.isPartitioned("A", "B")).toBe(false);
    });

    it('should get registered nodes correctly', async () => {
        await transportA.start();
        await transportB.start();
        const nodes = MockTransport.getRegisteredNodes();
        expect(nodes).toContain("A");
        expect(nodes).toContain("B");
    });
});