import { ClusterMember } from "../config/ClusterConfig";

export interface ConfigStorageData {
    voters: ClusterMember[];
    learners: ClusterMember[];
}

export interface ConfigStorage {
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): boolean;

    read(): Promise<ConfigStorageData | null>;

    write(voters: ClusterMember[], learners: ClusterMember[]): Promise<void>;
}
