/**
 * 思维导图布局引擎
 * 三种布局算法：树状 (dagre)、放射状、力导向
 * 灵感来自 Neo4j 图可视化
 */
import dagre from '@dagrejs/dagre';
import type { FlowNode, FlowEdge } from '../../store/useMindMapStore';

export type LayoutType = 'tree' | 'radial' | 'force';

export interface LayoutOption {
    type: LayoutType;
    label: string;
    icon: string;
    description: string;
}

export const LAYOUT_OPTIONS: LayoutOption[] = [
    { type: 'tree', label: '树状布局', icon: '🌳', description: '层级分明的树形结构' },
    { type: 'radial', label: '放射布局', icon: '🎯', description: '中心辐射的放射结构' },
    { type: 'force', label: '力导向', icon: '⚡', description: '自动均衡的力导向布局' },
];

// ── 通用工具 ──

/** 估算节点宽度（根据文本长度） */
function estimateNodeWidth(label: string): number {
    const charWidth = 8;
    const padding = 48;
    return Math.min(280, Math.max(140, label.length * charWidth + padding));
}

function estimateNodeHeight(label: string): number {
    return label.length > 25 ? 100 : 80;
}

/** 找到根节点（入度为0的，如果没有就选第一个） */
function findRootId(nodes: FlowNode[], edges: FlowEdge[]): string {
    const hasIncoming = new Set(edges.map(e => e.target));
    const root = nodes.find(n => !hasIncoming.has(n.id));
    return root?.id || nodes[0]?.id || '';
}



// ── 1. 树状布局 (Dagre) ──

function layoutTree(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
    if (nodes.length === 0) return nodes;

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
        rankdir: 'LR',
        nodesep: 90,
        ranksep: 130,
        edgesep: 40,
        align: 'UL',
        acyclicer: 'greedy',
    });

    const sizes = new Map<string, { w: number; h: number }>();
    nodes.forEach(node => {
        const label = (node.data as any)?.label || '';
        const w = estimateNodeWidth(label);
        const h = estimateNodeHeight(label);
        sizes.set(node.id, { w, h });
        g.setNode(node.id, { width: w, height: h });
    });

    edges.forEach(edge => {
        g.setEdge(edge.source, edge.target, { weight: 2, minlen: 1 });
    });

    dagre.layout(g);

    return nodes.map(node => {
        const pos = g.node(node.id);
        const sz = sizes.get(node.id)!;
        return {
            ...node,
            position: { x: pos.x - sz.w / 2, y: pos.y - sz.h / 2 },
        };
    });
}

// ── 2. 放射状布局 ──

function layoutRadial(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
    if (nodes.length === 0) return nodes;
    if (nodes.length === 1) return [{ ...nodes[0], position: { x: 0, y: 0 } }];

    const rootId = findRootId(nodes, edges);
    // 也构建无向邻接用于 BFS
    const undirected = new Map<string, Set<string>>();
    for (const n of nodes) undirected.set(n.id, new Set());
    for (const e of edges) {
        undirected.get(e.source)?.add(e.target);
        undirected.get(e.target)?.add(e.source);
    }

    // BFS 分层
    const levels = new Map<string, number>();
    const children = new Map<string, string[]>();
    const queue: string[] = [rootId];
    levels.set(rootId, 0);
    children.set(rootId, []);

    while (queue.length > 0) {
        const current = queue.shift()!;
        const neighbors = undirected.get(current) || new Set();
        const childList: string[] = [];
        for (const nb of neighbors) {
            if (!levels.has(nb)) {
                levels.set(nb, levels.get(current)! + 1);
                children.set(nb, []);
                childList.push(nb);
                queue.push(nb);
            }
        }
        children.set(current, childList);
    }

    // 处理孤立节点
    for (const n of nodes) {
        if (!levels.has(n.id)) {
            levels.set(n.id, 1);
            children.set(n.id, []);
        }
    }

    const maxLevel = Math.max(...levels.values(), 0);
    const ringSpacing = 140; // 每层半径增量（紧凑）

    // 计算每层节点数
    const levelNodes = new Map<number, string[]>();
    for (const [id, lvl] of levels) {
        if (!levelNodes.has(lvl)) levelNodes.set(lvl, []);
        levelNodes.get(lvl)!.push(id);
    }

    // 为每层节点分配角度
    const positions = new Map<string, { x: number; y: number }>();
    const cx = 0, cy = 0;

    // 根节点在中心
    positions.set(rootId, { x: cx, y: cy });

    // 递归分配子树角度范围
    function countDescendants(nodeId: string): number {
        const kids = children.get(nodeId) || [];
        if (kids.length === 0) return 1;
        return kids.reduce((sum, kid) => sum + countDescendants(kid), 0);
    }

    function assignPositions(nodeId: string, startAngle: number, endAngle: number, level: number) {
        const kids = children.get(nodeId) || [];
        if (kids.length === 0) return;

        const radius = ringSpacing * level;
        const totalDescendants = kids.reduce((s, k) => s + countDescendants(k), 0);
        let currentAngle = startAngle;

        for (const kid of kids) {
            const weight = countDescendants(kid);
            const sweep = (endAngle - startAngle) * (weight / totalDescendants);
            const midAngle = currentAngle + sweep / 2;

            positions.set(kid, {
                x: cx + radius * Math.cos(midAngle),
                y: cy + radius * Math.sin(midAngle),
            });

            assignPositions(kid, currentAngle, currentAngle + sweep, level + 1);
            currentAngle += sweep;
        }
    }

    assignPositions(rootId, 0, 2 * Math.PI, 1);

    // 处理未分配位置的节点（孤立）
    let orphanAngle = 0;
    for (const n of nodes) {
        if (!positions.has(n.id)) {
            const r = ringSpacing * (maxLevel + 1);
            positions.set(n.id, {
                x: cx + r * Math.cos(orphanAngle),
                y: cy + r * Math.sin(orphanAngle),
            });
            orphanAngle += Math.PI / 4;
        }
    }

    return nodes.map(node => ({
        ...node,
        position: positions.get(node.id) || { x: 0, y: 0 },
    }));
}

// ── 3. 力导向布局 (自实现 Fruchterman-Reingold) ──

function layoutForce(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
    if (nodes.length === 0) return nodes;
    if (nodes.length === 1) return [{ ...nodes[0], position: { x: 0, y: 0 } }];

    const N = nodes.length;
    const area = N * 25000; // 紧凑画布面积（neo4j 风格）
    const k = Math.sqrt(area / N); // 理想间距
    const iterations = 100; // 更多迭代以收敛

    // 初始化位置：圆形分布（避免初始重叠）
    const pos: { x: number; y: number }[] = nodes.map((_, i) => ({
        x: k * 2 * Math.cos((2 * Math.PI * i) / N),
        y: k * 2 * Math.sin((2 * Math.PI * i) / N),
    }));

    const idxMap = new Map(nodes.map((n, i) => [n.id, i]));

    // 解析边为索引对
    const edgePairs = edges
        .map(e => [idxMap.get(e.source), idxMap.get(e.target)])
        .filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined);

    for (let iter = 0; iter < iterations; iter++) {
        const temperature = k * (1 - iter / iterations) * 0.5;
        const disp: { x: number; y: number }[] = pos.map(() => ({ x: 0, y: 0 }));

        // 斥力（所有节点对）
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                let dx = pos[i].x - pos[j].x;
                let dy = pos[i].y - pos[j].y;
                const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
                const force = (k * k) / dist; // 斥力 = k² / dist
                dx = (dx / dist) * force;
                dy = (dy / dist) * force;
                disp[i].x += dx;
                disp[i].y += dy;
                disp[j].x -= dx;
                disp[j].y -= dy;
            }
        }

        // 引力（边连接的节点对）
        for (const [si, ti] of edgePairs) {
            let dx = pos[si].x - pos[ti].x;
            let dy = pos[si].y - pos[ti].y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
            const force = (dist * dist) / k; // 引力 = dist² / k
            dx = (dx / dist) * force;
            dy = (dy / dist) * force;
            disp[si].x -= dx;
            disp[si].y -= dy;
            disp[ti].x += dx;
            disp[ti].y += dy;
        }

        // 中心引力（neo4j 风格：防止节点飞散）
        const gravity = 0.05;
        for (let i = 0; i < N; i++) {
            disp[i].x -= pos[i].x * gravity;
            disp[i].y -= pos[i].y * gravity;
        }

        // 应用位移（受温度限制）
        for (let i = 0; i < N; i++) {
            const d = Math.sqrt(disp[i].x * disp[i].x + disp[i].y * disp[i].y);
            if (d > 0) {
                const scale = Math.min(d, temperature) / d;
                pos[i].x += disp[i].x * scale;
                pos[i].y += disp[i].y * scale;
            }
        }
    }

    // 节点防重叠：推开过近的节点
    const minDist = 120; // 更紧凑的最小距离
    for (let pass = 0; pass < 5; pass++) {
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const dx = pos[i].x - pos[j].x;
                const dy = pos[i].y - pos[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < minDist && dist > 0) {
                    const push = (minDist - dist) / 2;
                    const nx = (dx / dist) * push;
                    const ny = (dy / dist) * push;
                    pos[i].x += nx;
                    pos[i].y += ny;
                    pos[j].x -= nx;
                    pos[j].y -= ny;
                }
            }
        }
    }

    return nodes.map((node, i) => ({
        ...node,
        position: { x: pos[i].x, y: pos[i].y },
    }));
}

// ── 导出统一接口 ──

export function applyLayout(
    type: LayoutType,
    nodes: FlowNode[],
    edges: FlowEdge[],
): FlowNode[] {
    switch (type) {
        case 'tree': return layoutTree(nodes, edges);
        case 'radial': return layoutRadial(nodes, edges);
        case 'force': return layoutForce(nodes, edges);
        default: return layoutTree(nodes, edges);
    }
}
