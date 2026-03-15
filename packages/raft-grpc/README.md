# @maboke123/raft-grpc

gRPC transport adapter for [@maboke123/raft-core](https://www.npmjs.com/package/@maboke123/raft-core).

Enables Raft nodes to communicate over a real network using gRPC and Protocol Buffers. Use this when you want to run each node in its own process or on separate machines.

For in-process testing and development, use `MockTransport` from `@maboke123/raft-core/testing` instead — it requires no network setup.

## Install

```bash
npm install @maboke123/raft-core @maboke123/raft-grpc
```

## Usage

### Insecure mode (local development only)

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
    stateMachine: new MyStateMachine(),
  });

  await node.start();
}

main().catch(console.error);
```

Run the same code for `node2` and `node3`, adjusting `nodeId`, port, and data directory. Start all three — one will be elected leader within one election timeout.

### Mutual TLS (recommended for production)

Pass a `certPaths` object as the fourth argument. Each node needs a shared CA certificate, its own certificate, and its own private key:

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

Each node in the cluster needs its own certificate signed by the shared CA. You can generate self-signed certificates for local testing with the script in the [repository](https://github.com/maboke123/raft-consensus-algorithm/blob/master/scripts/GenerateCerts.sh).

Do not commit private key files to your repository.

## Constructor signature

```ts
new GrpcTransport(
  nodeId:    string,                       // this node's ID
  port:      number,                       // port this node listens on
  peers:     Record<string, string>,       // { [nodeId]: address }
  certPaths?: {                            // omit for insecure mode
    caCert:   string;                      // path to CA certificate
    nodeCert: string;                      // path to this node's certificate
    nodeKey:  string;                      // path to this node's private key
  }
)
```

## Full documentation

See [@maboke123/raft-core](https://www.npmjs.com/package/@maboke123/raft-core) for the complete guide including state machine implementation, events, cluster membership changes, and testing utilities.

## License

MIT