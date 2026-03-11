import { describe, it, expect } from 'vitest';
import { ClusterConfig, clusterConfigsEqual, getQuorumSize, isLearner, isNodeInCluster, isVoter } from './ClusterConfig';

const config: ClusterConfig = {
    voters: [
        { id: 'node1', address: 'address1' },
        { id: 'node2', address: 'address2' },
        { id: 'node3', address: 'address3' }
    ],
    learners: [
        { id: 'node4', address: 'address4' },
        { id: 'node5', address: 'address5' }
    ]
};

describe('Clusterconfig.ts, clusterConfigsEqual', () => {
    it('should return true for equal configurations', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node1', address: 'address1' },
                { id: 'node2', address: 'address2' },
                { id: 'node3', address: 'address3' }
            ],
            learners: [
                { id: 'node4', address: 'address4' },
                { id: 'node5', address: 'address5' }
            ]
        };
        expect(clusterConfigsEqual(config, config2)).toBe(true);
    });

    it('should return false for different voter lists', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node1', address: 'address1' },
                { id: 'node2', address: 'address2' }
            ],
            learners: [
                { id: 'node4', address: 'address4' },
                { id: 'node5', address: 'address5' }
            ]
        };
        expect(clusterConfigsEqual(config, config2)).toBe(false);
    });

    it('should return false for different learner lists', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node1', address: 'address1' },
                { id: 'node2', address: 'address2' },
                { id: 'node3', address: 'address3' }
            ],
            learners: [
                { id: 'node4', address: 'address4' }
            ]
        };
        expect(clusterConfigsEqual(config, config2)).toBe(false);
    });

    it('should return true for same voters and learners in different order', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node3', address: 'address3' },
                { id: 'node2', address: 'address2' },
                { id: 'node1', address: 'address1' }
            ],
            learners: [
                { id: 'node5', address: 'address5' },
                { id: 'node4', address: 'address4' }
            ]
        };
        expect(clusterConfigsEqual(config, config2)).toBe(true);

        const config3: ClusterConfig = {
            voters: [
                { id: 'node2', address: 'address2' },
                { id: 'node1', address: 'address1' },
                { id: 'node3', address: 'address3' }
            ],
            learners: [
                { id: 'node5', address: 'address5' },
                { id: 'node4', address: 'address4' }
            ]
        };
        expect(clusterConfigsEqual(config, config3)).toBe(true);
    });

    it('should return false for different voters and learners', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node6', address: 'address6' },
                { id: 'node7', address: 'address7' },
                { id: 'node8', address: 'address8' }
            ],
            learners: [
                { id: 'node9', address: 'address9' },
                { id: 'node10', address: 'address10' }
            ]
        };
        expect(clusterConfigsEqual(config, config2)).toBe(false);
    });

    it('should return false for different number of voters', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node1', address: 'address1' },
                { id: 'node2', address: 'address2' },
                { id: 'node3', address: 'address3' },
                { id: 'node6', address: 'address6' }
            ],
            learners: [
                { id: 'node4', address: 'address4' },
                { id: 'node5', address: 'address5' }
            ]
        };
        expect(clusterConfigsEqual(config, config2)).toBe(false);
    });

    it('should return false for different number of learners', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node1', address: 'address1' },
                { id: 'node2', address: 'address2' },
                { id: 'node3', address: 'address3' }
            ],
            learners: [
                { id: 'node4', address: 'address4' },
                { id: 'node5', address: 'address5' },
                { id: 'node6', address: 'address6' }
            ]
        };
        expect(clusterConfigsEqual(config, config2)).toBe(false);
    });

    it('should return true for empty voters and learners', () => {
        const config2: ClusterConfig = {
            voters: [],
            learners: []
        };
        expect(clusterConfigsEqual({ voters: [], learners: [] }, config2)).toBe(true);
    });

    it('should return false when learner members differ but count is the same', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node1', address: 'address1' },
                { id: 'node2', address: 'address2' },
                { id: 'node3', address: 'address3' }
            ],
            learners: [
                { id: 'node4', address: 'address4' },
                { id: 'node6', address: 'address6' }
            ]
        };
        expect(clusterConfigsEqual(config, config2)).toBe(false);
    });
});

describe('Clusterconfig.ts, isVoter', () => {
    it('should return true for a voter node', () => {
        expect(isVoter(config, 'node1')).toBe(true);
    });

    it('should return false for a non-voter node', () => {
        expect(isVoter(config, 'node4')).toBe(false);
    });

    it('should return false for a node not in the cluster', () => {
        expect(isVoter(config, 'node6')).toBe(false);
    });
});

describe('Clusterconfig.ts, isLearner', () => {
    it('should return true for a learner node', () => {
        expect(isLearner(config, 'node4')).toBe(true);
    });

    it('should return false for a non-learner node', () => {
        expect(isLearner(config, 'node1')).toBe(false);
    });

    it('should return false for a node not in the cluster', () => {
        expect(isLearner(config, 'node6')).toBe(false);
    });
});

describe('Clusterconfig.ts, isNodeInCluster', () => {
    it('should return true for a voter node', () => {
        expect(isNodeInCluster(config, 'node1')).toBe(true);
    });

    it('should return true for a learner node', () => {
        expect(isNodeInCluster(config, 'node4')).toBe(true);
    });

    it('should return false for a node not in the cluster', () => {
        expect(isNodeInCluster(config, 'node6')).toBe(false);
    });
});

describe('Clusterconfig.ts, getQuorumSize', () => {
    it('should return the correct quorum size for an odd number of voters', () => {
        expect(getQuorumSize(config)).toBe(2);
    });

    it('should return the correct quorum size for an even number of voters', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node1', address: 'address1' },
                { id: 'node2', address: 'address2' },
                { id: 'node3', address: 'address3' },
                { id: 'node6', address: 'address6' }
            ],
            learners: [
                { id: 'node4', address: 'address4' },
                { id: 'node5', address: 'address5' }
            ]
        };
        expect(getQuorumSize(config2)).toBe(3);
    });

    it('should return 1 for a single voter', () => {
        const config2: ClusterConfig = {
            voters: [
                { id: 'node1', address: 'address1' }
            ],
            learners: [
                { id: 'node4', address: 'address4' },
                { id: 'node5', address: 'address5' }
            ]
        };
        expect(getQuorumSize(config2)).toBe(1);
    });

    it('should return 1 for no voters', () => {
        const config2: ClusterConfig = {
            voters: [],
            learners: [
                { id: 'node4', address: 'address4' },
                { id: 'node5', address: 'address5' }
            ]
        };
        expect(getQuorumSize(config2)).toBe(1);
    });
});

