import { MetaStorage } from "./MetaStorage";
import { ConfigStorage } from "./ConfigStorage";
import { LogStorage } from "./LogStorage";
import { SnapshotStorage } from "./SnapshotStorage";

export interface NodeStorage {
    meta: MetaStorage;
    config: ConfigStorage;
    log: LogStorage;
    snapshot: SnapshotStorage;
}
