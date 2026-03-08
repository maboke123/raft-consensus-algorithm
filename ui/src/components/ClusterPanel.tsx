import { useState } from 'react';
import { useRaftStore } from '../store/raftStore';
import { roleColors, messageColors } from '../constants/colors';

export function ClusterPanel() {
    const [open, setOpen] = useState(false);
    const [showAddServer, setShowAddServer] = useState(false);
    const [newNodeId, setNewNodeId] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [asLearner, setAsLearner] = useState(true);

    const nodeIds  = useRaftStore(s => s.nodeIds);
    const nodes    = useRaftStore(s => s.nodes);
    const cutLinks = useRaftStore(s => s.cutLinks);
    const clusterConfig = useRaftStore(s => s.clusterConfig);
    const pendingConfigChange = useRaftStore(s => s.pendingConfigChange);
    const addServer = useRaftStore(s => s.addServer);

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

    function handleAddServer() {
        if (!newNodeId.trim() || !newAddress.trim()) return;
        addServer(newNodeId.trim(), newAddress.trim(), asLearner);
        setNewNodeId('');
        setNewAddress('');
        setAsLearner(true);
        setShowAddServer(false);
    }

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

                    <Section title="MEMBERSHIP">
                        {pendingConfigChange && (
                            <div style={{
                                fontSize: 10, color: '#e3b341',
                                border: '1px solid #e3b341',
                                borderRadius: 4, padding: '2px 6px',
                                marginBottom: 4,
                            }}>
                                ⏳ config change pending
                            </div>
                        )}

                        <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 2 }}>
                            voters ({clusterConfig.voters.length}, quorum {majority})
                        </div>
                        {clusterConfig.voters.length === 0
                            ? <span style={{ color: '#8b949e', fontSize: 11 }}>—</span>
                            : clusterConfig.voters.map(id => (
                                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: roleColors.Leader, flexShrink: 0 }} />
                                    <span style={{ color: '#e6edf3' }}>{id}</span>
                                </div>
                            ))
                        }

                        {clusterConfig.learners.length > 0 && (
                            <>
                                <div style={{ fontSize: 10, color: '#8b949e', marginTop: 6, marginBottom: 2 }}>
                                    learners ({clusterConfig.learners.length})
                                </div>
                                {clusterConfig.learners.map(id => (
                                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 4 }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: roleColors.Learner, flexShrink: 0 }} />
                                        <span style={{ color: roleColors.Learner }}>{id}</span>
                                    </div>
                                ))}
                            </>
                        )}

                        <button
                            onClick={() => setShowAddServer(v => !v)}
                            style={{
                                marginTop: 8, width: '100%', padding: '5px 0',
                                background: 'transparent',
                                border: `1px solid ${showAddServer ? '#8b949e' : '#30363d'}`,
                                color: showAddServer ? '#e6edf3' : '#8b949e',
                                borderRadius: 4, fontSize: 11,
                                fontFamily: 'monospace', cursor: 'pointer',
                            }}
                        >
                            {showAddServer ? '✕ cancel' : '+ add server'}
                        </button>

                        {showAddServer && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                                <input
                                    placeholder="node id (e.g. node4)"
                                    value={newNodeId}
                                    onChange={e => setNewNodeId(e.target.value)}
                                    style={inputStyle}
                                />
                                <input
                                    placeholder="address (e.g. localhost:5004)"
                                    value={newAddress}
                                    onChange={e => setNewAddress(e.target.value)}
                                    style={inputStyle}
                                />
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8b949e', fontSize: 11, cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={asLearner}
                                        onChange={e => setAsLearner(e.target.checked)}
                                        style={{ cursor: 'pointer' }}
                                    />
                                    add as learner first
                                </label>
                                <button
                                    onClick={handleAddServer}
                                    disabled={!newNodeId.trim() || !newAddress.trim()}
                                    style={{
                                        padding: '5px 0',
                                        background: 'transparent',
                                        border: `1px solid ${newNodeId && newAddress ? '#2ea043' : '#30363d'}`,
                                        color: newNodeId && newAddress ? '#2ea043' : '#8b949e',
                                        borderRadius: 4, fontSize: 11,
                                        fontFamily: 'monospace',
                                        cursor: newNodeId && newAddress ? 'pointer' : 'default',
                                    }}
                                >
                                    add server
                                </button>
                            </div>
                        )}
                    </Section>

                    <Section title="NODE ROLES">
                        <LegendDot color={roleColors.Leader}    label="Leader" />
                        <LegendDot color={roleColors.Follower}  label="Follower" />
                        <LegendDot color={roleColors.Candidate} label="Candidate" />
                        <LegendDot color={roleColors.Crashed}   label="Crashed" />
                        <LegendDot color={roleColors.TakingSnapshot} label="Taking snapshot" />
                        <LegendDot color={roleColors.InstallingSnapshot} label="Installing snapshot" />
                        <LegendDot color={roleColors.Learner}   label="Learner" />
                    </Section>

                    <Section title="MESSAGES">
                        {([
                            { key: 'RequestVote',   label: 'RequestVote',   color: messageColors.RequestVote,   dashed: false },
                            { key: 'AppendEntries', label: 'AppendEntries', color: messageColors.AppendEntries, dashed: false },
                            { key: 'InstallSnapshot',  label: 'InstallSnapshot',  color: messageColors.InstallSnapshotRequest,  dashed: false },
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

const inputStyle: React.CSSProperties = {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#e6edf3',
    fontFamily: 'monospace',
    fontSize: 11,
    padding: '4px 6px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
};