import fs from "fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";
import { StorageError } from "../../util/Error";
import { ClusterMember } from "../../config/ClusterConfig";
import { ConfigStorage, ConfigStorageData } from "../interfaces/ConfigStorage";

const VERSION = 0x01;
const HEADER_SIZE = 9;

export class DiskConfigStorage implements ConfigStorage {
    private readonly filePath: string;
    private readonly tmpPath: string;
    private readonly dirPath: string;
    private isOpenFlag = false;

    constructor(dirPath: string) {
        this.dirPath = dirPath;
        this.filePath = path.join(dirPath, "config.bin");
        this.tmpPath = path.join(dirPath, "config.tmp");
    }

    async open(): Promise<void> {
        if (this.isOpenFlag) throw new StorageError("DiskConfigStorage is already open");
        await fs.mkdir(this.dirPath, { recursive: true });
        await this.recover();
        this.isOpenFlag = true;
    }

    async close(): Promise<void> {
        this.ensureOpen();
        this.isOpenFlag = false;
    }

    isOpen(): boolean {
        return this.isOpenFlag;
    }

    async read(): Promise<ConfigStorageData | null> {
        this.ensureOpen();

        const exists = await this.fileExists(this.filePath);
        if (!exists) return null;

        const buf = await fs.readFile(this.filePath);
        return this.decode(buf);
    }

    async write(voters: ClusterMember[], learners: ClusterMember[]): Promise<void> {
        this.ensureOpen();

        const buf = this.encode({ voters, learners });

        await fs.writeFile(this.tmpPath, buf);
        const fh = await fs.open(this.tmpPath, "r+");
        try {
            await fh.sync();
        } finally {
            await fh.close();
        }

        await fs.rename(this.tmpPath, this.filePath);
        await this.fsyncDir();
    }

    private encode(data: ConfigStorageData): Buffer {
        const json = Buffer.from(JSON.stringify(data), "utf-8");
        const buf = Buffer.allocUnsafe(HEADER_SIZE + json.length);

        buf.writeUInt8(VERSION, 0);
        buf.writeUInt32BE(json.length, 5);
        json.copy(buf, 9);

        const crcData = Buffer.concat([buf.subarray(0, 1), buf.subarray(5)]);
        buf.writeUInt32BE(crc32(crcData), 1);

        return buf;
    }

    private decode(buf: Buffer): ConfigStorageData {
        if (buf.length < HEADER_SIZE) {
            throw new StorageError(`config.bin too small: ${buf.length} bytes`);
        }

        const version = buf.readUInt8(0);
        if (version !== VERSION) {
            throw new StorageError(`Unsupported config.bin version: ${version}`);
        }

        const storedCrc = buf.readUInt32BE(1);
        const crcData = Buffer.concat([buf.subarray(0, 1), buf.subarray(5)]);
        const computedCrc = crc32(crcData);
        if (storedCrc !== computedCrc) {
            throw new StorageError(
                `config.bin CRC32 mismatch: stored=${storedCrc}, computed=${computedCrc}`
            );
        }

        const jsonLen = buf.readUInt32BE(5);
        if (buf.length < HEADER_SIZE + jsonLen) {
            throw new StorageError(`config.bin truncated: expected ${jsonLen} bytes of JSON`);
        }

        try {
            return JSON.parse(buf.subarray(HEADER_SIZE, HEADER_SIZE + jsonLen).toString("utf-8")) as ConfigStorageData;
        } catch (err) {
            throw new StorageError(`config.bin JSON parse error: ${(err as Error).message}`);
        }
    }

    private async recover(): Promise<void> {
        const tmpExists = await this.fileExists(this.tmpPath);
        const fileExists = await this.fileExists(this.filePath);

        if (tmpExists && fileExists) {
            await fs.unlink(this.tmpPath);
        } else if (tmpExists && !fileExists) {
            await fs.rename(this.tmpPath, this.filePath);
            await this.fsyncDir();
        }
    }

    private async fsyncDir(): Promise<void> {
        try {
            const fh = await fs.open(this.dirPath, "r");
            try { await fh.sync(); } finally { await fh.close(); }
        } catch {
            // skip
         }
    }

    private async fileExists(p: string): Promise<boolean> {
        try { await fs.access(p); return true; } catch { return false; }
    }

    private ensureOpen(): void {
        if (!this.isOpenFlag) throw new StorageError("DiskConfigStorage is not open");
    }
}