import { describe, it, expect } from "vitest";
import { InMemoryStorage, StorageOperation } from "./Storage";

describe('Storage.ts, InMemoryStorage', () => {
    it('should open and close storage', async () => {
        const storage = new InMemoryStorage();
        expect(storage.isOpen()).toBe(false);
        await storage.open();
        expect(storage.isOpen()).toBe(true);
        await storage.close();
        expect(storage.isOpen()).toBe(false);
    });

    it('should throw if already open or closed', async () => {
        const storage = new InMemoryStorage();
        await expect(storage.close()).rejects.toThrow("Storage is not open");
        await storage.open();
        await expect(storage.open()).rejects.toThrow("Storage is already open");
        await storage.close();
    });

    it('should set and get values', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        const key = "testKey";
        const value = Buffer.from("testValue");
        await storage.set(key, value);
        const retrieved = await storage.get(key);
        expect(retrieved).toEqual(value);
        await storage.close();
    });

    it('should delete values', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        const key = "testKey";
        const value = Buffer.from("testValue");
        await storage.set(key, value);
        await storage.delete(key);
        const retrieved = await storage.get(key);
        expect(retrieved).toBeNull();
        await storage.close();
    });

    it('should perform batch operations', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        const operations: StorageOperation[] = [
            { type: "set", key: "key1", value: Buffer.from("value1") },
            { type: "set", key: "key2", value: Buffer.from("value2") },
            { type: "delete", key: "key1" }
        ];
        await storage.batch(operations);
        const value1 = await storage.get("key1");
        const value2 = await storage.get("key2");
        expect(value1).toBeNull();
        expect(value2).toEqual(Buffer.from("value2"));
        await storage.close();
    });

    it('should throw when an operation in batch is set and value is missing', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        const operations: StorageOperation[] = [
            { type: "set", key: "key1" },
        ];
        await expect(storage.batch(operations)).rejects.toThrow("Value is required for set operation");
        await storage.close();
    });

    it('should throw when an operation in batch is not set or delete', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        const operations: StorageOperation[] = [
            { type: "invalid" as any, key: "key1" },
        ];
        await expect(storage.batch(operations)).rejects.toThrow("Invalid operation type");
        await storage.close();
    });

    it('should return keys', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        await storage.set("key1", Buffer.from("value1"));
        await storage.set("key2", Buffer.from("value2"));
        const keys = storage.keys();
        expect(keys.sort()).toEqual(["key1", "key2"]);
        await storage.close();
    });

    it('should return values', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        await storage.set("key1", Buffer.from("value1"));
        await storage.set("key2", Buffer.from("value2"));
        const values = storage.values();
        expect(values).toEqual([Buffer.from("value1"), Buffer.from("value2")]);
        await storage.close();
    });

    it('should return entries', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        await storage.set("key1", Buffer.from("value1"));
        await storage.set("key2", Buffer.from("value2"));
        const entries = storage.entries();
        expect(entries).toEqual([["key1", Buffer.from("value1")], ["key2", Buffer.from("value2")]]);
        await storage.close();
    });

    it('should clear all data', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        await storage.set("key1", Buffer.from("value1"));
        await storage.set("key2", Buffer.from("value2"));
        storage.clear();
        const keys = storage.keys();
        expect(keys).toEqual([]);
        await storage.close();
    });

    it('should return size of storage', async () => {
        const storage = new InMemoryStorage();
        await storage.open();
        expect(storage.size()).toBe(0);
        await storage.set("key1", Buffer.from("value1"));
        expect(storage.size()).toBe(1);
        await storage.set("key2", Buffer.from("value2"));
        expect(storage.size()).toBe(2);
        await storage.delete("key1");
        expect(storage.size()).toBe(1);
        await storage.close();
    });
});