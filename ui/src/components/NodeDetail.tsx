import { roleColors } from "../constants/colors";
import { useRaftStore } from "../store/raftStore";
import { LogStrip } from "./LogStrip";

export function NodeDetail() {
    const selectedNodeId = useRaftStore((state) => state.selectedNodeId);
    const selectNode = useRaftStore((state) => state.selectNode);
    const nodes = useRaftStore((state) => state.nodes);
    const sendCommand = useRaftStore((state) => state.sendCommand);

    const promoteServer = useRaftStore((state) => state.promoteLearner);
    const removeServer = useRaftStore((state) => state.removeServer);

    const dropRate = useRaftStore((state) => state.dropRateByNode[selectedNodeId ?? ""] ?? 0);
    const setDropRate = useRaftStore((state) => state.setDropRate);

    const node = selectedNodeId ? nodes[selectedNodeId] : null;

    if (!node) return null;

    const membershipColor = node.isLearner ? roleColors.Learner : roleColors.Leader;

    return (
        <div style={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0,
            width: 280,
            background: '#161b22',
            borderLeft: '1px solid #30363d',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            zIndex: 10,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16 }}>
                    {node.nodeId}
                </span>
                <button onClick={() => selectNode(null)}
                    style={{ background: 'none', color: '#8b949e', fontSize: 18, cursor: 'pointer' }}>
                    ×
                </button>
            </div>

            <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 4,
                border: `1px solid ${membershipColor}`,
                width: 'fit-content',
                fontFamily: 'monospace',
                fontSize: 11,
            }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: membershipColor }} />
                <span style={{ color: membershipColor }}>{node.isLearner ? 'Learner' : 'Voter'}</span>
            </div>

            <Row label="Role"         value={node.role} />
            <Row label="Term"         value={String(node.term)} />
            <Row label="Commit index" value={String(node.commitIndex)} />
            <Row label="Snapshot index" value={String(node.snapshotIndex)} />
            <Row label="Voted for"    value={node.votedFor ?? '—'} />
            <Row label="Crashed"      value={node.crashed ? 'yes' : 'no'} />

            <div style={{ borderTop: '1px solid #30363d', paddingTop: 12, marginTop: 4 }}>
                {node.crashed ? (
                    <button
                        onClick={() => sendCommand({ type: 'RecoverNode', nodeId: node.nodeId })}
                        style={btnStyle(roleColors.Recover)}
                    >
                        recover
                    </button>
                ) : (
                    <button
                        onClick={() => sendCommand({ type: 'CrashNode', nodeId: node.nodeId })}
                        style={btnStyle(roleColors.Crashed)}
                    >
                        crash
                    </button>
                )}
            </div>

            <div style={{ borderTop: '1px solid #30363d', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#8b949e', letterSpacing: '0.1em' }}>MEMBERSHIP</div>

                {node.isLearner && (
                    <button
                        onClick={() => promoteServer(node.nodeId)}
                        style={btnStyle(roleColors.Learner)}
                        title="Promote this learner to a voting member"
                    >
                        promote to voter
                    </button>
                )}

                <button
                    onClick={() => {
                        removeServer(node.nodeId);
                        selectNode(null);
                    }}
                    style={btnStyle('#8b949e')}
                    title="Remove this node from the cluster"
                >
                    remove from cluster
                </button>
            </div>

            <div style={{ borderTop: '1px solid #30363d', paddingTop: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 13 }}>
                    <span style={{ color: '#8b949e' }}>Drop Rate</span>
                    <span style={{ color: dropRate > 0 ? `hsl(${(1 - dropRate) * 120}, 70%, 50%)` : '#e6edf3' }}>
                        {Math.round(dropRate * 100)}%
                    </span>
                </div>
                <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
                    <div style={{
                        position: 'absolute',
                        height: 4,
                        width: '100%',
                        borderRadius: 2,
                        background: `linear-gradient(to right,
                            hsl(${(1 - dropRate) * 120}, 70%, 40%) 0%,
                            hsl(${(1 - dropRate) * 120}, 70%, 40%) ${dropRate * 100}%,
                            #30363d ${dropRate * 100}%,
                            #30363d 100%)`,
                    }} />
                    <input
                        type="range"
                        min={0} max={1} step={0.05}
                        value={dropRate}
                        onChange={e => setDropRate(node.nodeId, parseFloat(e.target.value))}
                        style={{
                            position: 'absolute',
                            width: '100%',
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            margin: 0,
                            padding: 0,
                        }}
                    />
                </div>
                <style>{`
                    input[type=range]::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        width: 14px;
                        height: 14px;
                        border-radius: 50%;
                        background: #e6edf3;
                        border: 2px solid #30363d;
                        box-shadow: 0 0 0 1px #8b949e;
                    }
                    input[type=range]::-moz-range-thumb {
                        width: 14px;
                        height: 14px;
                        border-radius: 50%;
                        background: #e6edf3;
                        border: 2px solid #30363d;
                        box-shadow: 0 0 0 1px #8b949e;
                    }
                    input[type=range]:focus { outline: none; }
                `}</style>
            </div>

            <div style={{ borderTop: '1px solid #30363d', paddingTop: 12, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 11, color: '#8b949e' }}>
                    <span>LOG</span>
                    <span>{node.logEntries.length} entries</span>
                </div>
                <LogStrip entries={node.logEntries} commitIndex={node.commitIndex} />
            </div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace', fontSize: 13 }}>
            <span style={{ color: '#8b949e' }}>{label}</span>
            <span style={{ color: '#e6edf3' }}>{value}</span>
        </div>
    );
}


function btnStyle(color: string): React.CSSProperties {
    return {
        width: '100%',
        padding: '8px',
        background: 'transparent',
        border: `1px solid ${color}`,
        color: color,
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize: 12,
        cursor: 'pointer',
    };
}
