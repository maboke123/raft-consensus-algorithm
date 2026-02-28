
import { WebSocketServer, WebSocket } from "ws";
import { EventStore } from "../events/EventStore";
// import { ClusterRunner } from "./ClusterRunner";
import { ClientMessage, ServerMessage } from "../events/RaftEvents";
import { ClusterRunnerGRPC } from "./ClusterRunnerGRPC";

export class WsServer {
    private wss: WebSocketServer | null = null;

    constructor(
        private eventStore: EventStore,
        // private cluster: ClusterRunner,
        private cluster: ClusterRunnerGRPC,
        private port: number = 4001
    ) {}

    start(): void {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on("listening", () => {
            console.log(`WebSocket server started on port ${this.port}`);
        });

        this.wss.on("connection", (ws) => {
            console.log("New client connected");
            this.handleConnection(ws);
        });
    }

    stop(): void {
        if (this.wss) {
            this.wss.close(() => {
                console.log("WebSocket server stopped");
            });
        }
    }

    private handleConnection(ws: WebSocket): void {
        const initial: ServerMessage = {
            type: "InitialState",
            events: this.eventStore.getAllEvents(),
            nodeIds: this.cluster.getNodeIds(),
        };

        ws.send(JSON.stringify(initial));

        const unsubscribe = this.eventStore.onLiveEvent((event) => {
            if (ws.readyState !== WebSocket.OPEN) {
                return;
            }

            setImmediate(() => {
                const message: ServerMessage = {
                    type: "LiveEvent",
                    event,
                };

                ws.send(JSON.stringify(message));
            });
        });

        ws.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleMessage(message);
            } catch (err) {
                console.error("Failed to parse message from client:", err);
            }
        })

        ws.on("close", () => {
            console.log("Client disconnected");
            unsubscribe();
        });

        ws.on("error", (err) => {
            console.error("WebSocket error:", err);
            unsubscribe();
        });
    }

    private handleMessage(message: ClientMessage): void {
        switch (message.type) {
            case "SubmitCommand":
                this.cluster.submitCommand(message.command);
                break;
            case "CrashNode":
                this.cluster.crashNode(message.nodeId);
                break;
            case "RecoverNode":
                this.cluster.recoverNode(message.nodeId);
                break;
            case "PartitionNodes":
                this.cluster.partitionNodes(message.groups);
                break;
            case "HealPartition":
                this.cluster.healPartition();
                break;
            case "SetDropRate":
                this.cluster.setDropRate(message.nodeId, message.dropRate);
                break;
            case "CutLink":
                this.cluster.cutLink(message.nodeA, message.nodeB);
                break;
            case "HealLink":
                this.cluster.healLink(message.nodeA, message.nodeB);
                break;
            case "HealAllLinks":
                this.cluster.healAllLinks();
                break;
            default:
                console.warn("Unknown message type from client:", message);
        }
    }
}