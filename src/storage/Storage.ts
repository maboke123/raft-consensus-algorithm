import { StorageError } from "../util/Error";

export interface StorageOperation {
    type: "set" | "delete";
    key: string;
    value?: Buffer;
}

export interface Storage {
    get(key: string): Promise<Buffer | null>;
    set(key: string, value: Buffer): Promise<void>;
    delete(key: string): Promise<void>;
    batch(operations: StorageOperation[]): Promise<void>;
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): boolean;
}

export class InMemoryStorage implements Storage {
    private data: Map<string, Buffer> = new Map();
    private isOpenFlag: boolean = false;

    async open(): Promise<void> {
        if (this.isOpenFlag) {
            throw new StorageError("Storage is already open");
        }
        this.isOpenFlag = true;
    }

    async close(): Promise<void> {
        this.ensureOpen();
        this.isOpenFlag = false;
    }

    private ensureOpen() {
        if (!this.isOpenFlag) {
            throw new StorageError("Storage is not open");
        }
    }

    isOpen(): boolean {
        return this.isOpenFlag;
    }

    async get(key: string): Promise<Buffer | null> {
        this.ensureOpen();
        return this.data.get(key) || null;
    }

    async set(key: string, value: Buffer): Promise<void> {
        this.ensureOpen();
        this.data.set(key, Buffer.from(value));
    }

    async delete(key: string): Promise<void> {
        this.ensureOpen();
        this.data.delete(key);
    }

    async batch(operations: StorageOperation[]): Promise<void> {
        this.ensureOpen();

        for (const operation of operations) {
            if (operation.type === "set" && !operation.value) {
                throw new StorageError("Value is required for set operation");
            }
        }

        const tempData = new Map(this.data);

        try {
            for (const operation of operations) {
                if (operation.type === "set") {
                    tempData.set(operation.key, Buffer.from(operation.value!));
                } else if (operation.type === "delete") {
                    tempData.delete(operation.key);
                } else {
                    throw new StorageError(`Invalid operation type: ${operation.type}`);
                }
            }

            this.data = tempData;
        } catch (error) {
            throw new StorageError(`Batch operation failed: ${error instanceof Error ? error.message : String(error)}`);
        };
    }

    keys(): string[] {
        this.ensureOpen();
        return Array.from(this.data.keys());
    }

    values(): Buffer[] {
        this.ensureOpen();
        return Array.from(this.data.values());
    }

    entries(): [string, Buffer][] {
        this.ensureOpen();
        return Array.from(this.data.entries());
    }

    clear(): void {
        this.ensureOpen();
        this.data.clear();
    }

    size(): number {
        this.ensureOpen();
        return this.data.size;
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
        return buffer.toString(StorageCodec.encoding);
    }

    static encodeJSON(obj: any): Buffer {
        try {
            const jsonString = JSON.stringify(obj);
            return Buffer.from(jsonString, StorageCodec.encoding);
        } catch (error) {
            throw new StorageError(`Failed to encode JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    static decodeJSON<T>(buffer: Buffer): T {
        try {
            const bufStr = buffer.toString(StorageCodec.encoding);
            return JSON.parse(bufStr);
        } catch (error) {
            throw new StorageError(`Failed to decode JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
