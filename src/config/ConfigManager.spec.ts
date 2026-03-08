import { describe, it, expect, beforeEach } from 'vitest';
import { ClusterConfig } from './ClusterConfig';
import { ConfigManager, CONFIG_VOTERS_KEY, CONFIG_LEARNERS_KEY } from './ConfigManager';
import { InMemoryStorage } from '../storage/InMemoryStorage';
import { StorageError } from '../util/Error';
import { config } from 'node:process';

describe('ConfigManager.ts, ConfigManager', () => {
    const nodeId1 = 'node1';
    const peers = ['node2', 'node3'];
    const allVoters = [nodeId1, ...peers];

    const initialConfig: ClusterConfig = {
        voters: allVoters,
        learners: []
    };

    let storage: InMemoryStorage;
    let configManager: ConfigManager;

    beforeEach(async () => {
        storage = new InMemoryStorage();
        await storage.open();
        configManager = new ConfigManager(storage, initialConfig);
        await configManager.initialize();
    });

    it('should return null when no persisted config exists', async () => {
        const fresh = new ConfigManager(storage, initialConfig);
        const result = await fresh.initialize();
        expect(result).toBeNull();
    });

    it('should return persisted config on initialization', async () => {
        await configManager.commitConfig({ voters: ['node1', 'node2'], learners: ['node3'] });

        const fresh = new ConfigManager(storage, initialConfig);
        const result = await fresh.initialize();
        expect(result).toEqual({ voters: ['node1', 'node2'], learners: ['node3'] });
    });

    it('should restore activeConfig from storage', async () => {
        const savedConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node3'] };
        await configManager.commitConfig(savedConfig);

        const fresh = new ConfigManager(storage, initialConfig);
        await fresh.initialize();
        expect(fresh.getActiveConfig()).toEqual(savedConfig);
    });

    it('should restore committedConfig from storage', async () => {
        const savedConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node3'] };
        await configManager.commitConfig(savedConfig);

        const fresh = new ConfigManager(storage, initialConfig);
        await fresh.initialize();
        expect(fresh.getCommittedConfig()).toEqual(savedConfig);
    });

    it('should return existing commitedConfig if already initialized', async () => {
        const result = await configManager.initialize();
        expect(result).toEqual(initialConfig);
    });

    it('should return null if only voters key exists but not leadders', async () => {
        const storageWithOnlyVoters = new InMemoryStorage();
        await storageWithOnlyVoters.open();
        await storageWithOnlyVoters.set(CONFIG_VOTERS_KEY, Buffer.from(JSON.stringify(allVoters)));

        const fresh = new ConfigManager(storageWithOnlyVoters, initialConfig);
        const result = await fresh.initialize();
        expect(result).toBeNull();
    });

    it('should update activeConfig', () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        configManager.applyConfigEntry(newConfig);
        expect(configManager.getActiveConfig()).toEqual(newConfig);
    });

    it('should not update commitedConfig', () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        configManager.applyConfigEntry(newConfig);
        expect(configManager.getCommittedConfig()).toEqual(initialConfig);
    });

    it('should throw if not initialized when applying config entry', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.applyConfigEntry(initialConfig)).toThrow(StorageError);
    });

    it('should update commitedConfig on commit', async () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        await configManager.commitConfig(newConfig);
        expect(configManager.getCommittedConfig()).toEqual(newConfig);
    });

    it('should persist config on commit', async () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        await configManager.commitConfig(newConfig);

        const fresh = new ConfigManager(storage, initialConfig);
        const result = await fresh.initialize();
        expect(result).toEqual(newConfig);
    });

    it('should throw if not initialized when committing config', async () => {
        const fresh = new ConfigManager(storage, initialConfig);
        await expect(fresh.commitConfig(initialConfig)).rejects.toThrow(StorageError);
    });

    it('should return the initial config if initialize is called before any commit', async () => {
        expect(configManager.getActiveConfig()).toEqual(initialConfig);
    });

    it('should throw if not initialized when getting active config', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.getActiveConfig()).toThrow(StorageError);
    });

    it('should throw if not initialized when getting committed config', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.getCommittedConfig()).toThrow(StorageError);
    });

    it('should return voters from active config', () => {
        expect(configManager.getVoters()).toEqual(allVoters);
    });

    it('should reflect changes after applying new config entry', () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        configManager.applyConfigEntry(newConfig);
        expect(configManager.getVoters()).toEqual(['node1', 'node2']);
    });

    it('should throw if not initialized when getting voters', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.getVoters()).toThrow(StorageError);
    });

    it('should return empty learners initially', () => {
        expect(configManager.getLearners()).toEqual([]);
    });

    it('should reflect changes after applying new config entry', () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        configManager.applyConfigEntry(newConfig);
        expect(configManager.getLearners()).toEqual(['node4']);
    });

    it('should throw if not initialized when getting learners', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.getLearners()).toThrow(StorageError);
    });

    it('should return all nodes except selfId', () => {
        const selfId = 'node1';
        expect(configManager.getAllPeers(selfId)).toEqual(['node2', 'node3']);
    });

    it('should include learners in peer list', () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        configManager.applyConfigEntry(newConfig);
        const selfId = 'node1';
        expect(configManager.getAllPeers(selfId)).toEqual(['node2', 'node4']);
    });

    it('should not include selfId in peer list', () => {
        const selfId = 'node1';
        expect(configManager.getAllPeers(selfId)).not.toContain(selfId);
    });

    it('should throw if not initialized when getting all peers', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.getAllPeers('node1')).toThrow(StorageError);
    });

    it('should return correct quorum size', () => {
        expect(configManager.getQuorumSize()).toBe(2);
    });

    it('should reflect changes in quorum size after applying new config entry', () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2', 'node3', 'node4', 'node5'], learners: ['node6'] };
        configManager.applyConfigEntry(newConfig);
        expect(configManager.getQuorumSize()).toBe(3);
    });

    it('should throw if not initialized when getting quorum size', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.getQuorumSize()).toThrow(StorageError);
    });

    it('should return true for a voter node', () => {
        expect(configManager.isVoter('node1')).toBe(true);
    });

    it('should return false for a non-voter node', () => {
        expect(configManager.isVoter('node4')).toBe(false);
    });

    it('should throw if not initialized when checking if node is voter', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.isVoter('node1')).toThrow(StorageError);
    });

    it('should return true for a learner node', () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        configManager.applyConfigEntry(newConfig);
        expect(configManager.isLearner('node4')).toBe(true);
    });

    it('should return false for a non-learner node', () => {
        expect(configManager.isLearner('node1')).toBe(false);
    });

    it('should throw if not initialized when checking if node is learner', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.isLearner('node4')).toThrow(StorageError);
    });

    it('should return false when active and committed configs are the same', () => {
        expect(configManager.hasPendingChange()).toBe(false);
    });

    it('should return true when active and committed configs differ', () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        configManager.applyConfigEntry(newConfig);
        expect(configManager.hasPendingChange()).toBe(true);
    });

    it('should return false after committing a new config', async () => {
        const newConfig: ClusterConfig = { voters: ['node1', 'node2'], learners: ['node4'] };
        configManager.applyConfigEntry(newConfig);
        await configManager.commitConfig(newConfig);
        expect(configManager.hasPendingChange()).toBe(false);
    });

    it('should throw if not initialized when checking for pending changes', () => {
        const fresh = new ConfigManager(storage, initialConfig);
        expect(() => fresh.hasPendingChange()).toThrow(StorageError);
    });
});