import { LogEntry, LogEntryType } from "../log/LogEntry";
import { StorageError } from "../util/Error";

export interface StorageOperation {
    type: "set" | "delete";
    key: string;
    value?: Buffer;
}

export class StorageNumberUtil {
    static assertSafeInteger(value: number, field: string): void {
        if (!Number.isSafeInteger(value)) {
            throw new StorageError(`${field} must be a safe integer, got ${value}`);
        }
    }

    static bigIntToSafeNumber(value: bigint, field: string): number {
        const num = Number(value);
        if (!Number.isSafeInteger(num)) {
            throw new StorageError(`${field} is outside JS safe integer range: ${value.toString()}`);
        }
        return num;
    }
}

export class StorageCodec {

    static readonly encoding: BufferEncoding = "utf-8";

    static encodeNumber(num: number): Buffer {

        if (!Number.isSafeInteger(num)) {
            throw new StorageError(`Number ${num} must be a safe integer`);
        }

        const buffer = Buffer.alloc(8);
        buffer.writeBigInt64BE(BigInt(num), 0);

        return buffer;
    }

    static decodeNumber(buffer: Buffer): number {
        if (buffer.length !== 8) {
            throw new StorageError(`Buffer length must be 8 bytes to decode a number, got ${buffer.length}`);
        }

        const bigIntValue = buffer.readBigInt64BE(0);
        const num = Number(bigIntValue);

        if (!Number.isSafeInteger(num)) {
            throw new StorageError(`Decoded number ${num} is not a safe integer`);
        }

        return num;
    }

    static encodeString(str: string): Buffer {
        if (typeof str !== "string") {
            throw new StorageError(`Value must be a string, got ${typeof str}`);
        }
        return Buffer.from(str, StorageCodec.encoding);
    }

    static decodeString(buffer: Buffer): string {

        if (!Buffer.isBuffer(buffer)) {
            throw new StorageError(`Value must be a Buffer, got ${typeof buffer}`);
        }

        return buffer.toString(StorageCodec.encoding);
    }

    static encodeJSON(obj: any): Buffer {
        try {
            const jsonString = JSON.stringify(obj);
            return Buffer.from(jsonString, StorageCodec.encoding);
        } catch (error) {
            throw new StorageError(`Failed to encode JSON: ${(error as Error).message}`); // json.stringify can only throw syntax errors
        }
    }

    static decodeJSON<T>(buffer: Buffer): T {
        try {
            const bufStr = buffer.toString(StorageCodec.encoding);
            return JSON.parse(bufStr);
        } catch (error) {
            throw new StorageError(`Failed to decode JSON: ${(error as Error).message}`); // idem
        }
    }

    static serializeLogEntry(entry: LogEntry): object {
        if (entry.type === LogEntryType.CONFIG) {
            return {
                term: entry.term,
                index: entry.index,
                type: entry.type,
                config: JSON.stringify(entry.config)
            };
        }

        return {
            term: entry.term,
            index: entry.index,
            type: entry.type,
            command: {
                type: entry.command!.type,
                payload: Buffer.from(JSON.stringify(entry.command!.payload)),
            },
        };
    }

    static deserializeLogEntry(raw: any): LogEntry {
        if (raw.type === LogEntryType.CONFIG) {
            return {
                term: raw.term,
                index: raw.index,
                type: LogEntryType.CONFIG,
                config: typeof raw.config === "string" ? JSON.parse(raw.config) : raw.config
            };
        }

        return {
            term: raw.term,
            index: raw.index,
            type: LogEntryType.COMMAND,
            command: {
                type: raw.command.type,
                payload: JSON.parse(raw.command.payload.toString()),
            },
        };
    }
}