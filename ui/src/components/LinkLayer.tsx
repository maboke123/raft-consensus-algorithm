import { useRaftStore } from '../store/raftStore';
import type { NodePosition } from '../types/raftTypes';

interface Props {
    positions: Record<string, NodePosition>;
    nodeIds: string[];
    width: number;
    height: number;
    nodeRadius: number;
}

export function LinkLayer({ positions, nodeIds, width, height, nodeRadius }: Props) {
    const isLinkCut = useRaftStore((state) => state.isLinkCut);
    const cutLinks = useRaftStore((state) => state.cutLinks);
    const cutLink = useRaftStore((state) => state.cutLink);
    const healLink = useRaftStore((state) => state.healLink);
    const healAllLinks = useRaftStore((state) => state.healAllLinks);

    return (
        <>
        <svg style={{ position: 'absolute', inset: 0, zIndex: 0 }} width={width} height={height}>
                {nodeIds.flatMap((a, i) =>
                    nodeIds.slice(i + 1).map(b => {
                        const pa = positions[a];
                        const pb = positions[b];
                        const cut = isLinkCut(a, b);

                        const dx = pb.x - pa.x;
                        const dy = pb.y - pa.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const ux = dx / dist;
                        const uy = dy / dist;
                        const x1 = pa.x + ux * nodeRadius;
                        const y1 = pa.y + uy * nodeRadius;
                        const x2 = pb.x - ux * nodeRadius;
                        const y2 = pb.y - uy * nodeRadius;

                        return (
                            <g key={`${a}-${b}`} style={{ cursor:'pointer'}}>
                                <line
                                    x1={x1} y1={y1} x2={x2} y2={y2}
                                    stroke={cut ? "#ef4444" : "#ffffff"}
                                    strokeWidth={cut ? 2 : 1}
                                    strokeDasharray={cut ? "6 4" : undefined}
                                    opacity={cut ? 0.6 : 0.04}
                                    style={{ pointerEvents: 'none' }}
                                />
                                <line
                                    x1={x1} y1={y1} x2={x2} y2={y2}
                                    stroke="transparent"
                                    strokeWidth={20}
                                    style={{ pointerEvents: 'stroke' }}
                                    onClick={() => cut ? healLink(a, b) : cutLink(a, b)}
                                />
                            </g>
                        );
                    })
                )}
            </svg>
            {cutLinks.size > 0 && (
                <button
                    onClick={healAllLinks}
                    style={{
                        position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                        background: 'transparent', border: '1px solid #ef4444', color: '#ef4444',
                        padding: '6px 16px', borderRadius: 6, fontFamily: 'monospace',
                        fontSize: 12, cursor: 'pointer', zIndex: 10,
                    }}
                >
                    heal all links
                </button>
            )}
        </>
    );
}