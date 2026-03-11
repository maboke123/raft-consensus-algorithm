import { describe, it, expect } from "vitest";
import { StorageCodec } from "./Storage";
import { LogEntry, LogEntryType } from "../log/LogEntry";

describe('Storage.ts, StorageCodec', () => {
    it('should encode and decode numbers', () => {
        const number = 12345;
        const encoded = StorageCodec.encodeNumber(number);
        const decoded = StorageCodec.decodeNumber(encoded);
        expect(decoded).toBe(number);
    });

    it('should throw when encoding a non-safe integer', () => {
        const unsafeNumber = Number.MAX_SAFE_INTEGER + 1;
        expect(() => StorageCodec.encodeNumber(unsafeNumber)).toThrow("Number 9007199254740992 must be a safe integer");
    });

    it('should throw when decoding a buffer of incorrect length', () => {
        const invalidBuffer = Buffer.alloc(4);
        expect(() => StorageCodec.decodeNumber(invalidBuffer)).toThrow("Buffer length must be 8 bytes");
    });

    it('should throw when decoded number is not a safe integer', () => {
        const invalidBuffer = Buffer.alloc(8);
        invalidBuffer.writeBigInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), 0);
        expect(() => StorageCodec.decodeNumber(invalidBuffer)).toThrow("Decoded number 9007199254740992 is not a safe integer");
    });

    it('should encode and decode zero', () => {
        const number = 0;
        const encoded = StorageCodec.encodeNumber(number);
        const decoded = StorageCodec.decodeNumber(encoded);
        expect(decoded).toBe(number);
    });

    it('should encode and decode negative numbers', () => {
        const number = -12345;
        const encoded = StorageCodec.encodeNumber(number);
        const decoded = StorageCodec.decodeNumber(encoded);
        expect(decoded).toBe(number);
    });

    it('should encode and decode the maximum safe integer', () => {
        const number = Number.MAX_SAFE_INTEGER;
        const encoded = StorageCodec.encodeNumber(number);
        const decoded = StorageCodec.decodeNumber(encoded);
        expect(decoded).toBe(number);
    });

    it('should encode and decode the minimum safe integer', () => {
        const number = Number.MIN_SAFE_INTEGER;
        const encoded = StorageCodec.encodeNumber(number);
        const decoded = StorageCodec.decodeNumber(encoded);
        expect(decoded).toBe(number);
    });

    it('should throw when encoding a non-integer number', () => {
        const nonInteger = 3.14;
        expect(() => StorageCodec.encodeNumber(nonInteger)).toThrow("must be a safe integer");
    });

    it('should encode and decode a string', () => {
        const str = "Hello, World!";
        const buffer = StorageCodec.encodeString(str);
        const decodedStr = StorageCodec.decodeString(buffer);
        expect(decodedStr).toBe(str);
    });

    it('should throw when encoding a non-string value', () => {
        const nonString = 12345 as any;
        expect(() => StorageCodec.encodeString(nonString)).toThrow("Value must be a string, got number");
    });

    it('should encode and decode an empty string', () => {
        const str = "";
        const buffer = StorageCodec.encodeString(str);
        const decodedStr = StorageCodec.decodeString(buffer);
        expect(decodedStr).toBe(str);
    });

    it('should encode and decode a string with special characters', () => {
        const str = "Hello, 世界! 👋";
        const buffer = StorageCodec.encodeString(str);
        const decodedStr = StorageCodec.decodeString(buffer);
        expect(decodedStr).toBe(str);
    });

    it('should throw when decoding a non-buffer value', () => {
        const nonBuffer = "Not a buffer" as any;
        expect(() => StorageCodec.decodeString(nonBuffer)).toThrow("Value must be a Buffer, got string");
    });

    it('should encode and decode objects', () => {
        const obj = { name: "Alice", age: 30 };
        const buffer = StorageCodec.encodeJSON(obj);
        const decodedObj = StorageCodec.decodeJSON<typeof obj>(buffer);
        expect(decodedObj).toEqual(obj);
    });

    it('should encode and deccode an empty object', () => {
        const obj = {};
        const buffer = StorageCodec.encodeJSON(obj);
        const decodedObj = StorageCodec.decodeJSON<typeof obj>(buffer);
        expect(decodedObj).toEqual(obj);
    });

    it('should throw when encoding a non-serializable object', () => {
        const circularObj: any = {};
        circularObj.self = circularObj;
        expect(() => StorageCodec.encodeJSON(circularObj)).toThrow("Failed to encode JSON");
    });

    it('should throw when decoding invalid JSON', () => {
        const invalidBuffer = Buffer.from("Not a valid JSON", StorageCodec.encoding);
        expect(() => StorageCodec.decodeJSON(invalidBuffer)).toThrow("Failed to decode JSON");
    });

    it('should serialize a COMMAND log entry correctly', () => {
        const logEntry: LogEntry = {
            index: 1,
            term: 1,
            type: LogEntryType.COMMAND,
            command: { type: "set", payload: { key: "x", value: 42 } }
        };
        const serialized = StorageCodec.serializeLogEntry(logEntry) as any;
        expect(serialized.index).toBe(1);
        expect(serialized.term).toBe(1);
        expect(serialized.type).toBe(LogEntryType.COMMAND);
        expect(serialized.command.type).toBe("set");
        expect(Buffer.isBuffer(serialized.command.payload)).toBe(true);
    });

    it('should serialize a CONFIG entry correctly', () => {
        const logEntry: LogEntry = {
            index: 1,
            term: 1,
            type: LogEntryType.CONFIG,
            config: { voters: ['node1', 'node2'], learners: [] }
        };
        const serialized = StorageCodec.serializeLogEntry(logEntry) as any;
        expect(serialized.index).toBe(1);
        expect(serialized.term).toBe(1);
        expect(serialized.type).toBe(LogEntryType.CONFIG);
        expect(JSON.parse(serialized.config)).toEqual({ voters: ['node1', 'node2'], learners: [] });
    });

    it('should deserialize a COMMAND log entry correctly', () => {
        const logEntry: LogEntry = {
            index: 1,
            term: 1,
            type: LogEntryType.COMMAND,
            command: { type: "set", payload: { key: "x", value: 42 } }
        };
        const serialized = StorageCodec.serializeLogEntry(logEntry);
        const deserialized = StorageCodec.deserializeLogEntry(serialized);
        expect(deserialized).toEqual(logEntry);
    });

    it('should deserialize a CONFIG entry correctly', () => {
        const logEntry: LogEntry = {
            index: 1,
            term: 1,
            type: LogEntryType.CONFIG,
            config: { voters: ['node1', 'node2'], learners: [] }
        };
        const serialized = StorageCodec.serializeLogEntry(logEntry);
        const deserialized = StorageCodec.deserializeLogEntry(serialized);
        expect(deserialized).toEqual(logEntry);
    });

    it('should deserialize a CONFIG log entry with config as a string', () => {
        const raw = {
            term: 1,
            index: 1,
            type: LogEntryType.CONFIG,
            config: JSON.stringify({ voters: ['node1', 'node2'], learners: [] })
        };

        const deserialized = StorageCodec.deserializeLogEntry(raw);
        expect(deserialized).toEqual({
            term: 1,
            index: 1,
            type: LogEntryType.CONFIG,
            config: { voters: ['node1', 'node2'], learners: [] }
        });
    });

    it('should deserialize a CONFIG log entry with config as object', () => {
        const raw = {
            term: 1,
            index: 1,
            type: LogEntryType.CONFIG,
            config: { voters: ['node1', 'node2'], learners: [] }
        };
        const deserialized = StorageCodec.deserializeLogEntry(raw);
        expect(deserialized).toEqual({
            term: 1,
            index: 1,
            type: LogEntryType.CONFIG,
            config: { voters: ['node1', 'node2'], learners: [] }
        });
    });
});