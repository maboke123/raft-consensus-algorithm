import { LocalEventBus } from "../events/EventBus";
import { EventStore } from "../events/EventStore";
import { ClusterRunner } from "./ClusterRunner";
import { WsServer } from "./WsServer";

async function main() {
    const port = 4001;
    const nodeCount = 5;

    const bus = new LocalEventBus();
    const eventStore = new EventStore(bus, { maxEvents: 10000 });

    const timerConfig = { electionTimeoutMin: 1500, electionTimeoutMax: 3000, heartbeatInterval: 500 };
    const cluster = new ClusterRunner(bus, {nodeCount, timerConfig});

    await cluster.start();

    const wsServer = new WsServer(eventStore, cluster, port);
    wsServer.start();

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