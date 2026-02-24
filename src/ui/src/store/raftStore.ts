import type { MessageArrow, NodeUIState, RaftEvent } from "../types/raftTypes";
import { create } from 'zustand'

interface RaftStore {
    nodeIds: string[];
    events: RaftEvent[];
    nodes: Record<string, NodeUIState>;
    arrows: MessageArrow[];
    setNodeIds: (ids: string[]) => void;
    pushEvent: (event: RaftEvent) => void;
    processEvent: (event: RaftEvent) => void;
    reset: () => void;
}

const makeNode = (nodeId: string): NodeUIState => ({
    nodeId,
    role: "Follower",
    term: 0,
    commitIndex: 0,
    votedFor: null,
    crashed: false,
    logEntries: [],
})

export const useRaftStore = create<RaftStore>((set) => ({
    nodeIds: [],
    events: [],
    nodes: {},
    arrows: [],

    setNodeIds: (ids) => { 
        const nodes: Record<string, NodeUIState> = {};
        for (const id of ids) {
            nodes[id] = makeNode(id);
        }
        set({ nodeIds: ids, nodes });
    },
    pushEvent: (event) => set(
        (state) => ({ events: [event, ...state.events]
            .slice(0, 100) })),
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
                const arrow: MessageArrow = {
                    id: event.messageId,
                    fromNodeId: event.fromNodeId,
                    toNodeId: event.toNodeId,
                    messageType: event.messageType,
                    status: "inFlight",
                    createdAt: Date.now(),
                };
                set(state => ({ arrows: [...state.arrows, arrow] }));
                break;
            }

            case "MessageReceived": {
                if (event.messageType === "AppendEntriesResponse") {
                    const returnId = event.messageId + "-response";
                    set(s => ({ arrows: s.arrows.filter(a => a.id !== event.messageId) }));
                    set(s => ({ arrows: [...s.arrows, {
                        id: returnId,
                        fromNodeId: event.fromNodeId,
                        toNodeId: event.toNodeId,
                        messageType: event.messageType,
                        status: "inFlight" as const,
                        createdAt: Date.now(),
                    }]}));
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== returnId) }));
                    }, 300);
                } else if (event.messageType === "RequestVoteResponse") {

                    const returnId = event.messageId + "-response";
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== event.messageId) }));
                    }, 1000);
                    setTimeout(() => {
                        set(s => ({ arrows: [...s.arrows, {
                            id: returnId,
                            fromNodeId: event.fromNodeId,
                            toNodeId: event.toNodeId,
                            messageType: event.messageType,
                            status: "inFlight" as const,
                            createdAt: Date.now(),
                        }]}));
                    }, 1500);
                    setTimeout(() => {
                        set(s => ({ arrows: s.arrows.filter(a => a.id !== returnId) }));
                    }, 2500);
                }
                break;
            }
        }
    },
    reset: () => set({ nodeIds: [], events: [], nodes: {}, arrows: [] }),
    })
)
