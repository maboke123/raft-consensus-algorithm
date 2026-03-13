import { NodeStorage } from "./../interfaces/NodeStorage";
import { DiskMetaStorage } from "./DiskMetaStorage";
import { DiskConfigStorage } from "./DiskConfigStorage";
import { DiskLogStorage } from "./DiskLogStorage";
import { DiskSnapshotStorage } from "./DiskSnapshotStorage";

export class DiskNodeStorage implements NodeStorage {
    meta: DiskMetaStorage;
    config: DiskConfigStorage;
    log: DiskLogStorage;
    snapshot: DiskSnapshotStorage;

    constructor(dirPath: string) {
        this.meta = new DiskMetaStorage(dirPath);
        this.config = new DiskConfigStorage(dirPath);
        this.log = new DiskLogStorage(dirPath);
        this.snapshot = new DiskSnapshotStorage(dirPath);
    }

    async open(): Promise<void> {
        if (!this.meta.isOpen()) await this.meta.open();
        if (!this.config.isOpen()) await this.config.open();
        if (!this.log.isOpen()) await this.log.open();
        if (!this.snapshot.isOpen()) await this.snapshot.open();
    }

    async close(): Promise<void> {
        if (this.meta.isOpen()) await this.meta.close();
        if (this.config.isOpen()) await this.config.close();
        if (this.log.isOpen()) await this.log.close();
        if (this.snapshot.isOpen()) await this.snapshot.close();
    }

    isOpen(): boolean {
        return this.meta.isOpen() && this.config.isOpen() && this.log.isOpen() && this.snapshot.isOpen();
    }
}