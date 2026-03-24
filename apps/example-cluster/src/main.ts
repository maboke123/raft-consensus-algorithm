import { EventStore, LocalEventBus } from "@maboke123/raft-core";
import { ClusterRunner } from "./ClusterRunner";
import { ClusterRunnerGRPC } from "./ClusterRunnerGRPC";
import { ClusterRunnerInterface } from "./ClusterRunnerInterface";
import { WsServer } from "./WsServer";

const MODE: "memory" | "grpc" = "memory";

const PORT = 4001;
const NODE_COUNT = 3;
const TIMER_CONFIG = { electionTimeoutMin: 500, electionTimeoutMax: 1000, heartbeatInterval: 150 };

async function main() {
    const bus = new LocalEventBus();
    const eventStore = new EventStore(bus, { maxEvents: 10000 });

    const cluster: ClusterRunnerInterface = MODE === "grpc"
        ? new ClusterRunnerGRPC(bus, { nodeCount: NODE_COUNT, timerConfig: TIMER_CONFIG })
        : new ClusterRunner(bus, { nodeCount: NODE_COUNT, timerConfig: TIMER_CONFIG });

    await cluster.start();

    const wsServer = new WsServer(eventStore, cluster, PORT);
    wsServer.start();

    console.log(`Cluster started in ${MODE} mode with ${NODE_COUNT} nodes`);

    let counter = 0;
    setInterval(async () => {
        try {
            await cluster.submitCommand({ type: "set", payload: { key: `key${counter}`, value: `value${counter}` } });
            counter++;
        } catch (err) {}
    }, 5000);

    setInterval(async () => {
        const leader = cluster.getNodeIds().find(id => cluster.isLeader(id));
        if (!leader) return;

        await cluster.crashNode(leader);

        setTimeout(async () => {
            await cluster.recoverNode(leader);
        }, 2000);
    }, 30000);

    process.on("SIGINT", async () => {
        console.log("Shutting down...");
        wsServer.stop();
        await cluster.stop();
        process.exit(0);
    });
}

main().catch((err) => {
    console.error("Error starting server:", err);
    process.exit(1);
});