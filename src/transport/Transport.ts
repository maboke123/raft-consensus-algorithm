import { NodeId} from "../core/Config";
import { RPCMessage } from "../rpc/RPCTypes";

export type MessageHandler = (
    from: NodeId,
    message: RPCMessage
) => Promise<RPCMessage>;

export interface Transport {
    start(): Promise<void>;
    stop(): Promise<void>;
    isStarted(): boolean;
    send(peerId: NodeId, message: RPCMessage): Promise<RPCMessage>;
    onMessage(handler: MessageHandler): void;
    addPeer?(peerId: NodeId, address: string): Promise<void>;
    removePeer?(peerId: NodeId): void;
}