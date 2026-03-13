import fs from "fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";
import { NodeId } from "../../core/Config";
import { StorageError } from "../../util/Error";
import { StorageNumberUtil } from "../StorageUtil";
import { MetaData, MetaStorage } from "../interfaces/MetaStorage";

const VERSION = 0x01;
const FIXED_SIZE = 14;

export class DiskMetaStorage implements MetaStorage {
    private readonly filePath: string;
    private readonly tmpPath: string;
    private readonly dirPath: string;
    private isOpenFlag = false;

    constructor(dirPath: string) {
        this.dirPath = dirPath;
        this.filePath = path.join(dirPath, "term.bin");
        this.tmpPath = path.join(dirPath, "term.tmp");
    }

    async open(): Promise<void> {
        if (this.isOpenFlag) throw new StorageError("DiskMetaStorage is already open");
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

    async read(): Promise<MetaData | null> {
        this.ensureOpen();

        const exists = await this.fileExists(this.filePath);
        if (!exists) return null;

        const buf = await fs.readFile(this.filePath);
        return this.decode(buf);
    }

    async write(term: number, votedFor: NodeId | null): Promise<void> {
        this.ensureOpen();

        const buf = this.encode(term, votedFor);

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

    private encode(term: number, votedFor: NodeId | null): Buffer {
        StorageNumberUtil.assertSafeInteger(term, "term");

        const votedForBuf = votedFor !== null
            ? Buffer.from(votedFor, "utf-8")
            : null;

        const totalSize = FIXED_SIZE + (votedForBuf ? 2 + votedForBuf.length : 0);
        const buf = Buffer.allocUnsafe(totalSize);

        buf.writeUInt8(VERSION, 0);
        buf.writeBigInt64BE(BigInt(term), 5);
        buf.writeUInt8(votedFor !== null ? 1 : 0, 13);

        if (votedForBuf !== null) {
            buf.writeUInt16BE(votedForBuf.length, 14);
            votedForBuf.copy(buf, 16);
        }

        const crcData = Buffer.concat([buf.subarray(0, 1), buf.subarray(5)]);
        buf.writeUInt32BE(crc32(crcData), 1);

        return buf;
    }

    private decode(buf: Buffer): MetaData {
        if (buf.length < FIXED_SIZE) {
            throw new StorageError(`term.bin too small: ${buf.length} bytes`);
        }

        const version = buf.readUInt8(0);
        if (version !== VERSION) {
            throw new StorageError(`Unsupported term.bin version: ${version}`);
        }

        const storedCrc = buf.readUInt32BE(1);
        const crcData = Buffer.concat([buf.subarray(0, 1), buf.subarray(5)]);
        const computedCrc = crc32(crcData);
        if (storedCrc !== computedCrc) {
            throw new StorageError(
                `term.bin CRC32 mismatch: stored=${storedCrc}, computed=${computedCrc}`
            );
        }

        const term = StorageNumberUtil.bigIntToSafeNumber(buf.readBigInt64BE(5), "term");
        const hasVotedFor = buf.readUInt8(13);

        if (hasVotedFor === 0) {
            return { term, votedFor: null };
        }

        if (buf.length < FIXED_SIZE + 2) {
            throw new StorageError("term.bin truncated: missing votedForLen field");
        }

        const votedForLen = buf.readUInt16BE(14);

        if (buf.length < FIXED_SIZE + 2 + votedForLen) {
            throw new StorageError("term.bin truncated: missing votedFor data");
        }

        const votedFor = buf.subarray(16, 16 + votedForLen).toString("utf-8");
        return { term, votedFor };
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
        if (!this.isOpenFlag) throw new StorageError("DiskMetaStorage is not open");
    }
}