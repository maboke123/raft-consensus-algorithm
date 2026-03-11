import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { DiskStorage } from "./DiskStorage";
import fs from "fs/promises";
import path from "node:path";
import os from "os";
import { StorageError } from "../util/Error";

let testDir: string;

async function makeStorage(dir?: string): Promise<DiskStorage> {
    return new DiskStorage(dir ?? testDir);
}

async function openStorage(dir?: string): Promise<DiskStorage> {
    const storage = await makeStorage(dir);
    await storage.open();
    return storage;
}

function bufferFromString(str: string): Buffer {
    return Buffer.from(str, "utf-8");
}

function stringFromBuffer(buffer: Buffer): string {
    return buffer.toString("utf-8");
}


describe("DiskStorage.ts, DiskStorage", () => {
        
    beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), "disk-storage-test-"));
    });

    afterEach(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
    });

    it('opens succsessfully', async () => {
        const storage = await openStorage();
        expect(storage.isOpen()).toBe(true);
        await storage.close();
    });

    it('creates the dir if it does not exist', async () => {
        const customDir = path.join(testDir, "custom");
        const storage = await openStorage(customDir);
        expect(storage.isOpen()).toBe(true);
        await storage.close();
    });

    it('throws StorageError if open is called twice', async () => {
        const storage = await openStorage();
        await expect(storage.open()).rejects.toThrow("Storage is already open");
        await storage.close();
    });

    it('closes successfully', async () => {
        const storage = await openStorage();
        await storage.close();
        expect(storage.isOpen()).toBe(false);
    });

    it('throws StorageError when closing an already closed storage', async () => {
        const storage = await openStorage();
        await storage.close();
        await expect(storage.close()).rejects.toThrow("Storage is not open");
    });

    it('throws StorageError on get() when storage is closed', async () => {
        const storage = await openStorage();
        await storage.close();
        await expect(storage.get("key")).rejects.toThrow("Storage is not open");
    });

    it('throws StorageError on set() when storage is closed', async () => {
        const storage = await openStorage();
        await storage.close();
        await expect(storage.set("key", bufferFromString("value"))).rejects.toThrow("Storage is not open");
    });

    it('throws StorageError on delete() when storage is closed', async () => {
        const storage = await openStorage();
        await storage.close();
        await expect(storage.delete("key")).rejects.toThrow("Storage is not open");
    });

    it('throws StorageError on batch() when storage is closed', async () => {
        const storage = await openStorage();
        await storage.close();
        await expect(storage.batch([{ type: "set", key: "key", value: bufferFromString("value") }])).rejects.toThrow("Storage is not open");
    });

    it('returns null for non-existing keys', async () => {
        const storage = await openStorage();
        const value = await storage.get("non-existing-key");
        expect(value).toBeNull();
        await storage.close();
    });

    it('stores and retrieves a value via set() and get()', async () => {
        const storage = await openStorage();
        await storage.set("key", bufferFromString("value"));
        const value = await storage.get("key");
        expect(stringFromBuffer(value!)).toBe("value");
        await storage.close();
    });

    it('overwrites existing values', async () => {
        const storage = await openStorage();
        await storage.set("key", bufferFromString("value1"));
        await storage.set("key", bufferFromString("value2"));
        const value = await storage.get("key");
        expect(stringFromBuffer(value!)).toBe("value2");
        await storage.close();
    });

    it('deletes a key', async () => {
        const storage = await openStorage();
        await storage.set("key", bufferFromString("value"));
        await storage.delete("key");
        const value = await storage.get("key");
        expect(value).toBeNull();
        await storage.close();
    });

    it('deletes a non-existing key without error', async () => {
        const storage = await openStorage();
        await expect(storage.delete("non-existing-key")).resolves.not.toThrow();
        await storage.close();
    });

    it('stores binary data', async () => {
        const storage = await openStorage();
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        await storage.set("binaryKey", binaryData);
        const value = await storage.get("binaryKey");
        expect(value).toEqual(binaryData);
        await storage.close();
    });

    it('stores multiple keys independently', async () => {
        const storage = await openStorage();
        await storage.set("key1", bufferFromString("value1"));
        await storage.set("key2", bufferFromString("value2"));
        const value1 = await storage.get("key1");
        const value2 = await storage.get("key2");
        expect(stringFromBuffer(value1!)).toBe("value1");
        expect(stringFromBuffer(value2!)).toBe("value2");
        await storage.close();
    });

    it('applies multiple set operations atomically in batch()', async () => {
        const storage = await openStorage();
        await storage.batch([
            { type: "set", key: "key1", value: bufferFromString("value1") },
            { type: "set", key: "key2", value: bufferFromString("value2") },
        ]);
        const value1 = await storage.get("key1");
        const value2 = await storage.get("key2");
        expect(stringFromBuffer(value1!)).toBe("value1");
        expect(stringFromBuffer(value2!)).toBe("value2");
        await storage.close();
    });

    it('applies mixed set and delete operations atomically in batch()', async () => {
        const storage = await openStorage();
        await storage.set("key1", bufferFromString("value1"));
        await storage.set("key2", bufferFromString("value2"));
        await storage.batch([
            { type: "delete", key: "key1" },
            { type: "set", key: "key2", value: bufferFromString("newValue2") },
        ]);
        const value1 = await storage.get("key1");
        const value2 = await storage.get("key2");
        expect(value1).toBeNull();
        expect(stringFromBuffer(value2!)).toBe("newValue2");
        await storage.close();
    });

    it('throws StorageError for a set operation without value in batch()', async () => {
        const storage = await openStorage();
        await expect(storage.batch([{ type: "set", key: "key1" }])).rejects.toThrow("Value is required for set operation");
        await storage.close();
    });

    it('throws StorageError for an invalid operation type in batch()', async () => {
        const storage = await openStorage();
        await expect(storage.batch([{ type: "invalid" as any, key: "key1", value: bufferFromString("value1") }])).rejects.toThrow("Invalid operation type: invalid");
        await storage.close();
    });

    it('does not modify storage if batch() fails', async () => {
        const storage = await openStorage();
        await storage.set("key1", bufferFromString("value1"));
        await expect(storage.batch([
            { type: "set", key: "key2", value: bufferFromString("value2") },
            { type: "invalid" as any, key: "key3", value: bufferFromString("value3") },
        ])).rejects.toThrow("Invalid operation type: invalid");
        const value1 = await storage.get("key1");
        const value2 = await storage.get("key2");
        const value3 = await storage.get("key3");
        expect(stringFromBuffer(value1!)).toBe("value1");
        expect(value2).toBeNull();
        expect(value3).toBeNull();
        await storage.close();
    });

    it('handles an empty batch without error', async () => {
        const storage = await openStorage();
        await expect(storage.batch([])).resolves.not.toThrow();
        await storage.close();
    });

    it('persists a single value across open and close', async () => {
        const storage = await openStorage();
        await storage.set("key", bufferFromString("value"));
        await storage.close();
        const storage2 = await openStorage();
        const value = await storage2.get("key");
        expect(stringFromBuffer(value!)).toBe("value");
        await storage2.close();
    });

    it('persists multiple values across open and close', async () => {
        const storage = await openStorage();
        await storage.set("key1", bufferFromString("value1"));
        await storage.set("key2", bufferFromString("value2"));
        await storage.close();
        const storage2 = await openStorage();
        const value1 = await storage2.get("key1");
        const value2 = await storage2.get("key2");
        expect(stringFromBuffer(value1!)).toBe("value1");
        expect(stringFromBuffer(value2!)).toBe("value2");
        await storage2.close();
    });

    it('persists deletions across open and close', async () => {
        const storage = await openStorage();
        await storage.set("key1", bufferFromString("value1"));
        await storage.set("key2", bufferFromString("value2"));
        await storage.delete("key1");
        await storage.close();
        const storage2 = await openStorage();
        const value1 = await storage2.get("key1");
        const value2 = await storage2.get("key2");
        expect(value1).toBeNull();
        expect(stringFromBuffer(value2!)).toBe("value2");
        await storage2.close();
    });

    it('persists binary data correctly across open and close', async () => {
        const storage = await openStorage();
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03]);
        await storage.set("binaryKey", binaryData);
        await storage.close();
        const storage2 = await openStorage();
        const value = await storage2.get("binaryKey");
        expect(value).toEqual(binaryData);
        await storage2.close();
    });

    it('returns empty state on first open', async () => {
        const storage = await openStorage();
        const value = await storage.get("non-existing-key");
        expect(value).toBeNull();
        await storage.close();
    });

    it('creates a data.json after first write', async () => {
        const storage = await openStorage();
        await storage.set("key", bufferFromString("value"));
        await storage.close();
        const dataFilePath = path.join(testDir, "data.json");
        const fileExists = await fs.stat(dataFilePath).then(() => true).catch(() => false);
        expect(fileExists).toBe(true);
    });

    it('data.json is not created if no writes are made', async () => {
        const storage = await openStorage();
        await storage.close();
        const dataFilePath = path.join(testDir, "data.json");
        const fileExists = await fs.stat(dataFilePath).then(() => true).catch(() => false);
        expect(fileExists).toBe(false);
    });

    it('recovers when only data.tmp exists', async () => {
        const tmpFile = path.join(testDir, "data.tmp");
        const dataFile = path.join(testDir, "data.json");

        const state = { key: bufferFromString("value").toString("base64") };
        await fs.writeFile(tmpFile, JSON.stringify(state), "utf-8");

        await expect(fs.access(dataFile)).rejects.toThrow();

        const storage = await openStorage();
        expect(stringFromBuffer((await storage.get("key"))!)).toBe("value");
        await storage.close();

        await expect(fs.access(tmpFile)).rejects.toThrow();
    });

    it('recovers when both data.json and data.tmp exist', async () => {
        let storage = await openStorage();
        await storage.set("key", bufferFromString("value1"));
        await storage.close();

        const tmpFile = path.join(testDir, "data.tmp");
        await fs.writeFile(tmpFile, "stale data", "utf-8");

        storage = await openStorage();
        expect(stringFromBuffer((await storage.get("key"))!)).toBe("value1");
        await storage.close();

        await expect(fs.access(tmpFile)).rejects.toThrow();
    });

    it('throws StorageError if data.json is corrupted', async () => {
        const dataFile = path.join(testDir, "data.json");
        await fs.writeFile(dataFile, "not a valid json{{{", "utf-8");
        const storage = await makeStorage();
        await expect(storage.open()).rejects.toThrow(StorageError);
    });

    it('handles empty data.json file gracefully', async () => {
        const dataFile = path.join(testDir, "data.json");
        await fs.writeFile(dataFile, "", "utf-8");
        const storage = await makeStorage();
        await expect(storage.open()).rejects.toThrow(StorageError);
    });

    it('leaves no data.tmp file after a successful write', async () => {
        const storage = await openStorage();
        await storage.set("key", bufferFromString("value"));
        await storage.close();
        const tmpFilePath = path.join(testDir, "data.tmp");
        const fileExists = await fs.stat(tmpFilePath).then(() => true).catch(() => false);
        expect(fileExists).toBe(false);
    });

    it('serializes concurrent bathc() calls without data loss', async () => {
        const storage = await openStorage();

        await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                storage.set(`key${i}`, bufferFromString(`value${i}`))
            )
        );

        for (let i = 0; i < 10; i++) {
            const value = await storage.get(`key${i}`);
            expect(stringFromBuffer(value!)).toBe(`value${i}`);
        }

        await storage.close();
    });

    it('last concurrent writer wins in batch()', async () => {
        const storage = await openStorage();
        await Promise.all(
            Array.from({ length: 10 }, (_, i) =>
                storage.set(`key`, bufferFromString(`value${i}`))
            )
        );
        const value = await storage.get(`key`);
        expect(stringFromBuffer(value!)).toBe(`value9`);
        await storage.close();
    });

    it('concurrent batches do not interleave operations', async () => {
        const storage = await openStorage();
        await Promise.all([
            storage.batch([
                { type: "set", key: "key1", value: bufferFromString("value1") },
                { type: "set", key: "key2", value: bufferFromString("value2") },
            ]),
            storage.batch([
                { type: "set", key: "key3", value: bufferFromString("value3") },
                { type: "set", key: "key4", value: bufferFromString("value4") },
            ]),
        ]);
        const value1 = await storage.get("key1");
        const value2 = await storage.get("key2");
        const value3 = await storage.get("key3");
        const value4 = await storage.get("key4");
        expect(stringFromBuffer(value1!)).toBe("value1");
        expect(stringFromBuffer(value2!)).toBe("value2");
        expect(stringFromBuffer(value3!)).toBe("value3");
        expect(stringFromBuffer(value4!)).toBe("value4");
        await storage.close();
    });

    it('throws StorageError when persist fails', async () => {
        const storage = await openStorage();

        await fs.rm(testDir, { recursive: true, force: true });

        await expect(storage.set("key", bufferFromString("value"))).rejects.toThrow(StorageError);
        await storage.close();
    });

    it('clears all stored values', async () => {
        const storage = await openStorage();

        await storage.set("key1", bufferFromString("value1"));
        await storage.set("key2", bufferFromString("value2"));

        await storage.clear();

        const value1 = await storage.get("key1");
        const value2 = await storage.get("key2");

        expect(value1).toBeNull();
        expect(value2).toBeNull();

        await storage.close();
    });
});