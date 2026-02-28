import { useEffect, useRef, useState } from "react";
import { useRaftStore } from "../store/raftStore";
import { MessageLayer } from "./MessageLayer";
import { LinkLayer } from "./LinkLayer";
import { NodeLayer } from "./NodeLayer";

function computePositionsCircle(nodeIds: string[], radius: number, centerX: number, centerY: number) {
    const positions: Record<string, { x: number; y: number }> = {};
    nodeIds.forEach((id, index) => {
        const angle = (2 * Math.PI * index) / nodeIds.length - Math.PI / 2;
        positions[id] = {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle),
        };
    });
    return positions;
}

const nodeRadius = 30;

export function ClusterView() {
    const nodeIds = useRaftStore((state) => state.nodeIds);
    const containerRef = useRef<HTMLDivElement>(null);
    const [ size, setSize ] = useState({ width: 800, height: 600 });

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;
        const ro = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            setSize({ width, height });
        });
        ro.observe(element);
        return () => ro.disconnect();
    }, []);

    const cx = size.width / 2;
    const cy = size.height / 2;
    const radius = Math.min(cx, cy) * 0.6;
    const positions = computePositionsCircle(nodeIds, radius, cx, cy);

    return (
        <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', background: '#0d1117' }}>
            <LinkLayer positions={positions} nodeIds={nodeIds} width={size.width} height={size.height} nodeRadius={nodeRadius} />
            <NodeLayer positions={positions} nodeRadius={nodeRadius} width={size.width} height={size.height} />
            <MessageLayer positions={positions} nodeRadius={nodeRadius} width={size.width} height={size.height} />
        </div>
    );
}