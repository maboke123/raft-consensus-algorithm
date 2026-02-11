export type NodeId = string;

export interface RaftConfig {
    nodeId: NodeId;
    peerIds: NodeId[];
    electionTimeoutMinMs: number;
    electionTimeoutMaxMs: number;
    heartbeatIntervalMs: number;
}

export function validateConfig(config: RaftConfig): void {
    if(!config.nodeId || typeof config.nodeId !== 'string') {
        throw new Error(`Invalid nodeId: ${config.nodeId}. nodeId must be a non-empty string.`);
    }

    if(!Array.isArray(config.peerIds) || config.peerIds.some(peerId => typeof peerId !== 'string')) {
        throw new Error(`Invalid peerIds: ${config.peerIds}. peerIds must be an array of strings.`);
    }

    if (config.peerIds.includes(config.nodeId)) {
        throw new Error(`Invalid peerIds: ${config.peerIds}. peerIds cannot include the nodeId.`);
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

export function createConfig(nodeId: NodeId, peerIds: NodeId[], electionTimeoutMinMs: number, electionTimeoutMaxMs: number, heartbeatIntervalMs: number): RaftConfig {
    const config: RaftConfig = {
        nodeId,
        peerIds,
        electionTimeoutMinMs,
        electionTimeoutMaxMs,
        heartbeatIntervalMs
    };
    validateConfig(config);
    return config;
}