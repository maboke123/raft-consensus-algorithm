import { ClusterMember } from "../config/ClusterConfig";

export type NodeId = string;

export interface RaftConfig {
    nodeId: NodeId;
    address: string;
    peers: ClusterMember[];
    electionTimeoutMinMs: number;
    electionTimeoutMaxMs: number;
    heartbeatIntervalMs: number;
}

export function validateConfig(config: RaftConfig): void {
    if(!config.nodeId || typeof config.nodeId !== 'string') {
        throw new Error(`Invalid nodeId: ${config.nodeId}. nodeId must be a non-empty string.`);
    }

    if (!config.address || typeof config.address !== 'string') {
        throw new Error(`Invalid address: ${config.address}. address must be a non-empty string.`);
    }

    if (!Array.isArray(config.peers)) {
        throw new Error(`Invalid peers: ${config.peers}. peers must be an array of ClusterMember objects.`);
    }

    if (config.peers.some(peer => typeof peer.id !== 'string' || typeof peer.address !== 'string')) {
        throw new Error(`Invalid peers: peers must contain objects with string id and address.`);
    }

    if (config.peers.some(peer => peer.id === config.nodeId)) {
        throw new Error(`Invalid peers: peers cannot include the nodeId.`);
    }

    if (!Number.isInteger(config.electionTimeoutMinMs) || config.electionTimeoutMinMs <= 0) {
        throw new Error(`Invalid electionTimeoutMinMs: ${config.electionTimeoutMinMs}. electionTimeoutMinMs must be a positive integer.`);
    }

    if (!Number.isInteger(config.electionTimeoutMaxMs) || config.electionTimeoutMaxMs <= 0) {
        throw new Error(`Invalid electionTimeoutMaxMs: ${config.electionTimeoutMaxMs}. electionTimeoutMaxMs must be a positive integer.`);
    }

    if (config.electionTimeoutMinMs >= config.electionTimeoutMaxMs) {
        throw new Error(`Invalid election timeout range: min ${config.electionTimeoutMinMs} ms must be less than max ${config.electionTimeoutMaxMs} ms.`);
    }

    if (!Number.isInteger(config.heartbeatIntervalMs) || config.heartbeatIntervalMs <= 0) {
        throw new Error(`Invalid heartbeatIntervalMs: ${config.heartbeatIntervalMs}. heartbeatIntervalMs must be a positive integer.`);
    }

    if (config.electionTimeoutMinMs < config.heartbeatIntervalMs * 3) {
        throw new Error(`Invalid electionTimeoutMinMs: ${config.electionTimeoutMinMs}. electionTimeoutMinMs must be at least three times the heartbeatIntervalMs: ${config.heartbeatIntervalMs}.`);
    }
}

export function createConfig(nodeId: NodeId, address: string, peers: ClusterMember[], electionTimeoutMinMs: number, electionTimeoutMaxMs: number, heartbeatIntervalMs: number): RaftConfig {
    const config: RaftConfig = {
        nodeId,
        address,
        peers,
        electionTimeoutMinMs,
        electionTimeoutMaxMs,
        heartbeatIntervalMs
    };
    validateConfig(config);
    return config;
}