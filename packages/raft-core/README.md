# @maboke123/raft-core

A TypeScript implementation of the [Raft consensus algorithm](https://raft.github.io/).

Raft is a protocol that lets a cluster of nodes agree on a shared state even when some nodes crash or become unreachable. It handles leader election, log replication, snapshots, and cluster membership changes. You bring your own state machine — Raft takes care of making sure every node applies the same commands in the same order.

## Install

```bash
npm install @maboke123/raft-core
```

Optional — only needed if you want real network communication over gRPC:

```bash
npm install @maboke123/raft-grpc
```

## How it works

There are four things you always need to provide:

- **Config** — your node's ID, address, and the list of peers
- **Storage** — where the node persists its state. Use `InMemoryNodeStorage` for testing/development, `DiskNodeStorage` for production
- **Transport** — how nodes talk to each other. Use `MockTransport` (from `/testing`) for in-process clusters, `GrpcTransport` (from `@maboke123/raft-grpc`) for real networks
- **State machine** — your application logic. Raft calls `apply()` on it for every committed command

> **Commit vs apply:** `submitCommand()` resolves when the command is *committed* — meaning a majority of nodes have written it to their logs. The command is then *applied* to your state machine asynchronously. In practice this happens within milliseconds, but if you read `getApplicationState()` immediately after `submitCommand()` resolves, wait a brief moment for the apply loop to catch up.

---

## Quick start — 3-node in-process cluster

This runs three Raft nodes in the same process using in-memory storage and a mock transport. Good for development, testing, and learning how Raft works.

```ts
import { RaftNode, InMemoryNodeStorage } from "@maboke123/raft-core";
import { MockTransport } from "@maboke123/raft-core/testing";

// 1. Define your application state machine
class KeyValueStore {
  private data = new Map<string, unknown>();

  async apply(command: { type: string; payload: any }) {
    if (command.type === "SET") {
      this.data.set(command.payload.key, command.payload.value);
    }
    if (command.type === "DELETE") {
      this.data.delete(command.payload.key);
    }
  }

  getState() {
    return Object.fromEntries(this.data);
  }

  async takeSnapshot() {
    return Buffer.from(JSON.stringify(this.getState()));
  }

  async installSnapshot(data: Buffer) {
    const parsed = JSON.parse(data.toString());
    this.data = new Map(Object.entries(parsed));
  }
}

// 2. Boot the cluster
async function main() {
  const nodeIds = ["node1", "node2", "node3"];
  const nodes: RaftNode[] = [];

  for (const nodeId of nodeIds) {
    const peers = nodeIds
      .filter((id) => id !== nodeId)
      .map((id, i) => ({ id, address: `localhost:${5000 + i}` }));

    const node = new RaftNode({
      config: {
        nodeId,
        address: `localhost:${5000 + nodeIds.indexOf(nodeId)}`,
        peers,
        electionTimeoutMinMs: 150,
        electionTimeoutMaxMs: 300,
        heartbeatIntervalMs: 50,
      },
      storage: new InMemoryNodeStorage(),
      transport: new MockTransport(nodeId),
      stateMachine: new KeyValueStore(),
    });

    nodes.push(node);
  }

  // 3. Start all nodes
  await Promise.all(nodes.map((n) => n.start()));

  // 4. Wait for a leader to be elected (happens within one election timeout)
  await new Promise((resolve) => setTimeout(resolve, 500));

  const leader = nodes.find((n) => n.isLeader());
  if (!leader) throw new Error("No leader elected");
  console.log(`Leader: ${leader.getNodeId()}`);

  // 5. Submit a command — only the leader accepts commands
  const result = await leader.submitCommand({
    type: "SET",
    payload: { key: "hello", value: "world" },
  });
  console.log("Committed:", result); // { success: true, index: 2 }

  // Wait briefly for the apply loop to apply the committed entry
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 6. Read state — all nodes should be consistent
  for (const node of nodes) {
    console.log(node.getNodeId(), node.getApplicationState());
    // node1 { hello: 'world' }
    // node2 { hello: 'world' }
    // node3 { hello: 'world' }
  }

  await Promise.all(nodes.map((n) => n.stop()));
}

main().catch(console.error);
```

---

## Production setup — gRPC over a real network

Each node runs in its own process. You need `@maboke123/raft-grpc` for the transport.

**node1.ts:**
```ts
import { RaftNode, DiskNodeStorage } from "@maboke123/raft-core";
import { GrpcTransport } from "@maboke123/raft-grpc";

async function main() {
  const node = new RaftNode({
    config: {
      nodeId: "node1",
      address: "localhost:50051",
      peers: [
        { id: "node2", address: "localhost:50052" },
        { id: "node3", address: "localhost:50053" },
      ],
      electionTimeoutMinMs: 150,
      electionTimeoutMaxMs: 300,
      heartbeatIntervalMs: 50,
    },
    storage: new DiskNodeStorage("./data/node1"),
    transport: new GrpcTransport("node1", 50051, {
      node2: "localhost:50052",
      node3: "localhost:50053",
    }),
    stateMachine: new KeyValueStore(),
  });

  await node.start();
  console.log("node1 started");
}

main().catch(console.error);
```

Run `node2.ts` and `node3.ts` with the same pattern, adjusting `nodeId`, port, and data directory for each. Start all three — one will be elected leader within one election timeout.

### Adding TLS (recommended for production)

Pass a `certPaths` object as the fourth argument to `GrpcTransport`. Each node needs a shared CA certificate, its own certificate, and its own private key:

```ts
const transport = new GrpcTransport(
  "node1",
  50051,
  {
    node2: "localhost:50052",
    node3: "localhost:50053",
  },
  {
    caCert:   "./certs/ca/ca.crt",
    nodeCert: "./certs/node1/node1.crt",
    nodeKey:  "./certs/node1/node1.key",
  }
);
```

Without `certPaths` the transport runs in insecure mode — fine for local development, not for production.

---

## Observing the cluster with events

Subscribe to a `LocalEventBus` to get a stream of everything happening inside the cluster. Useful for logging, metrics, dashboards, and reacting to leadership changes.

```ts
import { RaftNode, InMemoryNodeStorage, LocalEventBus } from "@maboke123/raft-core";
import { MockTransport } from "@maboke123/raft-core/testing";

async function main() {
  const bus = new LocalEventBus();

  const node = new RaftNode({
    config: {
      nodeId: "node1",
      address: "localhost:5001",
      peers: [
        { id: "node2", address: "localhost:5002" },
        { id: "node3", address: "localhost:5003" },
      ],
      electionTimeoutMinMs: 150,
      electionTimeoutMaxMs: 300,
      heartbeatIntervalMs: 50,
    },
    storage: new InMemoryNodeStorage(),
    transport: new MockTransport("node1"),
    stateMachine: new KeyValueStore(),
    eventBus: bus,
  });

  bus.subscribe((event) => {
    switch (event.type) {
      case "LeaderElected":
        console.log(`New leader: ${event.leaderId} in term ${event.term}`);
        break;
      case "NodeStateChanged":
        console.log(`${event.nodeId}: ${event.oldState} → ${event.newState}`);
        break;
      case "CommitIndexAdvanced":
        console.log(`Commit index advanced to ${event.newCommitIndex}`);
        break;
      case "SnapshotTaken":
        console.log(`Snapshot taken at index ${event.lastIncludedIndex}`);
        break;
      case "FatalError":
        console.error(`Fatal error on ${event.nodeId}: ${event.reason}`);
        process.exit(1); // your code decides what to do
        break;
    }
  });

  await node.start();
}

main().catch(console.error);
```

All available event types: `NodeStateChanged`, `TermChanged`, `CommitIndexAdvanced`, `LeaderElected`, `ElectionStarted`, `VoteGranted`, `VoteDenied`, `LogAppended`, `LogConflictResolved`, `MatchIndexUpdated`, `MessageSent`, `MessageReceived`, `MessageDropped`, `SnapshotTaken`, `SnapshotInstalled`, `NodeCrashed`, `NodeRecovered`, `ServerAdded`, `ServerRemoved`, `LearnerPromoted`, `ConfigChanged`, `FatalError`.

---

## Cluster membership changes

The leader can add and remove nodes from a running cluster without downtime.

```ts
// Add a new voter
await leader.addServer("node4", "localhost:50054");

// Add as a learner first — receives log but does not vote
// useful to let the node catch up before promoting it
await leader.addServer("node4", "localhost:50054", true);

// Promote a learner to voter once it has caught up
await leader.promoteServer("node4");

// Remove a node
await leader.removeServer("node3");
```

---

## Implementing a custom transport

Implement the `Transport` interface to use any communication layer — WebSockets, HTTP/2, IPC, etc.

```ts
import type { Transport, MessageHandler, NodeId, RPCMessage } from "@maboke123/raft-core";

export class MyTransport implements Transport {
  private handler: MessageHandler | null = null;
  private started = false;

  async start(): Promise<void> {
    // open your server / connection pool here
    this.started = true;
  }

  async stop(): Promise<void> {
    // close your server / connection pool here
    this.started = false;
  }

  isStarted(): boolean {
    return this.started;
  }

  // Send a message to a peer and return its response
  async send(peerId: NodeId, message: RPCMessage): Promise<RPCMessage> {
    // serialize message, send over the wire, deserialize and return response
    throw new Error("Not implemented");
  }

  // Register the handler that processes incoming messages from peers.
  // When a message arrives from a peer, call:
  //   const response = await this.handler(fromNodeId, incomingMessage)
  // then send the response back to the peer.
  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }
}
```

---

## Implementing a custom storage backend

Implement `NodeStorage` to persist Raft state in any backend — Redis, Postgres, S3, etc.

`NodeStorage` is a container for four sub-storages. Each handles a different concern:

```ts
import type {
  NodeStorage,
  MetaStorage,    MetaData,
  LogStorage,     LogStorageMeta, LogEntry,
  SnapshotStorage,
  ConfigStorage,  ConfigStorageData,
  ClusterMember,
} from "@maboke123/raft-core";

// Stores current term and votedFor — written on every vote and term change
class MyMetaStorage implements MetaStorage {
  async open(): Promise<void> { /* connect */ }
  async close(): Promise<void> { /* disconnect */ }
  isOpen(): boolean { return true; }

  async read(): Promise<MetaData | null> {
    // return { term, votedFor } or null if no data yet
    throw new Error("Not implemented");
  }

  async write(term: number, votedFor: string | null): Promise<void> {
    // must be atomic — if this write is lost, the node may violate safety
    throw new Error("Not implemented");
  }
}

// Stores committed cluster configuration
class MyConfigStorage implements ConfigStorage {
  async open(): Promise<void> { /* connect */ }
  async close(): Promise<void> { /* disconnect */ }
  isOpen(): boolean { return true; }

  async read(): Promise<ConfigStorageData | null> {
    throw new Error("Not implemented");
  }

  async write(voters: ClusterMember[], learners: ClusterMember[]): Promise<void> {
    throw new Error("Not implemented");
  }
}

// Stores the Raft log — the most write-intensive storage
class MyLogStorage implements LogStorage {
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  isOpen(): boolean { return true; }

  async readMeta(): Promise<LogStorageMeta> {
    // return { snapshotIndex, snapshotTerm, lastIndex, lastTerm }
    throw new Error("Not implemented");
  }

  async append(entries: LogEntry[]): Promise<void> {
    throw new Error("Not implemented");
  }

  async getEntry(index: number): Promise<LogEntry | null> {
    throw new Error("Not implemented");
  }

  async getEntries(from: number, to: number): Promise<LogEntry[]> {
    throw new Error("Not implemented");
  }

  async truncateFrom(index: number): Promise<void> {
    // delete all entries from index onwards (used during conflict resolution)
    throw new Error("Not implemented");
  }

  async compact(upToIndex: number, term: number): Promise<void> {
    // discard entries up to upToIndex after a snapshot has been taken
    throw new Error("Not implemented");
  }

  async reset(snapshotIndex: number, snapshotTerm: number): Promise<void> {
    // clear the entire log (used when installing a snapshot from the leader)
    throw new Error("Not implemented");
  }
}

// Stores snapshots of your application state machine
class MySnapshotStorage implements SnapshotStorage {
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  isOpen(): boolean { return true; }

  async save(snapshot: any): Promise<void> {
    throw new Error("Not implemented");
  }

  async load(): Promise<any | null> {
    throw new Error("Not implemented");
  }

  async readMetadata(): Promise<any | null> {
    throw new Error("Not implemented");
  }
}

// Compose all four into a NodeStorage
export class MyNodeStorage implements NodeStorage {
  meta     = new MyMetaStorage();
  config   = new MyConfigStorage();
  log      = new MyLogStorage();
  snapshot = new MySnapshotStorage();

  async open(): Promise<void> {
    await Promise.all([
      this.meta.open(),
      this.config.open(),
      this.log.open(),
      this.snapshot.open(),
    ]);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.meta.close(),
      this.config.close(),
      this.log.close(),
      this.snapshot.close(),
    ]);
  }

  isOpen(): boolean {
    return (
      this.meta.isOpen() &&
      this.config.isOpen() &&
      this.log.isOpen() &&
      this.snapshot.isOpen()
    );
  }
}
```

---

## Writing tests for your own code

Import testing utilities from the `/testing` subpath. These are not part of the main bundle and should only ever appear in test code.

```ts
import { MockTransport, MockClock, SeededRandom } from "@maboke123/raft-core/testing";

// MockClock gives you full control over time — no real waiting in tests
const clock = new MockClock();

// SeededRandom makes election timeouts deterministic — no flaky tests
const node = new RaftNode({
  config: { ... },
  storage: new InMemoryNodeStorage(),
  transport: new MockTransport("node1"),
  stateMachine: new KeyValueStore(),
  _clock:  clock,
  _random: new SeededRandom(42),
});

await node.start();

// Advance 1000ms instantly — triggers election without any real waiting
await clock.advanceAsyncMs(1000);

console.log(node.isLeader()); // true
```

---

## Configuration reference

| Option | Type | Description |
|--------|------|-------------|
| `nodeId` | `string` | Unique identifier for this node |
| `address` | `string` | Address this node listens on e.g. `localhost:50051` |
| `peers` | `ClusterMember[]` | Initial list of other nodes `{ id, address }` |
| `electionTimeoutMinMs` | `number` | Min wait before a follower starts an election. Must be ≥ 3× heartbeat |
| `electionTimeoutMaxMs` | `number` | Max election timeout. Actual value is randomized between min and max |
| `heartbeatIntervalMs` | `number` | How often the leader sends heartbeats to followers |

**Recommended values for a LAN cluster:**
```ts
electionTimeoutMinMs: 150,
electionTimeoutMaxMs: 300,
heartbeatIntervalMs: 50,
```

**Recommended values for a WAN / higher latency cluster:**
```ts
electionTimeoutMinMs: 500,
electionTimeoutMaxMs: 1000,
heartbeatIntervalMs: 150,
```

---

## License

MIT