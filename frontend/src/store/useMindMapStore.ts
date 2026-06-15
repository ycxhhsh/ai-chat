/**
 * 思维导图 Store — 适配 React Flow + AI 草稿浮层（铁律 2）。
 */
import { create } from 'zustand';
import { api } from '../api';
import {
    type Node,
    type Edge,
    type NodeChange,
    type EdgeChange,
    applyNodeChanges,
    applyEdgeChanges,
    MarkerType,
} from '@xyflow/react';
import type { MindMapNode, MindMapEdge, MindMapData, MindMapNodeData } from '../types';

// ── 类型 ──

export type FlowNode = Node<MindMapNodeData>;
export type FlowEdge = Edge;

// ── 转换函数 ──

/** 后端 MindMapNode → React Flow Node */
function toFlowNode(n: MindMapNode & { source_message_id?: string; source_message_ids?: string[] }): FlowNode {
    // 兼容旧的 source_message_id (string) 和新的 source_message_ids (array)
    const ids: string[] = n.source_message_ids
        ?? (n.source_message_id ? [n.source_message_id] : []);
    const base: FlowNode = {
        id: n.id,
        type: 'mindMapNode',
        position: n.position ?? { x: 0, y: 0 },
        data: {
            label: n.label,
            nodeType: n.type,
            ...(ids.length > 0 ? { source_message_ids: ids } : {}),
            ...(n.source_students?.length ? { source_students: n.source_students } : {}),
        },
    };
    if (n.type === 'suggestion') {
        base.style = {
            opacity: 0.65,
            border: '2px dashed #a78bfa',
            borderRadius: '12px',
        };
    }
    return base;
}

/** 草稿节点：半透明虚线样式 */
function toDraftFlowNode(n: MindMapNode): FlowNode {
    const ids: string[] = n.source_message_ids
        ?? (n.source_message_id ? [n.source_message_id] : []);
    return {
        id: `draft_${n.id}`,
        type: 'mindMapNode',
        position: n.position ?? { x: 0, y: 0 },
        data: {
            label: n.label,
            nodeType: n.type,
            ...(ids.length > 0 ? { source_message_ids: ids } : {}),
            ...(n.source_students?.length ? { source_students: n.source_students } : {}),
        },
        style: { opacity: 0.5, border: '2px dashed #a78bfa' },
        draggable: false,
        selectable: false,
    };
}

/** 草稿边：半透明虚线样式 */
function toDraftFlowEdge(e: MindMapEdge): FlowEdge {
    return {
        id: `draft_${e.id}`,
        source: `draft_${e.source}`,
        target: `draft_${e.target}`,
        label: e.label,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#a78bfa', strokeWidth: 1.5, opacity: 0.4, strokeDasharray: '5 5' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#a78bfa' },
    };
}

/** 后端 MindMapEdge → React Flow Edge */
function toFlowEdge(e: MindMapEdge): FlowEdge {
    return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        type: 'default',
        animated: false,
        style: { stroke: '#a78bfa', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#a78bfa' },
    };
}

function toRawNode(n: FlowNode): MindMapNode {
    return {
        id: n.id,
        label: n.data.label,
        type: n.data.nodeType,
        position: n.position,
        ...(n.data.source_message_ids ? { source_message_ids: n.data.source_message_ids } : {}),
        ...(n.data.source_students ? { source_students: n.data.source_students } : {}),
    };
}

function toRawEdge(e: FlowEdge): MindMapEdge {
    return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: String(e.label || ''),
    };
}

// ── Store ──

interface MindMapState {
    nodes: FlowNode[];
    edges: FlowEdge[];
    isGenerating: boolean;
    currentMapId: string | null;
    currentMapKey: string | null;
    version: number;

    /** AI 草稿（铁律 2：用户确认前不合入 Yjs） */
    draftNodes: FlowNode[];
    draftEdges: FlowEdge[];
    draftRawNodes: MindMapNode[];
    draftRawEdges: MindMapEdge[];
    hasDraft: boolean;

    /** Sprint 5: 切换不丢失的内存缓存 */
    mapCache: Map<string, { nodes: FlowNode[]; edges: FlowEdge[]; mapId: string | null; version: number }>;

    /* 批量设置 */
    setMindMapData: (data: MindMapData) => void;

    /* React Flow 回调 */
    onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
    onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;

    /* 增删改 */
    addNode: (node: MindMapNode & { source_message_id?: string; source_message_ids?: string[] }) => void;
    removeNode: (nodeId: string) => void;
    updateNode: (nodeId: string, updates: Partial<MindMapNode>) => void;
    updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
    addEdge: (edge: MindMapEdge) => void;
    removeEdge: (edgeId: string) => void;
    updateEdgeLabel: (edgeId: string, label: string) => void;

    /* 草稿操作 */
    setDraft: (nodes: MindMapNode[], edges: MindMapEdge[]) => void;
    acceptDraft: () => { nodes: MindMapNode[]; edges: MindMapEdge[] };
    rejectDraft: () => void;

    /* UI */
    setIsGenerating: (generating: boolean) => void;
    clearMindMap: () => void;

    /* 导出 & 上下文 */
    exportAsMarkdown: () => string;
    serializeAsContext: () => string;

    /* 分区加载 */
    loadMindMap: (mapKey: string) => Promise<void>;
}

export const useMindMapStore = create<MindMapState>()((set, get) => ({
    nodes: [],
    edges: [],
    isGenerating: false,
    currentMapId: null,
    currentMapKey: null,
    version: 0,
    draftNodes: [],
    draftEdges: [],
    draftRawNodes: [],
    draftRawEdges: [],
    hasDraft: false,
    mapCache: new Map(),

    setMindMapData: (data) =>
        set((s) => {
            const flowNodes = data.nodes.map(toFlowNode);
            const flowEdges = data.edges.map(toFlowEdge);
            const mapKey = data.map_key || s.currentMapKey;
            if (mapKey) {
                s.mapCache.set(mapKey, {
                    nodes: flowNodes,
                    edges: flowEdges,
                    mapId: data.id,
                    version: data.version,
                });
            }
            return {
                nodes: flowNodes,
                edges: flowEdges,
                currentMapId: data.id,
                currentMapKey: mapKey,
                version: data.version,
            };
        }),

    onNodesChange: (changes) =>
        set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),

    onEdgesChange: (changes) =>
        set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

    addNode: (node) =>
        set((s) => ({ nodes: [...s.nodes, toFlowNode(node)] })),

    removeNode: (nodeId) =>
        set((s) => ({
            nodes: s.nodes.filter((n) => n.id !== nodeId),
            edges: s.edges.filter(
                (e) => e.source !== nodeId && e.target !== nodeId
            ),
        })),

    updateNode: (nodeId, updates) =>
        set((s) => ({
            nodes: s.nodes.map((n) =>
                n.id === nodeId
                    ? {
                        ...n,
                        ...(updates.position !== undefined
                            ? { position: updates.position }
                            : {}),
                        data: {
                            ...n.data,
                            ...(updates.label !== undefined
                                ? { label: updates.label }
                                : {}),
                            ...(updates.type !== undefined
                                ? { nodeType: updates.type }
                                : {}),
                            ...(updates.source_message_ids !== undefined
                                ? { source_message_ids: updates.source_message_ids }
                                : {}),
                            ...(updates.source_students !== undefined
                                ? { source_students: updates.source_students }
                                : {}),
                        },
                    }
                    : n
            ),
        })),

    updateNodePosition: (nodeId, position) =>
        set((s) => ({
            nodes: s.nodes.map((n) =>
                n.id === nodeId ? { ...n, position } : n
            ),
        })),

    addEdge: (edge) =>
        set((s) => ({ edges: [...s.edges, toFlowEdge(edge)] })),

    removeEdge: (edgeId) =>
        set((s) => ({
            edges: s.edges.filter((e) => e.id !== edgeId),
        })),

    updateEdgeLabel: (edgeId, label) =>
        set((s) => ({
            edges: s.edges.map((e) =>
                e.id === edgeId ? { ...e, label } : e
            ),
        })),

    /** 设置 AI 草稿（半透明预览，不写入 Yjs）。
     *  保留现有节点，追加显示草稿预览。
     */
    setDraft: (nodes, edges) =>
        set({
            draftNodes: nodes.map(toDraftFlowNode),
            draftEdges: edges.map(toDraftFlowEdge),
            draftRawNodes: nodes,
            draftRawEdges: edges,
            hasDraft: true,
        }),

    /** 采纳草稿 → 合入主文档（返回原始数据供 WS 发送） */
    acceptDraft: () => {
        const { nodes, edges, draftRawNodes, draftRawEdges } = get();
        const existingNodeIds = new Set(nodes.map((n) => n.id));
        const existingEdgeIds = new Set(edges.map((e) => e.id));
        const idMap = new Map<string, string>();
        const stamp = Date.now();
        const safeDraftNodes = draftRawNodes.map((node, idx) => {
            const nextId = node.id && !existingNodeIds.has(node.id)
                ? node.id
                : `n-${stamp}-${idx}`;
            existingNodeIds.add(nextId);
            idMap.set(node.id, nextId);
            return { ...node, id: nextId };
        });
        const safeDraftEdges = draftRawEdges
            .map((edge, idx) => {
                const source = idMap.get(edge.source) || edge.source;
                const target = idMap.get(edge.target) || edge.target;
                if (!existingNodeIds.has(source) || !existingNodeIds.has(target)) {
                    return null;
                }
                const nextId = edge.id && !existingEdgeIds.has(edge.id)
                    ? edge.id
                    : `e-${stamp}-${idx}`;
                existingEdgeIds.add(nextId);
                return { ...edge, id: nextId, source, target };
            })
            .filter((edge): edge is MindMapEdge => edge !== null);
        const mergedNodes = [...nodes, ...safeDraftNodes.map(toFlowNode)];
        const mergedEdges = [...edges, ...safeDraftEdges.map(toFlowEdge)];
        const rawNodes = mergedNodes.map(toRawNode);
        const rawEdges = mergedEdges.map(toRawEdge);

        set((s) => {
            // Sprint 5: 采纳后同步更新 mapCache
            if (s.currentMapKey) {
                s.mapCache.set(s.currentMapKey, {
                    nodes: mergedNodes,
                    edges: mergedEdges,
                    mapId: s.currentMapId,
                    version: s.version + 1,
                });
            }
            return {
                nodes: mergedNodes,
                edges: mergedEdges,
                version: s.version + 1,
                draftNodes: [],
                draftEdges: [],
                draftRawNodes: [],
                draftRawEdges: [],
                hasDraft: false,
            };
        });

        return { nodes: rawNodes, edges: rawEdges };
    },

    /** 放弃草稿 */
    rejectDraft: () =>
        set({
            draftNodes: [],
            draftEdges: [],
            draftRawNodes: [],
            draftRawEdges: [],
            hasDraft: false,
        }),

    setIsGenerating: (generating) => set({ isGenerating: generating }),

    clearMindMap: () =>
        set({
            nodes: [],
            edges: [],
            currentMapId: null,
            currentMapKey: null,
            version: 0,
            draftNodes: [],
            draftEdges: [],
            draftRawNodes: [],
            draftRawEdges: [],
            hasDraft: false,
        }),

    loadMindMap: async (mapKey: string) => {
        const state = get();
        if (state.currentMapKey === mapKey) return;

        // Sprint 5: 切换前保存当前状态到缓存
        if (state.currentMapKey && state.nodes.length > 0) {
            state.mapCache.set(state.currentMapKey, {
                nodes: state.nodes,
                edges: state.edges,
                mapId: state.currentMapId,
                version: state.version,
            });
        }

        // Sprint 5: 先查缓存，命中直接恢复
        const cached = state.mapCache.get(mapKey);
        if (cached) {
            set({
                nodes: cached.nodes,
                edges: cached.edges,
                currentMapId: cached.mapId,
                currentMapKey: mapKey,
                version: cached.version,
                draftNodes: [],
                draftEdges: [],
                draftRawNodes: [],
                draftRawEdges: [],
                hasDraft: false,
            });
            return;
        }

        // 未命中缓存，清空并调 API
        set({
            nodes: [],
            edges: [],
            currentMapId: null,
            currentMapKey: mapKey,
            version: 0,
            draftNodes: [],
            draftEdges: [],
            draftRawNodes: [],
            draftRawEdges: [],
            hasDraft: false,
        });
        try {
            const data = await api.mindmaps.get(mapKey);
            if (data && data.nodes && data.nodes.length > 0 && get().currentMapKey === mapKey) {
                const flowNodes = data.nodes.map(toFlowNode);
                const flowEdges = data.edges.map(toFlowEdge);
                set({
                    nodes: flowNodes,
                    edges: flowEdges,
                    currentMapId: data.id || null,
                    version: data.version || 0,
                });
                // 存入缓存
                get().mapCache.set(mapKey, {
                    nodes: flowNodes,
                    edges: flowEdges,
                    mapId: data.id || null,
                    version: data.version || 0,
                });
            }
        } catch (e) {
            console.error('Load mindmap failed:', e);
        }
    },

    /** 导出 Markdown 大纲 */
    exportAsMarkdown: () => {
        const { nodes, edges } = get();
        if (nodes.length === 0) return '';

        // Build adjacency: parent → children
        const children = new Map<string, string[]>();
        const hasParent = new Set<string>();
        for (const e of edges) {
            const list = children.get(e.source) || [];
            list.push(e.target);
            children.set(e.source, list);
            hasParent.add(e.target);
        }

        // Find roots
        const roots = nodes.filter((n) => !hasParent.has(n.id));
        if (roots.length === 0) roots.push(nodes[0]);

        // Edge labels map
        const edgeLabel = new Map<string, string>();
        for (const e of edges) {
            edgeLabel.set(`${e.source}->${e.target}`, (e.label as string) || '');
        }

        // Node map
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

        // DFS build markdown
        const lines: string[] = ['# 思维导图大纲\n'];
        const visited = new Set<string>();

        const typeEmoji: Record<string, string> = {
            concept: '📌', argument: '💬', evidence: '📎',
            question: '❓', suggestion: '💡',
        };

        function dfs(nodeId: string, depth: number, relLabel?: string) {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);
            const node = nodeMap.get(nodeId);
            if (!node) return;
            const d = node.data;
            const emoji = typeEmoji[d.nodeType] || '•';
            const indent = '  '.repeat(depth);
            const rel = relLabel ? ` _(${relLabel})_` : '';
            const suffix = d.nodeType === 'suggestion' ? ' 🔍' : '';
            lines.push(`${indent}- ${emoji} **${d.label}**${rel}${suffix}`);
            for (const childId of children.get(nodeId) || []) {
                const el = edgeLabel.get(`${nodeId}->${childId}`) || '';
                dfs(childId, depth + 1, el);
            }
        }

        for (const root of roots) dfs(root.id, 0);

        // Add unvisited nodes
        const unvisited = nodes.filter((n) => !visited.has(n.id));
        if (unvisited.length > 0) {
            lines.push('\n## 其他节点\n');
            for (const n of unvisited) {
                const emoji = typeEmoji[n.data.nodeType] || '•';
                lines.push(`- ${emoji} **${n.data.label}**`);
            }
        }

        return lines.join('\n');
    },

    /** 序列化为结构化上下文文本 */
    serializeAsContext: () => {
        const { nodes, edges } = get();
        if (nodes.length === 0) return '';
        const nodeLines = nodes.map((n) => `[${n.data.nodeType}] ${n.data.label}`).join('\n');
        const edgeLines = edges.map((e) => {
            const src = nodes.find((n) => n.id === e.source);
            const tgt = nodes.find((n) => n.id === e.target);
            return `${src?.data.label || '?'} --${(e.label as string) || '相关'}--> ${tgt?.data.label || '?'}`;
        }).join('\n');
        return `当前思维导图结构：\n\n节点：\n${nodeLines}\n\n关系：\n${edgeLines}`;
    },
}));
