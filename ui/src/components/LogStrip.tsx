import type { LogEntry } from '../types/raftTypes';
import { termColor } from '../constants/colors';

interface Props {
    entries: LogEntry[];
    commitIndex: number;
}

export function LogStrip({ entries, commitIndex }: Props) {
    if (entries.length === 0) {
        return (
            <div style={{ color: '#8b949e', fontSize: 11, fontStyle: 'italic', padding: '4px 0' }}>
                empty log
            </div>
        );
    }

    return (
        <div
            className="no-scrollbar"
            style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 4,
                overflowX: 'auto',
                overflowY: 'visible',
                minWidth: 0,
                width: '100%',
            }}
        >
            {entries.map(entry => {
                const committed = entry.index <= commitIndex;
                const color = termColor(entry.term);
                return (
                    <div
                        key={entry.index}
                        title={`index: ${entry.index}\nterm: ${entry.term}\ncommand: ${JSON.stringify(entry.command)}`}
                        style={{
                            flexShrink: 0,
                            width: 34,
                            borderRadius: 4,
                            border: `1px solid ${color}`,
                            background: committed ? `${color}22` : 'transparent',
                            padding: '4px 2px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 2,
                            opacity: committed ? 1 : 0.5,
                            cursor: 'default',
                        }}
                    >
                        <span style={{ fontSize: 9, color: '#8b949e' }}>#{entry.index}</span>
                        <span style={{ fontSize: 9, color, fontWeight: 700 }}>t{entry.term}</span>
                        {committed && (
                            <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#2ea043' }} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}