/**
 * 思维导图 Store — 适配 React Flow + AI 草稿浮层（铁律 2）。
 */
import { create } from 'zustand';
import {
    type Node,
    type Edge,
    type NodeChange,
    type EdgeChange,
    applyNodeChanges,
    applyEdgeChanges,
} from '@xyflow/react';
import type { MindMapNode, MindMapEdge, MindMapData, MindMapNodeData } from '../types';

// ── 类型 ──

export type FlowNode = Node<MindMapNodeData>;
export type FlowEdge = Edge;

// ── 转换函数 ──

/** 后端 MindMapNode → React Flow Node */
function toFlowNode(n: MindMapNode): FlowNode {
    return {
        id: n.id,
        type: 'mindMapNode',
        position: n.position ?? { x: 0, y: 0 },
        data: { label: n.label, nodeType: n.type },
    };
}

/** 草稿节点：半透明虚线样式 */
function toDraftFlowNode(n: MindMapNode): FlowNode {
    return {
        id: `draft_${n.id}`,
        type: 'mindMapNode',
        position: n.position ?? { x: 0, y: 0 },
        data: { label: n.label, nodeType: n.type },
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
        animated: true,
        style: { stroke: '#a78bfa', strokeWidth: 2, opacity: 0.4, strokeDasharray: '5 5' },
    };
}

/** 后端 MindMapEdge → React Flow Edge */
function toFlowEdge(e: MindMapEdge): FlowEdge {
    return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: true,
        style: { stroke: '#a78bfa', strokeWidth: 2 },
    };
}

// ── Store ──

interface MindMapState {
    nodes: FlowNode[];
    edges: FlowEdge[];
    isGenerating: boolean;
    currentMapId: string | null;
    version: number;

    /** AI 草稿（铁律 2：用户确认前不合入 Yjs） */
    draftNodes: FlowNode[];
    draftEdges: FlowEdge[];
    draftRawNodes: MindMapNode[];
    draftRawEdges: MindMapEdge[];
    hasDraft: boolean;

    /* 批量设置 */
    setMindMapData: (data: MindMapData) => void;

    /* React Flow 回调 */
    onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
    onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;

    /* 增删改 */
    addNode: (node: MindMapNode) => void;
    removeNode: (nodeId: string) => void;
    updateNode: (nodeId: string, updates: Partial<MindMapNode>) => void;
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
}

export const useMindMapStore = create<MindMapState>()((set, get) => ({
    nodes: [],
    edges: [],
    isGenerating: false,
    currentMapId: null,
    version: 0,
    draftNodes: [],
    draftEdges: [],
    draftRawNodes: [],
    draftRawEdges: [],
    hasDraft: false,

    setMindMapData: (data) =>
        set({
            nodes: data.nodes.map(toFlowNode),
            edges: data.edges.map(toFlowEdge),
            currentMapId: data.id,
            version: data.version,
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
                        data: {
                            ...n.data,
                            ...(updates.label !== undefined
                                ? { label: updates.label }
                                : {}),
                            ...(updates.type !== undefined
                                ? { nodeType: updates.type }
                                : {}),
                        },
                    }
                    : n
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

    /** 设置 AI 草稿（半透明预览，不写入 Yjs） */
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
        const { draftRawNodes, draftRawEdges } = get();
        const rawNodes = [...draftRawNodes];
        const rawEdges = [...draftRawEdges];

        set((s) => ({
            nodes: [...s.nodes, ...draftRawNodes.map(toFlowNode)],
            edges: [...s.edges, ...draftRawEdges.map(toFlowEdge)],
            draftNodes: [],
            draftEdges: [],
            draftRawNodes: [],
            draftRawEdges: [],
            hasDraft: false,
        }));

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
            version: 0,
            draftNodes: [],
            draftEdges: [],
            draftRawNodes: [],
            draftRawEdges: [],
            hasDraft: false,
        }),
}));
