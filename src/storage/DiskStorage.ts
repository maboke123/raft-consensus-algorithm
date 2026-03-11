import { AsyncLock } from "../lock/AsyncLock";
import path from "node:path";
import { StorageError } from "../util/Error";
import { Storage, StorageOperation } from "./Storage";
import fs from "fs/promises";

export class DiskStorage implements Storage {
    private data: Map<string, Buffer> = new Map();
    private isOpenFlag: boolean = false;
    private readonly lock = new AsyncLock();

    private readonly dataFile: string;
    private readonly tmpFile: string;
    private readonly dirPath: string;

    constructor(dirPath: string) {
        this.dirPath = dirPath;
        this.dataFile = path.join(dirPath, "data.json");
        this.tmpFile = path.join(dirPath, "data.tmp");
    }

    async open(): Promise<void> {
        if (this.isOpenFlag) {
            throw new StorageError("Storage is already open");
        }

        await this.ensureDirectoryExists();
        await this.recover();
        await this.load();

        this.isOpenFlag = true;
    }

    async close(): Promise<void> {
        this.ensureOpen();
        this.isOpenFlag = false;
        this.data.clear();
    }

    isOpen(): boolean {
        return this.isOpenFlag;
    }

    async get(key: string): Promise<Buffer | null> {
        this.ensureOpen();
        return this.data.get(key) ?? null;
    }

    async set(key: string, value: Buffer): Promise<void> {
        await this.batch([{ type: "set", key, value }]);
    }

    async delete(key: string): Promise<void> {
        await this.batch([{ type: "delete", key }]);
    }

    async batch(operations: StorageOperation[]): Promise<void> {
        this.ensureOpen();

        for (const operation of operations) {
            if (operation.type === "set" && operation.value === undefined) {
                throw new StorageError("Value is required for set operation");
            }
        }

        await this.lock.runExclusive(async () => {
            const tempData = new Map(this.data);

            for (const operation of operations) {
                if (operation.type === "set") {
                    tempData.set(operation.key, Buffer.from(operation.value!));
                } else if (operation.type === "delete") {
                    tempData.delete(operation.key);
                } else {
                    throw new StorageError(`Invalid operation type: ${operation.type}`);
                }
            }

            await this.persist(tempData);
            this.data = tempData;
        });
    }

    async clear(): Promise<void> {
        this.ensureOpen();
        await this.lock.runExclusive(async () => {
            this.data.clear();
            await this.persist(this.data);
        });
    }

    private async recover(): Promise<void> {
        const tmpExists = await this.fileExists(this.tmpFile);
        const dataExists = await this.fileExists(this.dataFile);

        if (tmpExists && dataExists) {
            await fs.unlink(this.tmpFile);
        } else if (tmpExists && !dataExists) {
            await fs.rename(this.tmpFile, this.dataFile);
            await this.fsyncDirectory();
        }
    }

    private async load(): Promise<void> {
        const exists = await this.fileExists(this.dataFile);
        if (!exists) {
            return;
        }

        try {
            const rawData = await fs.readFile(this.dataFile, "utf-8");
            const jsonData = JSON.parse(rawData) as Record<string, string>;
            this.data.clear();
            for (const [key, value] of Object.entries(jsonData)) {
                this.data.set(key, Buffer.from(value, "base64"));
            }
        } catch (err) {
            throw new StorageError(`Failed to load data: ${(err as Error).message}`);
        }
    }

    private async persist(data: Map<string, Buffer>): Promise<void> {
        const jsonData: Record<string, string> = {};
        for (const [key, value] of data.entries()) {
            jsonData[key] = value.toString("base64");
        }

        const jsonString = JSON.stringify(jsonData);

        try {
            await fs.writeFile(this.tmpFile, jsonString, "utf-8");

            const handle = await fs.open(this.tmpFile, "r+");
            try {
                await handle.sync();
            } finally {
                await handle.close();
            }

            await fs.rename(this.tmpFile, this.dataFile);
            await this.fsyncDirectory();
        } catch (err) {
            throw new StorageError(`Failed to persist data: ${(err as Error).message}`);
        }
    }

    private async fsyncDirectory(): Promise<void> {
        try {
            const handle = await fs.open(this.dirPath, "r+");
            try {
                await handle.sync();
            } finally {
                await handle.close();
            }
        } catch {
            // skip on windows
        }
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async ensureDirectoryExists(): Promise<void> {
        await fs.mkdir(this.dirPath, { recursive: true });
    }

    private ensureOpen(): void {
        if (!this.isOpenFlag) {
            throw new StorageError("Storage is not open");
        }
    }
}