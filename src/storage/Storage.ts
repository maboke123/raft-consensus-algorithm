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
