# Changelog

## 0.2.0 - 2026-03-15

### Added
- `snapshotThreshold` is now configurable via `RaftConfig`

## 0.1.0 - 2026-03-15

### Initial release

- Leader election with pre-vote
- Log replication
- Snapshots
- Joint consensus cluster membership changes (addServer, removeServer, promoteServer)
- InMemoryNodeStorage and DiskNodeStorage
- LocalEventBus with full event stream
- MockTransport, MockClock, SeededRandom for testing