import { useRaftStore } from '../store/raftStore';

export function ConnectionOverlay() {
    const connected = useRaftStore(s => s.connected);

    if (connected) return null;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(13, 17, 23, 0.92)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
            gap: 16,
        }}>
            <div style={{
                width: 32,
                height: 32,
                border: '2px solid #30363d',
                borderTopColor: '#0366d6',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
            }} />
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#8b949e' }}>
                connecting to ws://localhost:4001
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#30363d' }}>
                make sure the server is running
            </div>
        </div>
    );
}