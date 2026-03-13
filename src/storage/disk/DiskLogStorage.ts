import fs from "fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";
import { AsyncLock } from "../../lock/AsyncLock";
import { StorageError } from "../../util/Error";
import { LogEntry, LogEntryType } from "../../log/LogEntry";
import { StorageNumberUtil } from "../StorageUtil";
import { LogStorage, LogStorageMeta } from "../interfaces/LogStorage";

const WAL_MAGIC = Buffer.from("RWAL");
const WAL_VERSION = 0x01;
const WAL_HEADER_SIZE = 21;
const RECORD_HEADER_SIZE = 25;

export class DiskLogStorage implements LogStorage {
    private readonly walPath: string;
    private readonly tmpWalPath: string;
    private readonly dirPath: string;

    private snapshotIndex = 0;
    private snapshotTerm = 0;
    private lastIndex = 0;
    private lastTerm = 0;

    private offsetIndex: Map<number, { offset: number; size: number }> = new Map();
    private readonly lock = new AsyncLock();

    private isOpenFlag = false;

    constructor(dirPath: string) {
        this.dirPath = dirPath;
        this.walPath = path.join(dirPath, "wal.bin");
        this.tmpWalPath = path.join(dirPath, "wal.tmp");
    }

    async open(): Promise<void> {
        if (this.isOpenFlag) throw new StorageError("DiskLogStorage is already open");
        await fs.mkdir(this.dirPath, { recursive: true });
        await this.recover();
        await this.loadAndScan();
        this.isOpenFlag = true;
    }

    async close(): Promise<void> {
        this.ensureOpen();
        this.isOpenFlag = false;
        this.offsetIndex.clear();
    }

    isOpen(): boolean {
        return this.isOpenFlag;
    }

    async readMeta(): Promise<LogStorageMeta> {
        this.ensureOpen();
        return {
            snapshotIndex: this.snapshotIndex,
            snapshotTerm: this.snapshotTerm,
            lastIndex: this.lastIndex,
            lastTerm: this.lastTerm,
        };
    }

    async append(entries: LogEntry[]): Promise<void> {
        this.ensureOpen();
        if (entries.length === 0) return;

        await this.lock.runExclusive(async () => {
            const records = entries.map(e => this.serializeRecord(e));
            const combined = Buffer.concat(records);

            let walSize = 0;
            try {
                const stat = await fs.stat(this.walPath);
                walSize = stat.size;
            } catch {
                walSize = 0;
            }

            if (walSize === 0) {
                const header = this.buildHeader(this.snapshotIndex, this.snapshotTerm);
                const full = Buffer.concat([header, combined]);
                await fs.writeFile(this.walPath, full);
                const fh = await fs.open(this.walPath, "r+");
                try { await fh.sync(); } finally { await fh.close(); }
                walSize = WAL_HEADER_SIZE;
            } else {
                const fh = await fs.open(this.walPath, "a");
                try {
                    await fh.write(combined);
                    await fh.sync();
                } finally {
                    await fh.close();
                }
            }

            let offset = walSize;
            for (let i = 0; i < entries.length; i++) {
                this.offsetIndex.set(entries[i].index, { offset, size: records[i].length });
                offset += records[i].length;
            }

            const last = entries[entries.length - 1];
            this.lastIndex = last.index;
            this.lastTerm = last.term;
        });
    }

    async getEntry(index: number): Promise<LogEntry | null> {
        this.ensureOpen();

        const slot = this.offsetIndex.get(index);
        if (!slot) return null;

        return this.readRecord(slot.offset);
    }

    async getEntries(from: number, to: number): Promise<LogEntry[]> {
        this.ensureOpen();
        const result: LogEntry[] = [];
        for (let i = from; i <= to; i++) {
            const entry = await this.getEntry(i);
            if (!entry) throw new StorageError(`Missing log entry at index ${i}`);
            result.push(entry);
        }
        return result;
    }

    async truncateFrom(index: number): Promise<void> {
        this.ensureOpen();

        await this.lock.runExclusive(async () => {
            const slot = this.offsetIndex.get(index);
            if (!slot) throw new StorageError(`Cannot truncate: index ${index} not in WAL`);

            const fh = await fs.open(this.walPath, "r+");
            try {
                await fh.truncate(slot.offset);
                await fh.sync();
            } finally {
                await fh.close();
            }

            for (let i = index; i <= this.lastIndex; i++) {
                this.offsetIndex.delete(i);
            }

            const newLastIndex = index - 1;
            if (newLastIndex <= this.snapshotIndex) {
                this.lastIndex = this.snapshotIndex;
                this.lastTerm = this.snapshotTerm;
            } else {
                this.lastIndex = newLastIndex;
                const prev = await this.getEntry(newLastIndex);
                this.lastTerm = prev ? prev.term : 0;
            }
        });
    }

    async compact(upToIndex: number, term: number): Promise<void> {
        this.ensureOpen();

        await this.lock.runExclusive(async () => {
            this.snapshotIndex = upToIndex;
            this.snapshotTerm = term;

            const entriesToKeep: LogEntry[] = [];
            for (let i = upToIndex + 1; i <= this.lastIndex; i++) {
                const entry = await this.getEntry(i);
                if (entry) entriesToKeep.push(entry);
            }

            const header = this.buildHeader(this.snapshotIndex, this.snapshotTerm);
            const records = entriesToKeep.map(e => this.serializeRecord(e));
            const combined = records.length > 0
                ? Buffer.concat([header, ...records])
                : header;

            await fs.writeFile(this.tmpWalPath, combined);
            const fh = await fs.open(this.tmpWalPath, "r+");
            try { await fh.sync(); } finally { await fh.close(); }

            await fs.rename(this.tmpWalPath, this.walPath);
            await this.fsyncDir();

            this.offsetIndex.clear();
            let offset = WAL_HEADER_SIZE;
            for (let i = 0; i < entriesToKeep.length; i++) {
                this.offsetIndex.set(entriesToKeep[i].index, { offset, size: records[i].length });
                offset += records[i].length;
            }
        });
    }

    async reset(snapshotIndex: number, snapshotTerm: number): Promise<void> {
        this.ensureOpen();

        await this.lock.runExclusive(async () => {
            const header = this.buildHeader(snapshotIndex, snapshotTerm);
            await fs.writeFile(this.tmpWalPath, header);
            const fh = await fs.open(this.tmpWalPath, "r+");
            try { await fh.sync(); } finally { await fh.close(); }

            await fs.rename(this.tmpWalPath, this.walPath);
            await this.fsyncDir();

            this.offsetIndex.clear();
            this.snapshotIndex = snapshotIndex;
            this.snapshotTerm = snapshotTerm;
            this.lastIndex = snapshotIndex;
            this.lastTerm = snapshotTerm;
        });
    }

    private buildHeader(snapshotIndex: number, snapshotTerm: number): Buffer {
        StorageNumberUtil.assertSafeInteger(snapshotIndex, "snapshotIndex");
        StorageNumberUtil.assertSafeInteger(snapshotTerm, "snapshotTerm");

        const buf = Buffer.allocUnsafe(WAL_HEADER_SIZE);
        WAL_MAGIC.copy(buf, 0);
        buf.writeUInt8(WAL_VERSION, 4);
        buf.writeBigInt64BE(BigInt(snapshotIndex), 5);
        buf.writeBigInt64BE(BigInt(snapshotTerm), 13);
        return buf;
    }

    private parseHeader(buf: Buffer): { snapshotIndex: number; snapshotTerm: number } {
        if (buf.length < WAL_HEADER_SIZE) {
            throw new StorageError(`wal.bin too small: ${buf.length} bytes`);
        }

        if (!buf.subarray(0, 4).equals(WAL_MAGIC)) {
            throw new StorageError("wal.bin invalid magic bytes");
        }

        const version = buf.readUInt8(4);
        if (version !== WAL_VERSION) {
            throw new StorageError(`Unsupported wal.bin version: ${version}`);
        }

        return {
            snapshotIndex: StorageNumberUtil.bigIntToSafeNumber(buf.readBigInt64BE(5), "wal snapshotIndex"),
            snapshotTerm: StorageNumberUtil.bigIntToSafeNumber(buf.readBigInt64BE(13), "wal snapshotTerm"),
        };
    }

    private serializeRecord(entry: LogEntry): Buffer {
        StorageNumberUtil.assertSafeInteger(entry.index, "entry.index");
        StorageNumberUtil.assertSafeInteger(entry.term, "entry.term");

        const payload = Buffer.from(JSON.stringify(entry), "utf-8");

        const crcData = Buffer.allocUnsafe(21 + payload.length);
        crcData.writeUInt32BE(payload.length, 0);
        crcData.writeBigInt64BE(BigInt(entry.index), 4);
        crcData.writeBigInt64BE(BigInt(entry.term), 12);
        crcData.writeUInt8(entry.type === LogEntryType.CONFIG ? 1 : 0, 20);
        payload.copy(crcData, 21);

        const checksum = crc32(crcData);

        const record = Buffer.allocUnsafe(4 + crcData.length);
        record.writeUInt32BE(checksum, 0);
        crcData.copy(record, 4);

        return record;
    }

    private async readRecord(offset: number): Promise<LogEntry> {
        const fh = await fs.open(this.walPath, "r");
        try {
            const prefix = Buffer.allocUnsafe(8);
            const { bytesRead: pr } = await fh.read(prefix, 0, 8, offset);
            if (pr < 8) throw new StorageError(`Truncated record at offset ${offset}`);

            const storedCrc = prefix.readUInt32BE(0);
            const payloadLen = prefix.readUInt32BE(4);

            const rest = Buffer.allocUnsafe(17 + payloadLen);
            const { bytesRead: rr } = await fh.read(rest, 0, rest.length, offset + 8);
            if (rr < rest.length) throw new StorageError(`Truncated record at offset ${offset}`);

            const crcData = Buffer.concat([prefix.subarray(4), rest]);
            const computedCrc = crc32(crcData);
            if (storedCrc !== computedCrc) {
                throw new StorageError(
                    `WAL CRC32 mismatch at offset ${offset}: stored=${storedCrc}, computed=${computedCrc}`
                );
            }

            const payload = rest.subarray(17);
            return JSON.parse(payload.toString("utf-8")) as LogEntry;
        } finally {
            await fh.close();
        }
    }

    private async loadAndScan(): Promise<void> {
        const exists = await this.fileExists(this.walPath);
        if (!exists) {
            this.snapshotIndex = 0;
            this.snapshotTerm = 0;
            this.lastIndex = 0;
            this.lastTerm = 0;
            return;
        }

        const fh = await fs.open(this.walPath, "r");
        let truncateAt: number | null = null;

        try {
            const headerBuf = Buffer.allocUnsafe(WAL_HEADER_SIZE);
            const { bytesRead: hr } = await fh.read(headerBuf, 0, WAL_HEADER_SIZE, 0);
            if (hr < WAL_HEADER_SIZE) {
                throw new StorageError(`wal.bin too small to contain header: ${hr} bytes`);
            }

            const { snapshotIndex, snapshotTerm } = this.parseHeader(headerBuf);
            this.snapshotIndex = snapshotIndex;
            this.snapshotTerm = snapshotTerm;
            this.lastIndex = snapshotIndex;
            this.lastTerm = snapshotTerm;

            let offset = WAL_HEADER_SIZE;

            while (true) {
                const prefix = Buffer.allocUnsafe(8);
                const { bytesRead: pr } = await fh.read(prefix, 0, 8, offset);
                if (pr === 0) break;
                if (pr < 8) { truncateAt = offset; break; }

                const storedCrc = prefix.readUInt32BE(0);
                const payloadLen = prefix.readUInt32BE(4);

                const restLen = 17 + payloadLen;
                const rest = Buffer.allocUnsafe(restLen);
                const { bytesRead: rr } = await fh.read(rest, 0, restLen, offset + 8);
                if (rr < restLen) { truncateAt = offset; break; }

                const crcData = Buffer.concat([prefix.subarray(4), rest]);
                if (crc32(crcData) !== storedCrc) { truncateAt = offset; break; }

                const index = StorageNumberUtil.bigIntToSafeNumber(rest.readBigInt64BE(0), `wal entry index at offset ${offset}`);
                const term = StorageNumberUtil.bigIntToSafeNumber(rest.readBigInt64BE(8), `wal entry term at offset ${offset}`);

                const recordSize = 8 + restLen;

                if (index > this.snapshotIndex) {
                    this.offsetIndex.set(index, { offset, size: recordSize });
                    this.lastIndex = index;
                    this.lastTerm = term;
                }

                offset += recordSize;
            }
        } finally {
            await fh.close();
        }

        if (truncateAt !== null) {
            const wh = await fs.open(this.walPath, "r+");
            try {
                await wh.truncate(truncateAt);
                await wh.sync();
            } finally {
                await wh.close();
            }
        }
    }

    private async recover(): Promise<void> {
        const tmpExists = await this.fileExists(this.tmpWalPath);
        const walExists = await this.fileExists(this.walPath);

        if (tmpExists && walExists) {
            await fs.unlink(this.tmpWalPath);
        } else if (tmpExists && !walExists) {
            await fs.rename(this.tmpWalPath, this.walPath);
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
        if (!this.isOpenFlag) throw new StorageError("DiskLogStorage is not open");
    }
}