import { useState } from 'react';
import { useRaftStore } from '../store/raftStore';
import { roleColors, messageColors } from '../constants/colors';

export function ClusterPanel() {
    const [open, setOpen] = useState(false);
    const nodeIds  = useRaftStore(s => s.nodeIds);
    const nodes    = useRaftStore(s => s.nodes);
    const cutLinks = useRaftStore(s => s.cutLinks);

    const allNodes   = nodeIds.map(id => nodes[id]).filter(Boolean);
    const leader     = allNodes.find(n => n.role === 'Leader' && !n.crashed);
    const upCount    = allNodes.filter(n => !n.crashed).length;
    const totalCount = allNodes.length;
    const term       = Math.max(0, ...allNodes.map(n => n.term));
    const majority   = Math.floor(totalCount / 2) + 1;
    const healthy    = upCount >= majority;

    const selectedNodeId = useRaftStore(s => s.selectedNodeId);
    const detailWidth = selectedNodeId ? 330 : 0;
    const rightOffset = detailWidth + 12;

    const messageVisibility = useRaftStore(s => s.messageVisibility);
    const toggleMessageVisibility = useRaftStore(s => s.toggleMessageVisibility);

    return (
        <>
            <button
                onClick={() => setOpen(v => !v)}
                style={{
                    position: 'fixed',
                    top: 12,
                    right: rightOffset,
                    transition: 'right 0.3s ease',
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
                {open ? 'close' : 'cluster'}
            </button>

            {open && (
                <div style={{
                    position: 'fixed',
                    top: 40,
                    right: rightOffset,
                    transition: 'right 0.3s ease',
                    width: 200,
                    maxHeight: 'calc(100vh - 60px)',
                    overflowY: 'auto',
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 8,
                    padding: '12px 14px',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: '#e6edf3',
                    zIndex: 99,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                }}>
                    <Section title="CLUSTER">
                        <Row label="leader" value={leader ? leader.nodeId : '—'} valueColor={leader ? roleColors.Leader : '#8b949e'} />
                        <Row label="term"   value={String(term)} />
                        <Row label="nodes"  value={`${upCount} / ${totalCount} up`} valueColor={healthy ? roleColors.Leader : roleColors.Candidate} />
                        {cutLinks.size > 0 && (
                            <Row label="links cut" value={String(cutLinks.size / 2)} valueColor={messageColors.Dropped} />
                        )}
                    </Section>

                    <Section title="NODE ROLES">
                        <LegendDot color={roleColors.Leader}    label="Leader" />
                        <LegendDot color={roleColors.Follower}  label="Follower" />
                        <LegendDot color={roleColors.Candidate} label="Candidate" />
                        <LegendDot color={roleColors.Crashed}   label="Crashed" />
                    </Section>

                    <Section title="MESSAGES">
                        {([
                            { key: 'RequestVote',   label: 'RequestVote',   color: messageColors.RequestVote,   dashed: false },
                            { key: 'AppendEntries', label: 'AppendEntries', color: messageColors.AppendEntries, dashed: false },
                            { key: 'Heartbeat',     label: 'Heartbeat',     color: messageColors.Heartbeat,     dashed: true  },
                            { key: 'Dropped',       label: 'Dropped',       color: messageColors.Dropped,       dashed: true  },
                        ] as const).map(({ key, label, color, dashed }) => (
                            <div
                                key={key}
                                onClick={() => toggleMessageVisibility(key)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    cursor: 'pointer',
                                    opacity: messageVisibility[key] ? 1 : 0.3,
                                    userSelect: 'none',
                                }}
                            >
                                <svg width={28} height={10} style={{ flexShrink: 0 }}>
                                    <line x1={0} y1={5} x2={22} y2={5} stroke={color} strokeWidth={dashed ? 1 : 2} strokeDasharray={dashed ? '3 2' : undefined} />
                                    <polygon points="20,2 28,5 20,8" fill={color} />
                                </svg>
                                <span style={{ color: '#8b949e' }}>{label}</span>
                                <span style={{ marginLeft: 'auto', fontSize: 10, color: messageVisibility[key] ? '#2ea043' : '#30363d' }}>
                                    {messageVisibility[key] ? 'on' : 'off'}
                                </span>
                            </div>
                        ))}
                    </Section>
                </div>
            )}
        </>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#8b949e', marginBottom: 2 }}>{title}</div>
            {children}
        </div>
    );
}

function Row({ label, value, valueColor = '#e6edf3' }: { label: string; value: string; valueColor?: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#8b949e' }}>{label}</span>
            <span style={{ color: valueColor, fontWeight: 600 }}>{value}</span>
        </div>
    );
}

function LegendDot({ color, label }: { color: string; label: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${color}`, background: '#161b22', flexShrink: 0 }} />
            <span style={{ color: '#8b949e' }}>{label}</span>
        </div>
    );
}