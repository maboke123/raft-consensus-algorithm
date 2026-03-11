import { ClusterConfig } from "../config/ClusterConfig";

export interface SnapshotMetaData {
    lastIncludedIndex: number;
    lastIncludedTerm: number;
}

export interface Snapshot extends SnapshotMetaData {
    data: Buffer;
    config: ClusterConfig;
}

export interface SnapshotStorage {
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): boolean;

    readMetadata(): Promise<SnapshotMetaData | null>;

    save(snapshot: Snapshot): Promise<void>;

    load(): Promise<Snapshot | null>;
}
