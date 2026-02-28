import { LocalEventBus } from "../events/EventBus";
import { EventStore } from "../events/EventStore";
// import { ClusterRunner } from "./ClusterRunner";
import { ClusterRunnerGRPC } from "./ClusterRunnerGRPC";
import { WsServer } from "./WsServer";

async function main() {
    const port = 4001;
    const nodeCount = 3;

    const bus = new LocalEventBus();
    const eventStore = new EventStore(bus, { maxEvents: 10000 });

    const timerConfig = { electionTimeoutMin: 500, electionTimeoutMax: 1000, heartbeatInterval: 150 };
    const cluster = new ClusterRunnerGRPC(bus, {nodeCount, timerConfig});

    await cluster.start();

    const wsServer = new WsServer(eventStore, cluster, port);
    wsServer.start();

    let counter = 0;
    setInterval(async () => {
        try {
            await cluster.submitCommand({ type: "set", payload: { key: `key${counter}`, value: `value${counter}` }});
            counter++;
        } catch (err) {}
    }, 5000);

    setInterval(async () => {
        const nodeIds = cluster.getNodeIds();
        const leader = nodeIds.find(id => {
            const node = cluster['nodes'].get(id);
            return node && node.isStarted() && node.isLeader();
        });
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