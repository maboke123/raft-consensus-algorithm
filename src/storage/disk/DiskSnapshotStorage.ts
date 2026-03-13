import fs from "fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";
import { StorageError } from "../../util/Error";
import { StorageNumberUtil } from "../StorageUtil";
import { Snapshot, SnapshotMetaData, SnapshotStorage } from "../interfaces/SnapshotStorage";

const VERSION = 0x01;
const FIXED_HEADER_SIZE = 25;

export class DiskSnapshotStorage implements SnapshotStorage {
    private readonly filePath: string;
    private readonly tmpPath: string;
    private readonly dirPath: string;
    private isOpenFlag = false;

    constructor(dirPath: string) {
        this.dirPath = dirPath;
        this.filePath = path.join(dirPath, "snapshot.bin");
        this.tmpPath = path.join(dirPath, "snapshot.tmp");
    }

    async open(): Promise<void> {
        if (this.isOpenFlag) throw new StorageError("DiskSnapshotStorage is already open");
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

    async readMetadata(): Promise<SnapshotMetaData | null> {
        this.ensureOpen();

        const snapshot = await this.load();
        if (!snapshot) return null;

        return {
            lastIncludedIndex: snapshot.lastIncludedIndex,
            lastIncludedTerm: snapshot.lastIncludedTerm,
        };
    }

    async save(snapshot: Snapshot): Promise<void> {
        this.ensureOpen();

        const buf = this.encode(snapshot);

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

    async load(): Promise<Snapshot | null> {
        this.ensureOpen();

        const exists = await this.fileExists(this.filePath);
        if (!exists) return null;

        const buf = await fs.readFile(this.filePath);
        return this.decode(buf);
    }

    private encode(snapshot: Snapshot): Buffer {
        StorageNumberUtil.assertSafeInteger(snapshot.lastIncludedIndex, "snapshot.lastIncludedIndex");
        StorageNumberUtil.assertSafeInteger(snapshot.lastIncludedTerm, "snapshot.lastIncludedTerm");

        const configBuf = Buffer.from(JSON.stringify(snapshot.config), "utf-8");

        const totalSize = 1 + 4 + 8 + 8 + 4 + configBuf.length + 4 + snapshot.data.length;
        const buf = Buffer.allocUnsafe(totalSize);

        let pos = 0;
        buf.writeUInt8(VERSION, pos); pos += 1;
        pos += 4;
        buf.writeBigInt64BE(BigInt(snapshot.lastIncludedIndex), pos); pos += 8;
        buf.writeBigInt64BE(BigInt(snapshot.lastIncludedTerm), pos); pos += 8;
        buf.writeUInt32BE(configBuf.length, pos); pos += 4;
        configBuf.copy(buf, pos); pos += configBuf.length;
        buf.writeUInt32BE(snapshot.data.length, pos); pos += 4;
        snapshot.data.copy(buf, pos);

        const crcData = Buffer.concat([buf.subarray(0, 1), buf.subarray(5)]);
        buf.writeUInt32BE(crc32(crcData), 1);

        return buf;
    }

    private decode(buf: Buffer): Snapshot {
        if (buf.length < FIXED_HEADER_SIZE) {
            throw new StorageError(`snapshot.bin too small: ${buf.length} bytes`);
        }

        const version = buf.readUInt8(0);
        if (version !== VERSION) {
            throw new StorageError(`Unsupported snapshot.bin version: ${version}`);
        }

        const storedCrc = buf.readUInt32BE(1);
        const crcData = Buffer.concat([buf.subarray(0, 1), buf.subarray(5)]);
        const computedCrc = crc32(crcData);
        if (storedCrc !== computedCrc) {
            throw new StorageError(
                `snapshot.bin CRC32 mismatch: stored=${storedCrc}, computed=${computedCrc}`
            );
        }

        let pos = 5;
        const lastIncludedIndex = StorageNumberUtil.bigIntToSafeNumber(buf.readBigInt64BE(pos), "snapshot lastIncludedIndex"); pos += 8;
        const lastIncludedTerm = StorageNumberUtil.bigIntToSafeNumber(buf.readBigInt64BE(pos), "snapshot lastIncludedTerm"); pos += 8;
        const configLen = buf.readUInt32BE(pos); pos += 4;

        if (buf.length < pos + configLen + 4) {
            throw new StorageError("snapshot.bin truncated in config section");
        }

        let config: Snapshot["config"];
        try {
            config = JSON.parse(buf.subarray(pos, pos + configLen).toString("utf-8"));
        } catch (err) {
            throw new StorageError(`snapshot.bin config JSON error: ${(err as Error).message}`);
        }
        pos += configLen;

        const dataLen = buf.readUInt32BE(pos); pos += 4;
        if (buf.length < pos + dataLen) {
            throw new StorageError("snapshot.bin truncated in data section");
        }

        const data = Buffer.from(buf.subarray(pos, pos + dataLen));

        return { lastIncludedIndex, lastIncludedTerm, data, config };
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
        if (!this.isOpenFlag) throw new StorageError("DiskSnapshotStorage is not open");
    }
}