# Changelog

## 0.2.1 - 2026-03-24

### Added
- Documentation

### Fixed
- Initial config for in-memory cluster runner
- Visual bug: incorrect quorum display when learners are present
- Leader not included in voters array in `tryAdvanceCommitIndex`

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