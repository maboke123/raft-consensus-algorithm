import { useEffect } from "react";
import { setStoreWebSocket, useRaftStore } from "../store/raftStore";
import type { ServerMessage } from "../types/raftTypes";

const ws_url = 'ws://localhost:4001';
const reconnnect_ms = 1000;

export function useRaftSocket() {
    const setNodeIds = useRaftStore((state) => state.setNodeIds);
    const pushEvent = useRaftStore((state) => state.pushEvent);
    const processEvent = useRaftStore((state) => state.processEvent);
    const setConnected = useRaftStore((state) => state.setConnected);
    const reset = useRaftStore((state) => state.reset);

    useEffect(() => {
        let ws: WebSocket;
        let canceled = false;
        let reconnectTimer: ReturnType<typeof setTimeout>;

        function connect() {
            ws = new WebSocket(ws_url);

            setStoreWebSocket(ws);

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data) as ServerMessage;

                if (data.type === "InitialState") {
                    reset();
                    setNodeIds(data.nodeIds, data.config);

                    for (const event of data.events) {
                        processEvent(event);
                    }

                    for (const event of [...data.events].reverse()) {
                        pushEvent(event);
                    }
                } else if (data.type === "LiveEvent") {
                    pushEvent(data.event);
                    processEvent(data.event);
                }
            };

            ws.onopen = () => {
                setConnected(true);
            };

            ws.onclose = () => {
                if (!canceled) {
                    reconnectTimer = setTimeout(connect, reconnnect_ms);
                }
                setConnected(false);
            };

            ws.onerror = () => ws.close();
        }

        connect();

        return () => {
            canceled = true;
            clearTimeout(reconnectTimer);
            ws?.close();
            setStoreWebSocket(null);
            setConnected(false);
        };
    }, []);
}