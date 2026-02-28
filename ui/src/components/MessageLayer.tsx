import { useRaftStore } from '../store/raftStore';
import type { NodePosition } from '../types/raftTypes';
import { messageColors } from '../constants/colors';

interface Props {
    positions: Record<string, NodePosition>;
    nodeRadius: number;
    width: number;
    height: number;
}

export function MessageLayer({ positions, nodeRadius, width, height }: Props) {
    const arrows = useRaftStore(s => s.arrows);
    const messageVisibility = useRaftStore(s => s.messageVisibility);

    return (
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
            width={width} height={height}>
            <defs>
                <marker id="arrow-rv" markerWidth={7} markerHeight={7}
                    refX={6} refY={3.5} orient="auto">
                    <polygon points="0 0, 7 3.5, 0 7" fill="context-stroke" />
                </marker>
                <marker id="arrow-ae" markerWidth={7} markerHeight={7}
                    refX={6} refY={3.5} orient="auto">
                    <polygon points="0 0, 7 3.5, 0 7" fill="context-stroke" />
                </marker>
                    <marker id="arrow-dropped" markerWidth={7} markerHeight={7}
                        refX={6} refY={3.5} orient="auto">
                        <polygon points="0 0, 7 3.5, 0 7" fill={messageColors.Dropped} />
                    </marker>
            </defs>
            {arrows.map(arrow => {
                const from = positions[arrow.fromNodeId];
                const to   = positions[arrow.toNodeId];
                if (!from || !to) return null;

                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const ux = dx / dist;
                const uy = dy / dist;

                const x1 = from.x + ux * (nodeRadius + 4);
                const y1 = from.y + uy * (nodeRadius + 4);
                const x2 = to.x   - ux * (nodeRadius + 12);
                const y2 = to.y   - uy * (nodeRadius + 12);

                const isRV = arrow.messageType === "RequestVote" || arrow.messageType === "RequestVoteResponse";
                const isDropped = arrow.status === 'dropped';

                if (isDropped && !messageVisibility.Dropped) return null;
                if (isRV && !messageVisibility.RequestVote) return null;
                if (!isRV && arrow.isHeartbeat && !messageVisibility.Heartbeat) return null;
                if (!isRV && !arrow.isHeartbeat && !isDropped && !messageVisibility.AppendEntries) return null;

                const strokeColor = isRV ? messageColors.RequestVote 
                        : arrow.isHeartbeat ? messageColors.Heartbeat
                        : messageColors.AppendEntries;

                const kx = x1 + (x2 - x1) * 0.65;
                const ky = y1 + (y2 - y1) * 0.65;
                let px = uy, py = -ux;
                if (py < 0) { px = -px; py = -py; }
                const ex = kx + px * 30;
                const ey = ky + py * 30;

                const opacity = arrow.status === 'dropped' ? 0.8
                            : arrow.status === 'inFlight' ? 1
                            : 0.3;

                return (
                    <g key={arrow.id} opacity={opacity} style={{ transition: 'opacity 0.3s' }}>
                        {arrow.status === 'dropped' ? (
                            <>
                                <path
                                    d={`M ${x1} ${y1} L ${kx} ${ky} L ${ex} ${ey}`}
                                    stroke={messageColors.Dropped}
                                    strokeWidth={1.5}
                                    strokeDasharray="4 3"
                                    fill="none"
                                    markerEnd="url(#arrow-dropped)"
                                />
                                <text x={kx} y={ky - 6} textAnchor="middle"
                                    fontSize={11} fill={messageColors.Dropped}
                                    style={{ userSelect: 'none' }}>✕</text>
                            </>
                        ) : (
                            <line
                                x1={x1} y1={y1} x2={x2} y2={y2}
                                stroke={strokeColor}
                                strokeWidth={arrow.isHeartbeat ? 1 : 2.5}
                                strokeDasharray={arrow.isHeartbeat ? "3 3" : undefined}
                                markerEnd={`url(#arrow-${isRV ? "rv" : "ae"})`}
                            />
                        )}
                    </g>
                );
            })}
        </svg>
    );
}