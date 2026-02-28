import { useRaftSocket } from "./hooks/useRaftSocket";
import { EventFeed } from "./components/EventFeed";
import { ClusterView } from "./components/ClusterView";
import { NodeDetail } from "./components/NodeDetail";
import { ConnectionOverlay } from "./components/ConnectionOverlay";
import { ClusterPanel } from "./components/ClusterPanel";

export default function App() {
    useRaftSocket();
    return (
        <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#0d1117' }}>
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <ClusterView />
                <NodeDetail />
                <EventFeed />
                <ClusterPanel />
            </div>
            <ConnectionOverlay />
        </div>
    )
}