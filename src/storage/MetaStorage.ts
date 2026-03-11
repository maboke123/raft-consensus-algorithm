import { NodeId } from "../core/Config";

export interface MetaData {
    term: number;
    votedFor: NodeId | null;
}

export interface MetaStorage {
    open(): Promise<void>;
    close(): Promise<void>;
    isOpen(): boolean;

    read(): Promise<MetaData | null>;

    write(term: number, votedFor: NodeId | null): Promise<void>;
}
