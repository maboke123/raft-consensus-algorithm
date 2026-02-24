import { useRaftStore } from '../store/raftStore';
import type { NodePosition } from '../types/raftTypes';

interface Props {
    positions: Record<string, NodePosition>;
    nodeRadius: number;
    width: number;
    height: number;
}

export function MessageLayer({ positions, nodeRadius, width, height }: Props) {
    const arrows = useRaftStore(s => s.arrows);

    return (
        <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
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

                const opacity = arrow.status === 'inFlight' ? 1
                              : arrow.status === 'received' ? 0.3
                              : 0.6;

                const isRV = arrow.messageType === "RequestVote" || arrow.messageType === "RequestVoteResponse";
                const strokeColor = isRV ? "#d73a49" : "#0366d6";

                return (
                    <line key={arrow.id}
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={strokeColor}
                        strokeWidth={2}
                        opacity={opacity}
                        markerEnd={`url(#arrow-${isRV ? "rv" : "ae"})`}
                        style={{ transition: 'opacity 0.3s' }}
                    />
                );
            })}
        </svg>
    );
}