import { useState } from "react";
import { useRaftStore } from "../store/raftStore";
import type { RaftEvent } from "../types/raftTypes";

export function EventFeed() {
    const events = useRaftStore((state) => state.events);
    const totalEventCount = useRaftStore((state) => state.totalEventCount);
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                onClick={() => setOpen(v => !v)}
                style={{
                    position: 'fixed',
                    top: 12,
                    left: 12,
                    zIndex: 100,
                    background: '#161b22',
                    border: '1px solid #30363d',
                    color: '#e6edf3',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                }}
            >
                {open ? 'close' : 'events'}
            </button>

            {open && (
                <div style={{
                    position: 'fixed',
                    top: 40,
                    left: 12,
                    width: 360,
                    maxHeight: 'calc(100vh - 60px)',
                    overflowY: 'auto',
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 8,
                    padding: 12,
                    zIndex: 99,
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: '#e6edf3',
                }}>
                    <div style={{ marginBottom: 8, color: '#8b949e' }}>
                        { totalEventCount } events -  showing last { events.length }
                    </div>
                    {events.map((event: RaftEvent) => (
                        <EventRow key={event.eventId} event={event} />
                    ))}
                </div>
            )}
        </>
    );
}

function EventRow({ event }: { event: RaftEvent }) {
    return (
        <div style={{
            borderBottom: '1px solid #21262d',
            padding: '4px 0',
            display: 'flex',
            gap: 8,
        }}>
            <span style={{ color: '#8b949e', flexShrink: 0 }}>
                {'nodeId' in event ? event.nodeId : 'cluster'}
            </span>
            <span style={{ color: '#79c0ff', flexShrink: 0 }}>
                {event.type}
            </span>
        </div>
    );
}