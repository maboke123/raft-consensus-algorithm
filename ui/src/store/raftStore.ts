import type { ClientCommand, ClusterConfig, MessageArrow, NodeUIState, RaftEvent } from "../types/raftTypes";
import { create } from 'zustand'

interface RaftStore {
    nodeIds: string[];
    events: RaftEvent[];
    nodes: Record<string, NodeUIState>;
    arrows: MessageArrow[];
    selectedNodeId?: string | null;
    dropRateByNode: Record<string, number>;
    cutLinks: Set<string>;
    connected: boolean;
    totalEventCount: number;
    messageVisibility: Record<string, boolean>;
    snapshottingNodes: Set<string>;
    installingSnapshotNodes: Set<string>;
    clusterConfig: ClusterConfig;
    pendingConfigChange: boolean;
    toggleMessageVisibility: (messageType: string) => void;
    setNodeIds: (ids: string[], config?: ClusterConfig) => void;
    pushEvent: (event: RaftEvent) => void;
    processEvent: (event: RaftEvent) => void;
    selectNode: (nodeId: string | null) => void;
    sendCommand: (cmd: ClientCommand) => void;
    setDropRate: (nodeId: string, dropRate: number) => void;
    isLinkCut: (nodeA: string, nodeB: string) => boolean;
    cutLink: (nodeA: string, nodeB: string) => void;
    healLink: (nodeA: string, nodeB: string) => void;
    healAllLinks: () => void;
    setConnected: (connected: boolean) => void;
    addServer: (nodeId: string, address: string, asLearner: boolean) => void;
    removeServer: (nodeId: string) => void;
    promoteLearner: (nodeId: string) => void;
    reset: () => void;
}

const wsRef = { current: null as WebSocket | null };
export const setStoreWebSocket = (ws: WebSocket | null ) => { wsRef.current = ws; };

const makeNode = (nodeId: string, isLearner: boolean, address = ''): NodeUIState => ({
    nodeId,
    address,
    role: "Follower",
    term: 0,
    commitIndex: 0,
    votedFor: null,
    crashed: false,
    logEntries: [],
    snapshotIndex: 0,
    isLearner: isLearner,
})

const defaultConfig: ClusterConfig = {
    voters: [],
    learners: [],
}

function applyConfig(nodes: Record<string, NodeUIState>, config: ClusterConfig): Record<string, NodeUIState> {
    const newNodes = { ...nodes };
    for (const nodeId of Object.keys(newNodes)) {
        const isLearner = config.learners.some(m => m.id === nodeId);
        const member = [...config.voters, ...config.learners].find(m => m.id === nodeId);
        const address = member?.address ?? newNodes[nodeId].address;
        newNodes[nodeId] = { ...newNodes[nodeId], isLearner, address };
    }
    return newNodes;
}

export const useRaftStore = create<RaftStore>((set, get) => ({
    nodeIds: [],
    events: [],
    nodes: {},
    arrows: [],
    selectedNodeId: null,
    dropRateByNode: {},
    cutLinks: new Set(),
    connected: false,
    totalEventCount: 0,
    messageVisibility: {
        RequestVote: true,
        AppendEntries: true,
        Heartbeat: true,
        Dropped: true,
        InstallSnapshot: true,
    },
    snapshottingNodes: new Set<string>(),
    installingSnapshotNodes: new Set<string>(),
    clusterConfig: defaultConfig,
    pendingConfigChange: false,

    setNodeIds: (ids, config) => {
        const configToApply = config ?? { voters: ids.map(id => ({ id, address: '' })), learners: [] };
        const nodes: Record<string, NodeUIState> = {};
        for (const id of ids) {
            const member = [...configToApply.voters, ...configToApply.learners].find(m => m.id === id);
            nodes[id] = makeNode(id, configToApply.learners.some(m => m.id === id), member?.address ?? '');
        }
        set({ nodeIds: ids, nodes, clusterConfig: configToApply, pendingConfigChange: false });
    },
    pushEvent: (event) => set(
        (state) => ({ events: [event, ...state.events]
            .slice(0, 100), totalEventCount: state.totalEventCount + 1 })
        ),
    processEvent: (event) => {
        switch (event.type) {
            case "NodeStateChanged": {
                set(state => ({
                    nodes: {
                        ...state.nodes,
                        [event.nodeId]: {
                            ...state.nodes[event.nodeId],
                            role: event.newState,
                            term: event.term,
                        },
                    },
                }));
                break;
            }
            case "MessageSent": {

                const targetNode = get().nodes[event.toNodeId];
                const isCrashedTarget = targetNode?.crashed ?? false;

                const isHeartbeat: boolean = event.messageType === "AppendEntries" && (event.payload as { entries: unknown[] })?.entries?.length === 0;

                const arrow: MessageArrow = {
                    id: event.messageId,
                    fromNodeId: event.fromNodeId,
                    toNodeId: event.toNodeId,
                    messageType: event.messageType,
                    status: isCrashedTarget ? "dropped" : "inFlight",
                    createdAt: Date.now(),
                    isHeartbeat: isHeartbeat,
                };
                set(state => ({ arrows: [...state.arrows, arrow] }));

                if (isCrashedTarget) {
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== event.messageId) }));
                    }, 600);
                }
                break;
            }

            case "MessageReceived": {
                if (event.messageType === "AppendEntriesResponse") {
                    const returnId = event.messageId + "-response";

                    const originalArrow = useRaftStore.getState().arrows.find(a => a.id === event.messageId);

                    set(s => ({ arrows: s.arrows.filter(a => a.id !== event.messageId) }));
                    set(s => ({ arrows: [...s.arrows, {
                        id: returnId,
                        fromNodeId: event.fromNodeId,
                        toNodeId: event.toNodeId,
                        messageType: event.messageType,
                        status: "inFlight" as const,
                        createdAt: Date.now(),
                        isHeartbeat: originalArrow?.isHeartbeat ?? true,
                    }]}));
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== returnId) }));
                    }, 300);

                } else if (event.messageType === "RequestVoteResponse") {

                    const returnId = event.messageId + "-response";
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== event.messageId) }));
                    }, 400);
                    setTimeout(() => {
                        set(s => ({ arrows: [...s.arrows, {
                            id: returnId,
                            fromNodeId: event.fromNodeId,
                            toNodeId: event.toNodeId,
                            messageType: event.messageType,
                            status: "inFlight" as const,
                            createdAt: Date.now(),
                            isHeartbeat: false,
                        }]}));
                    }, 500);
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== returnId) }));
                    }, 1000);

                } else if (event.messageType === "InstallSnapshotResponse") {
                    const returnId = event.messageId + "-response";
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== event.messageId) }));
                    }, 400);
                    setTimeout(() => {
                        set(s => ({ arrows: [...s.arrows, {
                            id: returnId,
                            fromNodeId: event.fromNodeId,
                            toNodeId: event.toNodeId,
                            messageType: event.messageType,
                            status: "inFlight" as const,
                            createdAt: Date.now(),
                            isHeartbeat: false,
                        }]}));
                    }, 500);
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== returnId) }));
                    }, 1000);
                }
                break;
            }

            case "MessageDropped": {
                set(state => ({
                    arrows: state.arrows.map(a => a.id === event.messageId ? { ...a, status: "dropped" } : a)
                }));
                setTimeout(() => {
                    set(s => ({ arrows: s.arrows.filter(a => a.id !== event.messageId) }));
                }, 600);
                break;
            }

            case "TermChanged": {
                set(state => ({
                    nodes: {
                        ...state.nodes,
                        [event.nodeId]: {
                            ...state.nodes[event.nodeId],
                            term: event.newTerm,
                        },
                    },
                }));
                break;
            }

            case "CommitIndexAdvanced": {
                set(state => ({
                    nodes: {
                        ...state.nodes,
                        [event.nodeId]: {
                            ...state.nodes[event.nodeId],
                            commitIndex: event.newCommitIndex,
                        },
                    },
                }));
                break;
            }

            case "VoteGranted": {
                set(state => ({
                    nodes: {
                        ...state.nodes,
                        [event.nodeId]: {
                            ...state.nodes[event.nodeId],
                            votedFor: event.candidateId,
                        },
                    },
                }));
                break;
            }

            case "NodeCrashed": {
                set(state => {
                    const existingNode = state.nodes[event.nodeId];
                    if (!existingNode) return state;
                    return {
                        nodes: {
                            ...state.nodes,
                            [event.nodeId]: { ...existingNode, crashed: true },
                        },
                        arrows: state.arrows.filter(a =>
                            a.fromNodeId !== event.nodeId && a.toNodeId !== event.nodeId
                        ),
                    };
                });
                break;
            }

            case "NodeRecovered": {
                set(state => {
                    const existingNode = state.nodes[event.nodeId];
                    const base = existingNode ?? makeNode(event.nodeId, false);
                    return {
                        nodes: {
                            ...state.nodes,
                            [event.nodeId]: {
                                ...base,
                                role: "Follower",
                                crashed: false,
                                term: event.term,
                                commitIndex: event.commitIndex,
                                snapshotIndex: event.snapshotIndex,
                            },
                        },
                    };
                });
                break;
            }

            case "LinkCut": {
                set(state => ({ cutLinks: new Set([...state.cutLinks, `${event.nodeA}-${event.nodeB}`, `${event.nodeB}-${event.nodeA}`]) }));
                break;
            }

            case "LinkHealed": {
                set(state => {
                    const newCutLinks = new Set(state.cutLinks);
                    newCutLinks.delete(`${event.nodeA}-${event.nodeB}`);
                    newCutLinks.delete(`${event.nodeB}-${event.nodeA}`);
                    return { cutLinks: newCutLinks };
                });
                break;
            }

            case "AllLinksHealed": {
                set({ cutLinks: new Set() });
                break;
            }

            case "LogAppended": {
                set(state => {
                    const node = state.nodes[event.nodeId];
                    if (!node) return state
                    const newEntries = [...node.logEntries, ...event.entries].slice(-24);
                    return {
                        nodes: {
                            ...state.nodes,
                            [event.nodeId]: { ...node, logEntries: newEntries },
                        },
                    };
                });
                break;
            }

            case "LogConflictResolved": {
                set(state => {
                    const node = state.nodes[event.nodeId];
                    if (!node) return state
                    const kept = node.logEntries.filter(e => e.index < event.truncatedFromIndex);
                    const merged = [...kept, ...event.newEntries].slice(-24);
                    return {
                        nodes: {
                            ...state.nodes,
                            [event.nodeId]: { ...node, logEntries: merged },
                        },
                    };
                });
                break;
            }

            case "SnapshotTaken": {
                set(state => ({
                    nodes: {
                        ...state.nodes,
                        [event.nodeId]: {
                            ...state.nodes[event.nodeId],
                            snapshotIndex: event.lastIncludedIndex,
                            logEntries: state.nodes[event.nodeId]?.logEntries.filter(
                                e => e.index > event.lastIncludedIndex) ?? [],
                        },
                    },
                    snapshottingNodes: new Set([...state.snapshottingNodes, event.nodeId]),
                }));
                setTimeout(() => {
                    set(state => {
                        const next = new Set(state.snapshottingNodes);
                        next.delete(event.nodeId);
                        return { snapshottingNodes: next };
                    });
                }, 1000);
                break;
            }

            case "SnapshotInstalled": {
                set(state => ({
                    nodes: {
                        ...state.nodes,
                        [event.nodeId]: {
                            ...state.nodes[event.nodeId],
                            snapshotIndex: event.lastIncludedIndex,
                            commitIndex: event.lastIncludedIndex,
                            logEntries: state.nodes[event.nodeId]?.logEntries.filter(
                                e => e.index > event.lastIncludedIndex) ?? [],
                        },
                    },
                    installingSnapshotNodes: new Set([...state.installingSnapshotNodes, event.nodeId]),
                }));
                setTimeout(() => {
                    set(state => {
                        const next = new Set(state.installingSnapshotNodes);
                        next.delete(event.nodeId);
                        return { installingSnapshotNodes: next };
                    });
                }, 2000);
                break;
            }

            case "ConfigChanged": {
                const newConfig: ClusterConfig = { voters: event.voters, learners: event.learners };
                set(state => ({
                    clusterConfig: newConfig,
                    pendingConfigChange: !event.commited,
                    nodes: applyConfig(state.nodes, newConfig),
                }));
                break;
            }

            case "ServerAdded": {
                const newConfig = event.config;
                set(state => {
                    const existingNodes = state.nodes[event.addedNodeId];
                    const addedMember = [...newConfig.voters, ...newConfig.learners].find(m => m.id === event.addedNodeId);
                    const newNode = existingNodes
                        ? { ...existingNodes, isLearner: event.asLearner, address: addedMember?.address ?? existingNodes.address }
                        : makeNode(event.addedNodeId, event.asLearner, addedMember?.address ?? '');
                    const newNodes = state.nodeIds.includes(event.addedNodeId)
                        ? state.nodeIds
                        : [...state.nodeIds, event.addedNodeId];
                    return {
                        clusterConfig: newConfig,
                        nodeIds: newNodes,
                        nodes: applyConfig({ ...state.nodes, [event.addedNodeId]: newNode }, newConfig)
                    };
                });
                break;
            }

            case "ServerRemoved": {
                const newConfig = event.config;
                set(state => ({
                    clusterConfig: newConfig,
                    nodeIds: state.nodeIds.filter(id => id !== event.removedNodeId),
                    nodes: (() => {
                        const rest = Object.fromEntries(Object.entries(state.nodes).filter(([id]) => id !== event.removedNodeId));
                        return applyConfig(rest, newConfig);
                    })(),
                    selectedNodeId: state.selectedNodeId === event.removedNodeId ? null : state.selectedNodeId,
                }));
                break;
            }

            case "LearnerPromoted": {
                const newConfig = event.config;
                set(state => ({
                    clusterConfig: newConfig,
                    nodes: applyConfig(state.nodes, newConfig),
                }));
                break;
            }

        }
    },
    selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
    sendCommand: (cmd) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(cmd));
        }
    },
    setDropRate: (nodeId, dropRate) => {set(state => ({
        dropRateByNode: {
            ...state.dropRateByNode,
            [nodeId]: dropRate,
        },
    }));
    get().sendCommand({ type: "SetDropRate", nodeId, dropRate: dropRate });
    },
    isLinkCut: (nodeA, nodeB) => {
        return get().cutLinks.has(`${nodeA}-${nodeB}`);
    },
    cutLink: (nodeA, nodeB) => {
        get().sendCommand({ type: "CutLink", nodeA, nodeB });
    },
    healLink: (nodeA, nodeB) => {
        get().sendCommand({ type: "HealLink", nodeA, nodeB });
    },
    healAllLinks: () => {
        get().sendCommand({ type: "HealAllLinks" });
    },
    setConnected: (connected) => set({ connected }),
    addServer: (nodeId, address, asLearner) => {
        get().sendCommand({ type: "AddServer", nodeId, address, asLearner });
    },
    removeServer: (nodeId) => {
        get().sendCommand({ type: "RemoveServer", nodeId });
    },
    promoteLearner: (nodeId) => {
        get().sendCommand({ type: "PromoteLearner", nodeId });
    },
    toggleMessageVisibility: (messageType) => set(state => ({
        messageVisibility: {
            ...state.messageVisibility,
            [messageType]: !state.messageVisibility[messageType],
        },
    })),
    reset: () => set({ nodeIds: [], 
        events: [], nodes: {}, arrows: [], selectedNodeId: null, dropRateByNode: {}, 
        cutLinks: new Set(), totalEventCount: 0, 
        messageVisibility: { RequestVote: true, AppendEntries: true, Heartbeat: true, Dropped: true, InstallSnapshot: true }, 
        snapshottingNodes: new Set(), installingSnapshotNodes: new Set(), clusterConfig: defaultConfig, pendingConfigChange: false}),
    })
)

setInterval(() => {
    const now = Date.now();
    useRaftStore.setState(s => ({
        arrows: s.arrows.filter(a => now - a.createdAt < 1500 || a.status === "dropped"),
    }));
}, 1000);
