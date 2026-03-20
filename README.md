# raft-consensus-algorithm

A TypeScript implementation of the [Raft consensus algorithm](https://raft.github.io/), structured as a monorepo.

Raft is a protocol for building fault-tolerant distributed systems. A cluster of nodes elects a leader, replicates a log of commands across all nodes, and applies those commands to a state machine — even when some nodes crash or become unreachable. This implementation covers leader election, log replication, snapshots, pre-vote, and single-server cluster membership changes.

## Documentation

TypeDoc API documentation is published on GitHub Pages:

- https://maboke123.github.io/raft-consensus-algorithm/

## Packages

| Package | Description |
|---------|-------------|
| [`@maboke123/raft-core`](./packages/raft-core) | The core library — transport and storage agnostic |
| [`@maboke123/raft-grpc`](./packages/raft-grpc) | gRPC transport adapter for real network deployments |

## Apps

| App | Description |
|-----|-------------|
| [`example-cluster`](./apps/example-cluster) | A runnable 3-node cluster with a WebSocket server for the devtools UI |
| [`devtools`](./apps/devtools) | A React visualizer that shows live cluster state, elections, and message flow |

## Repository structure

```
packages/
  raft-core/        the npm library — zero production dependencies
  raft-grpc/        gRPC transport adapter
apps/
  example-cluster/  runnable demo server (depends on raft-core + raft-grpc)
  devtools/         React devtools UI (connects to example-cluster via WebSocket)
scripts/
  GenerateCerts.sh  generates self-signed TLS certificates for local testing
```

## Getting started

### Prerequisites

- Node.js 18+
- npm 8+ (workspaces support)

### Install dependencies

```bash
npm install
```

This installs dependencies for all packages and apps in one step.

### Build all packages

```bash
npm run build
```

Or build a single package:

```bash
cd packages/raft-core
npm run build
```

### Run tests

```bash
npm run test
```

Or test a single package:

```bash
cd packages/raft-core
npm test
```

### Run the example cluster

The example cluster starts three Raft nodes and a WebSocket server that streams events to the devtools UI.

```bash
cd apps/example-cluster
npm run dev
```

Then in a separate terminal, start the devtools UI:

```bash
cd apps/devtools
npm run dev
```

Open `http://localhost:5173` to see the cluster visualizer.

### Generate TLS certificates (optional)

For running the gRPC transport with mutual TLS locally:

```bash
bash scripts/GenerateCerts.sh
```

This generates a CA and node certificates under `certs/`. Do not commit the generated `.key` files.

## Using the library

Install from npm — you do not need to clone this repository to use the library:

```bash
npm install @maboke123/raft-core

# Optional: gRPC transport for real network deployments
npm install @maboke123/raft-grpc
```

See the [raft-core README](./packages/raft-core/README.md) for the full usage guide.

## Implementation notes

- **Pre-vote** — nodes run a pre-vote phase before starting a real election, preventing disruptions from nodes rejoining after a partition
- **Cluster membership changes** — uses the single-server-at-a-time approach from the Raft paper, allowing safe addition and removal of one node at a time without downtime
- **Snapshots** — the leader periodically takes snapshots of the application state machine and sends them to lagging followers via `InstallSnapshot` RPC
- **Pluggable storage** — storage is split into four focused interfaces (`MetaStorage`, `LogStorage`, `SnapshotStorage`, `ConfigStorage`) so you can implement exactly the backend you need
- **Pluggable transport** — the `Transport` interface is minimal so you can bring any communication layer

## License

MIT