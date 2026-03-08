import { useRaftStore } from '../store/raftStore';
import type { NodePosition } from '../types/raftTypes';
import { roleColors } from '../constants/colors';

interface Props {
    positions: Record<string, NodePosition>;
    nodeRadius: number;
    width: number;
    height: number;
}

export function NodeLayer({ positions, nodeRadius, width, height }: Props) {
    const nodeIds = useRaftStore((state) => state.nodeIds);
    const nodes = useRaftStore((state) => state.nodes);
    const selectNode = useRaftStore((state) => state.selectNode);
    const selectedNodeId = useRaftStore((state) => state.selectedNodeId);
    const snapshottingNodes = useRaftStore((state) => state.snapshottingNodes);
    const installingSnapshotNodes = useRaftStore((state) => state.installingSnapshotNodes);
    const pendingConfigChange = useRaftStore((state) => state.pendingConfigChange);

    return (
        <svg width={width} height={height} style={{ display: 'block', position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
            {nodeIds.map(id => {
                const { x, y } = positions[id];
                const node = nodes[id];
                const isCrashed = node?.crashed ?? false;
                const isLearner = node?.isLearner ?? false;

                const color = isCrashed
                    ? roleColors.Crashed 
                    : isLearner
                        ? roleColors.Learner
                        : (node ? roleColors[node.role] : "#161b22");

                return (
                    <g key={id} onClick={() => selectNode(selectedNodeId === id ? null : id)}
                        style={{ cursor: 'pointer', pointerEvents: 'all' }}>

                        {snapshottingNodes.has(id) && (
                            <circle cx={x} cy={y} r={nodeRadius + 10} fill="none" stroke={roleColors.TakingSnapshot} strokeWidth={3} />
                        )}
                        {installingSnapshotNodes.has(id) && (
                            <circle cx={x} cy={y} r={nodeRadius + 10} fill="none" stroke={roleColors.InstallingSnapshot} strokeWidth={3} />
                        )}

                        {isLearner && !isCrashed && (
                            <circle
                                cx={x} cy={y}
                                r={nodeRadius + 6}
                                fill="none"
                                stroke={roleColors.Learner}
                                strokeWidth={1.5}
                                strokeDasharray="4 3"
                                opacity={0.7}
                            />
                        )}

                        {pendingConfigChange && !isCrashed && (
                            <circle
                                cx={x} cy={y}
                                r={nodeRadius + 14}
                                fill="none"
                                stroke="#e3b341"
                                strokeWidth={1}
                                opacity={0.3}
                                strokeDasharray="2 4"
                            />
                        )}

                        <circle cx={x} cy={y} r={nodeRadius} fill="#161b22" stroke={color} strokeWidth={2} opacity={isCrashed ? 0.4 : 1} />
                        <text x={x} y={y - 10} textAnchor="middle" dominantBaseline="middle"
                            fill={isCrashed ? roleColors.Crashed : "#e6edf3"} fontSize={12} fontFamily="monospace">
                            {id}
                        </text>
                        <text x={x} y={y + 5} textAnchor="middle" dominantBaseline="middle"
                            fill={color} fontSize={9} fontFamily="monospace">
                            {isCrashed ? 'Crashed' : isLearner ? 'Learner' : (node?.role ?? '—')}
                        </text>
                        {selectedNodeId === id && (
                            <circle cx={x} cy={y} r={nodeRadius + 6} fill="none" stroke="#e6edf3" strokeWidth={2} />
                        )}
                    </g>
                );
            })}
        </svg>
    );
}