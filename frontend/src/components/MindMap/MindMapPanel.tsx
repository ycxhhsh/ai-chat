/**
 * 思维导图面板 — React Flow 交互式版本。
 * 支持：dagre 自动布局、拖拽、缩放、双击编辑、MiniMap、Controls。
 * Sprint 2: Chat-Canvas Bridge（拖放建图、溯源、快捷工具栏）。
 */
import React, {
    useCallback,
    useState,
    useEffect,
    useRef,
    useMemo,
    Component,
    type ErrorInfo,
    type ReactNode,
} from 'react';
import { createContext, useContext } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    Controls,
    MiniMap,
    Background,
    BackgroundVariant,
    Handle,
    Position,
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    MarkerType,
    NodeToolbar,
    type NodeProps,
    type EdgeProps,
    type Node,
    type Connection,
} from '@xyflow/react';
import { useEdges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';  // @ts-ignore css import
import { useMindMapStore, type FlowEdge } from '../../store/useMindMapStore';
import { useChatStore } from '../../store/useChatStore';
import type { MindMapNodeData, MindMapNodeType, MindMapQualityHint, MindMapSourceStudent } from '../../types';
import { Loader2, Sparkles, Plus, Download, MessageCircle, ChevronDown, LayoutGrid, Search, Maximize2, Minimize2, CircleAlert } from 'lucide-react';
import { DraftOverlay } from './DraftOverlay';
import { applyLayout, LAYOUT_OPTIONS, type LayoutType } from './layoutEngine';
import { toPng, toSvg } from 'html-to-image';
import clsx from 'clsx';

// ── Neo4j 风格色彩（实心填充 + 白色文字） ──

const NODE_STYLES: Record<MindMapNodeType, { bg: string; ring: string; text: string }> = {
    concept: { bg: '#6366f1', ring: '#818cf8', text: '#ffffff' },  // 紫
    argument: { bg: '#f59e0b', ring: '#fbbf24', text: '#ffffff' },  // 琥珀
    evidence: { bg: '#10b981', ring: '#34d399', text: '#ffffff' },  // 绿
    question: { bg: '#ef4444', ring: '#f87171', text: '#ffffff' },  // 红
    suggestion: { bg: '#8b5cf6', ring: '#a78bfa', text: '#ffffff' },  // 深紫
};

const NODE_EMOJIS: Record<MindMapNodeType, string> = {
    concept: '💡', argument: '💬', evidence: '📎',
    question: '❓', suggestion: '🔍',
};

// ── 边颜色映射（按 label 关键字） ──

const EDGE_COLORS: Record<string, string> = {
    '导致': '#f59e0b',   // 琥珀
    '原因': '#f59e0b',
    '包含': '#6366f1',   // 紫
    '组成': '#6366f1',
    '支撑': '#10b981',   // 绿
    '依据': '#10b981',
    '反驳': '#ef4444',   // 红
    '矛盾': '#ef4444',
    '关系': '#94a3b8',   // 灰
};

function getEdgeColor(label: string | undefined): string {
    if (!label) return '#a78bfa';
    for (const [key, color] of Object.entries(EDGE_COLORS)) {
        if (label.includes(key)) return color;
    }
    return '#a78bfa'; // 默认紫
}

// ── Hover 高亮上下文 ──

const HoverContext = createContext<{
    hoveredNodeId: string | null;
    neighborIds: Set<string>;
    neighborEdgeIds: Set<string>;
}>({ hoveredNodeId: null, neighborIds: new Set(), neighborEdgeIds: new Set() });

const EditSyncContext = createContext<{
    sync: (operation: string, payload: Record<string, unknown>) => void;
}>({ sync: () => undefined });

// ── ErrorBoundary ──

interface EBState { hasError: boolean; error: string }

class MindMapErrorBoundary extends Component<{ children: ReactNode }, EBState> {
    state: EBState = { hasError: false, error: '' };

    static getDerivedStateFromError(error: Error): EBState {
        return { hasError: true, error: error.message };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[MindMap] Render error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm p-4">
                    <p className="mb-2">思维导图组件加载失败</p>
                    <p className="text-xs text-gray-300">{this.state.error}</p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: '' })}
                        className="mt-3 px-3 py-1.5 text-xs bg-gray-100 rounded-lg hover:bg-gray-200"
                    >
                        重试
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}




/** 计算共享同一对端点的边的索引偏移，用于视觉分离重叠边 */
function computeEdgeCurveOffsets(edges: FlowEdge[]): Map<string, number> {
    const pairCount = new Map<string, number>();
    const edgeOffsets = new Map<string, number>();

    for (const edge of edges) {
        const pairKey = [edge.source, edge.target].sort().join('::');
        const idx = pairCount.get(pairKey) || 0;
        pairCount.set(pairKey, idx + 1);
        edgeOffsets.set(edge.id, idx);
    }

    // 归一化偏移：居中分布
    const result = new Map<string, number>();
    for (const edge of edges) {
        const pairKey = [edge.source, edge.target].sort().join('::');
        const total = pairCount.get(pairKey)!;
        const idx = edgeOffsets.get(edge.id)!;
        // 只有 >1 条边共享端点时才偏移
        result.set(edge.id, total > 1 ? (idx - (total - 1) / 2) * 30 : 0);
    }
    return result;
}

function buildQualityHints(
    node: Node<MindMapNodeData>,
    allNodes: Node<MindMapNodeData>[],
    allEdges: FlowEdge[],
): MindMapQualityHint[] {
    if (node.id.startsWith('draft_')) return [];

    const nodeById = new Map(allNodes.map((n) => [n.id, n]));
    const relatedEdges = allEdges.filter((e) => e.source === node.id || e.target === node.id);
    const sourceIds = node.data.source_message_ids
        ?? (node.data.source_message_id ? [node.data.source_message_id] : []);
    const hasEvidenceNeighbor = relatedEdges.some((edge) => {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        return nodeById.get(otherId)?.data.nodeType === 'evidence';
    });
    const hints: MindMapQualityHint[] = [];

    if ((node.data.nodeType === 'argument' || node.data.nodeType === 'concept') && !hasEvidenceNeighbor) {
        hints.push({
            id: 'missing_evidence',
            label: '缺证据',
            prompt: `围绕思维导图节点“${node.data.label}”，请用2-3个追问引导我补充证据或例子，不要直接替我完成答案。`,
        });
    }

    if (node.data.nodeType === 'question' && relatedEdges.length === 0) {
        hints.push({
            id: 'open_question',
            label: '待回应',
            prompt: `围绕思维导图中的疑问“${node.data.label}”，请引导我思考可以怎样回应、验证或拆解这个问题。`,
        });
    }

    if (allNodes.length > 1 && relatedEdges.length === 0) {
        hints.push({
            id: 'isolated',
            label: '未连接',
            prompt: `思维导图节点“${node.data.label}”现在还没有和其他节点建立关系，请引导我判断它应该连接到哪个观点、证据或问题。`,
        });
    }

    if (['argument', 'evidence', 'question'].includes(node.data.nodeType) && sourceIds.length === 0) {
        hints.push({
            id: 'missing_source',
            label: '缺来源',
            prompt: `思维导图节点“${node.data.label}”缺少原始讨论来源，请提醒我如何从小组发言中找到支撑它的原话。`,
        });
    }

    return hints.slice(0, 2);
}

// ── Neo4j 风格结点组件（紧凑胶囊 + emoji + 文字） ──

const QUICK_CONNECT_ACTIONS = [
    { label: '+ 推导', edgeLabel: '导致', nodeType: 'argument' as MindMapNodeType },
    { label: '+ 细节', edgeLabel: '包含', nodeType: 'evidence' as MindMapNodeType },
    { label: '+ 反驳', edgeLabel: '反驳', nodeType: 'question' as MindMapNodeType },
];

function MindMapCustomNode({ data, id, selected }: NodeProps<Node<MindMapNodeData>>) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(data.label);
    const inputRef = useRef<HTMLInputElement>(null);
    const { updateNode, removeNode, addNode, addEdge: storeAddEdge } = useMindMapStore();
    const setHighlightedMsgId = useChatStore((s) => s.setHighlightedMsgId);
    const { sync } = useContext(EditSyncContext);

    // P1-1: 节点度缩放
    const allEdges = useEdges();
    const degree = allEdges.filter(e => e.source === id || e.target === id).length;
    const scale = Math.min(1 + degree * 0.08, 1.4); // 1.0 ~ 1.4 倍

    // P1-2: Hover 高亮
    const { hoveredNodeId, neighborIds } = useContext(HoverContext);
    const isDimmed = hoveredNodeId !== null && hoveredNodeId !== id && !neighborIds.has(id);

    const style = NODE_STYLES[data.nodeType] || NODE_STYLES.concept;
    const emoji = NODE_EMOJIS[data.nodeType] || '💡';
    const sourceMessageIds = (data.source_message_ids as string[] | undefined)
        ?? (data.source_message_id ? [data.source_message_id as string] : []);
    const sourceStudents = (data.source_students as MindMapSourceStudent[] | undefined) ?? [];
    const qualityHints = (data.quality_hints as MindMapQualityHint[] | undefined) ?? [];

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleDoubleClick = useCallback(() => {
        setEditValue(data.label);
        setIsEditing(true);
    }, [data.label]);

    const handleSave = useCallback(() => {
        if (editValue.trim() && editValue !== data.label) {
            const label = editValue.trim();
            updateNode(id, { label });
            sync('update_node', { id, label });
        }
        setIsEditing(false);
    }, [editValue, data.label, id, updateNode, sync]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setIsEditing(false);
        },
        [handleSave]
    );

    const handleTraceSource = useCallback((messageIds = sourceMessageIds) => {
        if (messageIds.length === 0) return;
        if (messageIds.length === 1) {
            setHighlightedMsgId(messageIds[0]);
            return;
        }
        messageIds.forEach((msgId, idx) => {
            setTimeout(() => setHighlightedMsgId(msgId), idx * 500);
        });
    }, [sourceMessageIds, setHighlightedMsgId]);

    const handleQuickConnect = useCallback(
        (action: typeof QUICK_CONNECT_ACTIONS[number]) => {
            const newId = `n-${Date.now()}`;
            const newNode = { id: newId, label: '新节点', type: action.nodeType, position: { x: 0, y: 0 } };
            const newEdge = { id: `e-${Date.now()}`, source: id, target: newId, label: action.edgeLabel };
            addNode(newNode);
            storeAddEdge(newEdge);
            sync('add_node', newNode);
            sync('add_edge', newEdge);
        },
        [id, addNode, storeAddEdge, sync]
    );

    const handleAskQualityHint = useCallback(
        (hint: MindMapQualityHint) => {
            window.dispatchEvent(new CustomEvent('mindmap-ask-suggestion', { detail: hint.prompt }));
        },
        []
    );

    return (
        <div
            onDoubleClick={(e) => {
                if (data.nodeType === 'suggestion') {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent('mindmap-ask-suggestion', { detail: data.label }));
                    return;
                }
                handleDoubleClick();
            }}
            className="group relative transition-opacity duration-200"
            style={{
                opacity: isDimmed ? 0.2 : 1,
                cursor: data.nodeType === 'suggestion' ? 'pointer' : undefined,
            }}
        >
            {/* 不可见 Handle（连线从节点边缘自然出发） */}
            <Handle type="target" position={Position.Left} className="!w-1 !h-1 !bg-transparent !border-0" />
            <Handle type="target" position={Position.Top} className="!w-1 !h-1 !bg-transparent !border-0" />

            {/* 快捷工具栏 */}
            <NodeToolbar isVisible={selected} position={Position.Bottom} offset={6}>
                <div className="flex gap-0.5 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 px-1 py-0.5">
                    {QUICK_CONNECT_ACTIONS.map((action) => (
                        <button key={action.label} onClick={(e) => { e.stopPropagation(); handleQuickConnect(action); }}
                            className="px-2 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-violet-50 hover:text-violet-700 rounded transition-colors whitespace-nowrap">
                            {action.label}
                        </button>
                    ))}
                </div>
            </NodeToolbar>

            {/* Neo4j 风格节点体：紧凑圆角胶囊 + P1-1 度缩放 */}
            <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-grab active:cursor-grabbing transition-all duration-150"
                style={{
                    background: style.bg,
                    boxShadow: selected
                        ? `0 0 0 3px ${style.ring}, 0 2px 8px rgba(0,0,0,0.15)`
                        : '0 1px 4px rgba(0,0,0,0.1)',
                    maxWidth: 220,
                    transform: `scale(${scale})`,
                }}
            >
                <span className="text-sm leading-none flex-shrink-0">{emoji}</span>
                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        className="bg-transparent outline-none text-xs font-medium min-w-[40px]"
                        style={{ color: style.text }}
                    />
                ) : (
                    <span className="text-xs font-medium leading-tight line-clamp-2 break-words" style={{ color: style.text }}>
                        {data.label}
                    </span>
                )}
                {/* 溯源图标 */}
                {sourceMessageIds.length > 0 && (
                    <button onClick={(e) => { e.stopPropagation(); handleTraceSource(); }}
                        className="flex-shrink-0 p-0.5 rounded-full hover:bg-white/30 transition-colors"
                        title={`定位原始消息 (${sourceMessageIds.length}条)`}>
                        <Search className="w-2.5 h-2.5" style={{ color: style.text }} />
                    </button>
                )}
                {qualityHints.length > 0 && (
                    <span
                        className="flex-shrink-0 rounded-full bg-white/25 p-0.5"
                        title={qualityHints.map((hint) => hint.label).join('、')}
                    >
                        <CircleAlert className="w-2.5 h-2.5" style={{ color: style.text }} />
                    </span>
                )}
            </div>

            {(sourceStudents.length > 0 || qualityHints.length > 0) && (
                <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-auto">
                    <div className="flex max-w-[240px] flex-wrap justify-center gap-1 rounded-lg border border-gray-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur-sm">
                        {sourceStudents.map((student) => (
                            <button
                                key={student.id}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleTraceSource(student.message_ids);
                                }}
                                className="max-w-[92px] truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100"
                                title={`${student.name} · 点击定位原始消息`}
                            >
                                {student.name}
                            </button>
                        ))}
                        {qualityHints.map((hint) => (
                            <button
                                key={hint.id}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleAskQualityHint(hint);
                                }}
                                className="max-w-[92px] truncate rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100"
                                title="点击让 AI 引导补强这个节点"
                            >
                                {hint.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 删除按钮 */}
            <button
                onClick={(e) => { e.stopPropagation(); removeNode(id); sync('remove_node', { id }); }}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 shadow z-10"
            >
                ×
            </button>

            <Handle type="source" position={Position.Right} className="!w-1 !h-1 !bg-transparent !border-0" />
            <Handle type="source" position={Position.Bottom} className="!w-1 !h-1 !bg-transparent !border-0" />
        </div>
    );
}

// ── Neo4j 风格边组件（简洁贝塞尔曲线 + 轻量标签） ──

function MindMapCustomEdge({
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, label, style = {}, markerEnd,
}: EdgeProps) {
    const { removeEdge, updateEdgeLabel } = useMindMapStore();
    const { sync } = useContext(EditSyncContext);
    const [hovered, setHovered] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(String(label || ''));
    const inputRef = useRef<HTMLInputElement>(null);

    // P1-2: Hover 高亮 — 非邻居边淡化
    const { hoveredNodeId, neighborEdgeIds } = useContext(HoverContext);
    const isEdgeDimmed = hoveredNodeId !== null && !neighborEdgeIds.has(id);

    // P1-3: 边颜色按 label 类型
    const edgeColor = getEdgeColor(label as string | undefined);

    // 简洁贝塞尔曲线（轻微弧度，不穿过节点）
    const curveOffset = (style as any)?._curveOffset || 0;
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX, sourceY: sourceY + curveOffset, sourcePosition,
        targetX, targetY: targetY + curveOffset, targetPosition,
    });

    const isDraft = id?.startsWith('draft_') ?? false;

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleSave = useCallback(() => {
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== String(label || '')) {
            updateEdgeLabel(id, trimmed);
            sync('update_edge', { id, label: trimmed });
        }
        setIsEditing(false);
    }, [editValue, label, id, updateEdgeLabel, sync]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setIsEditing(false);
        },
        [handleSave]
    );

    return (
        <>
            {/* 透明宽命中区域 */}
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                onMouseEnter={() => !isDraft && setHovered(true)}
                onMouseLeave={() => setHovered(false)}
            />
            <BaseEdge
                path={edgePath}
                markerEnd={markerEnd}
                style={{
                    ...style,
                    stroke: hovered ? '#7c3aed' : edgeColor,
                    strokeWidth: hovered ? 2.5 : (Number(style.strokeWidth) || 1.5),
                    opacity: isEdgeDimmed ? 0.15 : 1,
                    transition: 'opacity 200ms, stroke 150ms',
                }}
            />
            <EdgeLabelRenderer>
                <div
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                        pointerEvents: 'all',
                    }}
                    className="nodrag nopan"
                    onMouseEnter={() => !isDraft && setHovered(true)}
                    onMouseLeave={() => setHovered(false)}
                >
                    {isEditing ? (
                        <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={handleSave}
                            onKeyDown={handleKeyDown}
                            className="px-2 py-0.5 text-xs font-medium rounded-full bg-white border-2 border-violet-400 text-violet-700 outline-none shadow-md"
                            style={{ width: `${Math.max(50, editValue.length * 10 + 24)}px` }}
                        />
                    ) : (
                        <span
                            className="px-2 py-0.5 text-xs font-medium rounded-full bg-white border border-gray-200 text-gray-500 shadow-sm cursor-pointer hover:border-violet-300 hover:text-violet-600 transition-colors"
                            onDoubleClick={() => {
                                if (!isDraft) {
                                    setEditValue(String(label || ''));
                                    setIsEditing(true);
                                }
                            }}
                            title="双击编辑标签"
                        >
                            {label || '关系'}
                        </span>
                    )}
                    {hovered && !isDraft && !isEditing && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                removeEdge(id);
                                sync('remove_edge', { id });
                            }}
                            className="absolute -top-2.5 -right-2.5 w-6 h-6 bg-red-500 text-white rounded-full text-[11px] leading-none flex items-center justify-center hover:bg-red-600 shadow-md"
                        >
                            ×
                        </button>
                    )}
                </div>
            </EdgeLabelRenderer>
        </>
    );
}

// ── 主组件（内部） ──

interface MindMapFlowProps {
    onGenerate: () => void;
    onEditSync: (operation: string, payload: Record<string, unknown>) => void;
    onSend: (event: string, data: Record<string, unknown>) => void;
    onAskSuggestion?: (question: string) => void;
    mapKey?: string;
}

function MindMapFlowInner({ onGenerate, onEditSync, onSend, onAskSuggestion }: MindMapFlowProps) {
    const reactFlowInstance = useReactFlow();
    const {
        nodes,
        edges,
        isGenerating,
        addNode,
        updateNodePosition,
        addEdge: storeAddEdge,
        onNodesChange,
        onEdgesChange,
        draftNodes,
        draftEdges,
        hasDraft,
        exportAsMarkdown,
        serializeAsContext,
    } = useMindMapStore();

    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showLayoutMenu, setShowLayoutMenu] = useState(false);
    const [activeLayout, setActiveLayout] = useState<LayoutType>('tree');
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Sprint 5 Task 5: 全屏切换（支持 webkit 兼容）
    const handleFullscreenToggle = useCallback(() => {
        if (!containerRef.current) return;
        const doc = document as any;
        const el = containerRef.current as any;
        const fsElement = doc.fullscreenElement || doc.webkitFullscreenElement;
        if (!fsElement) {
            (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el).catch(() => { });
        } else {
            (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc).catch(() => { });
        }
    }, []);

    useEffect(() => {
        const handler = () => {
            const doc = document as any;
            setIsFullscreen(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
        };
        document.addEventListener('fullscreenchange', handler);
        document.addEventListener('webkitfullscreenchange', handler);
        return () => {
            document.removeEventListener('fullscreenchange', handler);
            document.removeEventListener('webkitfullscreenchange', handler);
        };
    }, []);

    // 合并正式节点和草稿节点
    const mergedNodes = useMemo(() => [...nodes, ...draftNodes], [nodes, draftNodes]);
    const rawMergedEdges = useMemo(() => [...edges, ...draftEdges], [edges, draftEdges]);
    // 计算边曲率偏移以避免共享端点的边视觉重叠
    const mergedEdges = useMemo(() => {
        const offsets = computeEdgeCurveOffsets(rawMergedEdges);
        return rawMergedEdges.map(e => ({
            ...e,
            style: { ...(e.style || {}), _curveOffset: offsets.get(e.id) || 0 },
        }));
    }, [rawMergedEdges]);
    const enhancedMergedNodes = useMemo(
        () => mergedNodes.map((node) => ({
            ...node,
            data: {
                ...node.data,
                quality_hints: buildQualityHints(node, mergedNodes, mergedEdges),
            },
        })),
        [mergedNodes, mergedEdges]
    );

    const nodeTypes = useMemo(() => ({ mindMapNode: MindMapCustomNode }), []);
    const edgeTypes = useMemo(() => ({ default: MindMapCustomEdge }), []);
    const editSyncValue = useMemo(() => ({ sync: onEditSync }), [onEditSync]);

    // P1-2: Hover 高亮上下文
    const hoverCtx = useMemo(() => {
        if (!hoveredNodeId) {
            return { hoveredNodeId: null as string | null, neighborIds: new Set<string>(), neighborEdgeIds: new Set<string>() };
        }
        const neighborIds = new Set<string>();
        const neighborEdgeIds = new Set<string>();
        for (const e of mergedEdges) {
            if (e.source === hoveredNodeId || e.target === hoveredNodeId) {
                neighborIds.add(e.source);
                neighborIds.add(e.target);
                neighborEdgeIds.add(e.id);
            }
        }
        return { hoveredNodeId, neighborIds, neighborEdgeIds };
    }, [hoveredNodeId, mergedEdges]);

    // 布局切换（带平滑动画）
    const handleLayout = useCallback((type: LayoutType) => {
        const nonDraftNodes = mergedNodes.filter((n) => n.id && !n.id.startsWith('draft_'));
        const nonDraftEdges = mergedEdges.filter((e) => e.id && !e.id.startsWith('draft_'));
        if (nonDraftNodes.length === 0) return;

        // 记录旧位置
        const oldPositions = new Map(nonDraftNodes.map(n => [n.id, { ...n.position }]));
        // 计算新位置
        const layouted = applyLayout(type, nonDraftNodes, nonDraftEdges);
        const newPositions = new Map(layouted.map(n => [n.id, { ...n.position }]));

        // requestAnimationFrame 插值动画 (400ms ease-out)
        const duration = 400;
        const startTime = performance.now();

        const animate = (now: number) => {
            const elapsed = now - startTime;
            const rawT = Math.min(elapsed / duration, 1);
            // ease-out: t * (2 - t)
            const t = rawT * (2 - rawT);

            const changes = nonDraftNodes.map((n) => {
                const from = oldPositions.get(n.id) || n.position;
                const to = newPositions.get(n.id) || n.position;
                return {
                    type: 'position' as const,
                    id: n.id,
                    position: {
                        x: from.x + (to.x - from.x) * t,
                        y: from.y + (to.y - from.y) * t,
                    },
                    dragging: false,
                };
            });
            onNodesChange(changes);

            if (rawT < 1) {
                requestAnimationFrame(animate);
            } else {
                for (const [nodeId, position] of newPositions) {
                    onEditSync('update_node_position', { id: nodeId, position });
                }
                // 动画结束后 fitView
                reactFlowInstance.fitView({ padding: 0.3, duration: 200 });
            }
        };

        requestAnimationFrame(animate);
        setActiveLayout(type);
        setShowLayoutMenu(false);
    }, [mergedNodes, mergedEdges, onNodesChange, onEditSync, reactFlowInstance]);

    // 拖拽连线创建新边
    const handleConnect = useCallback(
        (connection: Connection) => {
            const edgeId = `e-${Date.now()}`;
            const newEdge = {
                id: edgeId,
                source: connection.source!,
                target: connection.target!,
                label: '关系',
            };
            storeAddEdge(newEdge);
            onEditSync('add_edge', newEdge);
        },
        [storeAddEdge, onEditSync]
    );

    const handleAddNode = useCallback(() => {
        const id = `n-${Date.now()}`;
        const newNode = {
            id,
            label: '新概念',
            type: 'concept' as const,
            position: {
                x: 50 + Math.random() * 300,
                y: 50 + Math.random() * 200,
            },
        };
        addNode(newNode);
        onEditSync('add_node', newNode);
    }, [addNode, onEditSync]);

    // Sprint 2: 拖放建图（Chat → Canvas）
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            const raw = e.dataTransfer.getData('application/mindmap-message');
            if (!raw) return;

            try {
                const payload = JSON.parse(raw) as {
                    text: string;
                    role: string;
                    senderId?: string;
                    senderName: string;
                    message_id: string;
                };

                // 使用 reactFlowInstance 计算画布坐标
                const position = reactFlowInstance.screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                });

                // 截取前 60 字作为节点标签
                const label = payload.text.length > 60
                    ? payload.text.slice(0, 57) + '...'
                    : payload.text;

                const nodeType: MindMapNodeType =
                    payload.role === 'ai' ? 'concept'
                        : payload.role === 'teacher' ? 'evidence'
                            : 'argument';

                const id = `n-${Date.now()}`;
                const newNode = {
                    id,
                    label,
                    type: nodeType,
                    position,
                    source_message_id: payload.message_id,
                    source_message_ids: [payload.message_id],
                    ...(payload.role === 'student'
                        ? {
                            source_students: [{
                                id: payload.senderId || payload.senderName,
                                name: payload.senderName,
                                message_ids: [payload.message_id],
                            }],
                        }
                        : {}),
                };
                addNode(newNode);
                onEditSync('add_node', newNode);
            } catch (err) {
                console.warn('[MindMap] Drop parse error:', err);
            }
        },
        [reactFlowInstance, addNode, onEditSync]
    );

    const handleNodeDragStop = useCallback(
        (_event: React.MouseEvent, node: Node<MindMapNodeData>) => {
            if (node.id.startsWith('draft_')) return;
            updateNodePosition(node.id, node.position);
            onEditSync('update_node_position', { id: node.id, position: node.position });
        },
        [updateNodePosition, onEditSync]
    );

    const handleNodesDelete = useCallback(
        (deletedNodes: Node<MindMapNodeData>[]) => {
            deletedNodes
                .filter((node) => !node.id.startsWith('draft_'))
                .forEach((node) => onEditSync('remove_node', { id: node.id }));
        },
        [onEditSync]
    );

    const handleEdgesDelete = useCallback(
        (deletedEdges: FlowEdge[]) => {
            deletedEdges
                .filter((edge) => !edge.id.startsWith('draft_'))
                .forEach((edge) => onEditSync('remove_edge', { id: edge.id }));
        },
        [onEditSync]
    );

    // 导出 Markdown
    const handleExportMd = useCallback(() => {
        const md = exportAsMarkdown();
        if (!md) return;
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mindmap_${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
        setShowExportMenu(false);
    }, [exportAsMarkdown]);

    // Sprint 5 Task 7: 导出 PNG（使用 html-to-image）
    const handleExportPng = useCallback(() => {
        const flowEl = document.querySelector('.react-flow__viewport') as HTMLElement;
        if (!flowEl) { alert('无法找到画布'); return; }

        toPng(flowEl, {
            backgroundColor: '#f9fafb',
            pixelRatio: 2,
            filter: (node) => {
                // 排除 minimap 和 controls
                const cls = node.classList?.toString() || '';
                if (cls.includes('react-flow__minimap') || cls.includes('react-flow__controls')) return false;
                return true;
            },
        }).then((dataUrl) => {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `mindmap_${new Date().toISOString().slice(0, 10)}.png`;
            a.click();
            setShowExportMenu(false);
        }).catch((err) => {
            console.error('PNG export failed:', err);
            alert('导出失败，请重试');
        });
    }, []);

    // P1: 导出 SVG
    const handleExportSvg = useCallback(() => {
        const flowEl = document.querySelector('.react-flow__viewport') as HTMLElement;
        if (!flowEl) { alert('无法找到画布'); return; }

        toSvg(flowEl, {
            backgroundColor: '#f9fafb',
            filter: (node) => {
                const cls = node.classList?.toString() || '';
                if (cls.includes('react-flow__minimap') || cls.includes('react-flow__controls')) return false;
                return true;
            },
        }).then((dataUrl) => {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `mindmap_${new Date().toISOString().slice(0, 10)}.svg`;
            a.click();
            setShowExportMenu(false);
        }).catch((err) => {
            console.error('SVG export failed:', err);
            alert('导出失败，请重试');
        });
    }, []);

    // 用作上下文
    const handleUseAsContext = useCallback(() => {
        const ctx = serializeAsContext();
        if (!ctx) return;
        window.dispatchEvent(new CustomEvent('mindmap-use-context', { detail: ctx }));
    }, [serializeAsContext]);

    // 监听 suggestion 节点点击
    useEffect(() => {
        const handler = (e: Event) => {
            const question = (e as CustomEvent).detail;
            if (onAskSuggestion) onAskSuggestion(question);
        };
        window.addEventListener('mindmap-ask-suggestion', handler);
        return () => window.removeEventListener('mindmap-ask-suggestion', handler);
    }, [onAskSuggestion]);

    return (
        <div
            ref={containerRef}
            className={clsx(
                'relative w-full h-full bg-gray-50 rounded-xl border border-gray-200 overflow-hidden',
                isFullscreen && 'rounded-none border-0'
            )}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >            {/* 工具栏 */}
            <div className={clsx('absolute top-3 right-3 flex gap-1.5', isFullscreen ? 'z-[9999]' : 'z-10')}>
                <button
                    onClick={onGenerate}
                    disabled={isGenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-all shadow-sm"
                >
                    {isGenerating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
                    ) : (
                        <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                    )}
                    {isGenerating ? '生成中...' : 'AI 提取'}
                </button>

                {/* 布局选择下拉 */}
                <div className="relative">
                    <button
                        onClick={() => setShowLayoutMenu(!showLayoutMenu)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
                        title="调整布局"
                    >
                        <LayoutGrid className="w-3.5 h-3.5 text-amber-500" />
                        {LAYOUT_OPTIONS.find(o => o.type === activeLayout)?.icon || '🌳'}
                        <ChevronDown className="w-3 h-3" />
                    </button>
                    {showLayoutMenu && (
                        <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-200 py-1.5 min-w-[180px] z-50">
                            <div className="px-3 py-1 text-[10px] text-gray-400 font-medium uppercase tracking-wider">选择布局</div>
                            {LAYOUT_OPTIONS.map(opt => (
                                <button
                                    key={opt.type}
                                    onClick={() => handleLayout(opt.type)}
                                    className={clsx(
                                        'w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors',
                                        activeLayout === opt.type
                                            ? 'bg-violet-50 text-violet-700 font-medium'
                                            : 'text-gray-700 hover:bg-gray-50'
                                    )}
                                >
                                    <span className="text-base">{opt.icon}</span>
                                    <div>
                                        <div className="font-medium">{opt.label}</div>
                                        <div className="text-[10px] text-gray-400">{opt.description}</div>
                                    </div>
                                    {activeLayout === opt.type && (
                                        <span className="ml-auto text-violet-500 text-[10px]">✓</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <button
                    onClick={handleAddNode}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>

                {/* 导出下拉 */}
                {nodes.length > 0 && (
                    <div className="relative">
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
                        >
                            <Download className="w-3.5 h-3.5" />
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        {showExportMenu && (
                            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px] z-50">
                                <button
                                    onClick={handleExportMd}
                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                >
                                    📝 Markdown 大纲
                                </button>
                                <button
                                    onClick={handleExportPng}
                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                >
                                    🖼️ 导出 PNG 图片
                                </button>
                                <button
                                    onClick={handleExportSvg}
                                    className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                >
                                    🎨 导出 SVG 矢量图
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* 用作上下文 */}
                {nodes.length > 0 && (
                    <button
                        onClick={handleUseAsContext}
                        title="将图谱作为下次对话的上下文"
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
                    >
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
                        用作上下文
                    </button>
                )}

                {(nodes.length > 0 || edges.length > 0) && (
                    <span className="flex items-center px-2 py-1.5 bg-violet-50 border border-violet-200 rounded-lg text-[10px] text-violet-600 font-medium">
                        {nodes.length} 节点 · {edges.length} 连线
                    </span>
                )}

                {/* Sprint 5 Task 5: 全屏按钮 */}
                <button
                    onClick={handleFullscreenToggle}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
                    title={isFullscreen ? '退出全屏' : '全屏'}
                >
                    {isFullscreen ? (
                        <Minimize2 className="w-3.5 h-3.5" />
                    ) : (
                        <Maximize2 className="w-3.5 h-3.5" />
                    )}
                </button>
            </div>

            {/* 空状态 */}
            {/* 草稿确认浮层 */}
            {hasDraft && <DraftOverlay onSend={onSend} />}

            {mergedNodes.length === 0 && !isGenerating ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-300">
                    <Sparkles className="w-10 h-10 mb-3 text-violet-200" />
                    <p className="text-sm font-medium">思维导图</p>
                    <p className="text-xs mt-1">点击 "AI 提取" 从对话中生成知识图谱</p>
                </div>
            ) : (
                <EditSyncContext.Provider value={editSyncValue}>
                <HoverContext.Provider value={hoverCtx}>
                    <ReactFlow
                        nodes={enhancedMergedNodes}
                        edges={mergedEdges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={handleConnect}
                        onNodeDragStop={handleNodeDragStop}
                        onNodesDelete={handleNodesDelete}
                        onEdgesDelete={handleEdgesDelete}
                        onNodeMouseEnter={(_e, node) => setHoveredNodeId(node.id)}
                        onNodeMouseLeave={() => setHoveredNodeId(null)}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        fitView
                        fitViewOptions={{ padding: 0.3 }}
                        minZoom={0.3}
                        maxZoom={2}
                        deleteKeyCode={['Backspace', 'Delete']}
                        proOptions={{ hideAttribution: true }}
                        className="!bg-gray-50"
                        defaultEdgeOptions={{
                            type: 'default',
                            animated: false,
                            style: { stroke: '#a78bfa', strokeWidth: 1.5 },
                            markerEnd: {
                                type: MarkerType.ArrowClosed,
                                width: 16,
                                height: 16,
                                color: '#a78bfa',
                            },
                        }}
                    >
                        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
                        <Controls
                            showInteractive={false}
                            className="!bg-white !shadow-md !rounded-lg !border !border-gray-200"
                        />
                        <MiniMap
                            nodeColor={(node) => {
                                const nt = (node.data as MindMapNodeData | undefined)?.nodeType || 'concept';
                                return NODE_STYLES[nt]?.bg || '#6366f1';
                            }}
                            maskColor="rgba(255,255,255,0.7)"
                            className="!bg-white !shadow-md !rounded-lg !border !border-gray-200"
                            pannable
                            zoomable
                        />
                    </ReactFlow>
                </HoverContext.Provider>
                </EditSyncContext.Provider>
            )}
        </div>
    );
}

// ── 导出（包裹 ReactFlowProvider） ──

export const MindMapPanel: React.FC<MindMapFlowProps> = (props) => (
    <MindMapErrorBoundary>
        <ReactFlowProvider>
            <MindMapFlowInner {...props} />
        </ReactFlowProvider>
    </MindMapErrorBoundary>
);
