import { useRaftStore } from "../store/raftStore";
import type { RaftEvent } from "../types/raftTypes";

export function EventFeed() {
    const events = useRaftStore((state) => state.events);

    return (
        <div style={{
            height: '100vh',
            overflowY: 'scroll',
            padding: '20px',
            background: '#f0f0f0',
            color: '#000000',
            fontSize: '14px',
        }}>
            <div style={{ marginBottom: '10px'}}>
                <strong>Event Feed</strong>
            </div>
            {events.map((event: RaftEvent) => (
                <EventRow key={event.eventId} event={event} />
            ))}
        </div>
    );
}

function EventRow({ event }: { event: RaftEvent }) {
    return (
        <div style={{
            marginBottom: '5px',
            padding: '10px',
            background: '#ffffff',
            borderRadius: '4px',
        }}>
            <span style={{ color: '#8b949e', flexShrink: 0 }}>
                {'nodeId' in event ? event.nodeId : 'cluster'}
            </span>
            <span style={{ color: '#79c0ff', flexShrink: 0 }}>
                {event.type}
            </span>
            <span style={{ color: '#6e7681', wordBreak: 'break-all' }}>
                {JSON.stringify(event)}
            </span>
        </div>
    );
}