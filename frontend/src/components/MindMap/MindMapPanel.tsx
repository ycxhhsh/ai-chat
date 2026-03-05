/**
 * 思维导图面板 — React Flow 交互式版本。
 * 支持：dagre 自动布局、拖拽、缩放、双击编辑、MiniMap、Controls。
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
import {
    ReactFlow,
    Controls,
    MiniMap,
    Background,
    BackgroundVariant,
    Handle,
    Position,
    BaseEdge,
    EdgeLabelRenderer,
    getBezierPath,
    type NodeProps,
    type EdgeProps,
    type Node,
    type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';  // @ts-ignore css import
import dagre from '@dagrejs/dagre';
import { useMindMapStore, type FlowNode, type FlowEdge } from '../../store/useMindMapStore';
import type { MindMapNodeData, MindMapNodeType } from '../../types';
import { Loader2, Sparkles, Plus, Download, MessageCircle, ChevronDown } from 'lucide-react';
import { DraftOverlay } from './DraftOverlay';

// ── 颜色映射 ──

const NODE_COLORS: Record<MindMapNodeType, { bg: string; border: string; text: string }> = {
    concept: { bg: '#eef2ff', border: '#6366f1', text: '#4338ca' },
    argument: { bg: '#fffbeb', border: '#f59e0b', text: '#b45309' },
    evidence: { bg: '#ecfdf5', border: '#10b981', text: '#047857' },
    question: { bg: '#fef2f2', border: '#ef4444', text: '#b91c1c' },
    suggestion: { bg: '#faf5ff', border: '#a78bfa', text: '#7c3aed' },
};

const NODE_TYPE_LABELS: Record<MindMapNodeType, string> = {
    concept: '概念',
    argument: '论点',
    evidence: '证据',
    question: '问题',
    suggestion: '💡 探索',
};

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

// ── dagre 自动布局 ──

function getLayoutedElements(nodes: FlowNode[], edges: FlowEdge[]): { nodes: FlowNode[]; edges: FlowEdge[] } {
    if (nodes.length === 0) return { nodes, edges };

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });

    nodes.forEach((node) => {
        g.setNode(node.id, { width: 160, height: 50 });
    });

    edges.forEach((edge) => {
        g.setEdge(edge.source, edge.target);
    });

    dagre.layout(g);

    const layoutedNodes = nodes.map((node) => {
        const pos = g.node(node.id);
        return {
            ...node,
            position: { x: pos.x - 80, y: pos.y - 25 },
        };
    });

    return { nodes: layoutedNodes, edges };
}

// ── 自定义节点组件 ──

function MindMapCustomNode({ data, id }: NodeProps<Node<MindMapNodeData>>) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(data.label);
    const inputRef = useRef<HTMLInputElement>(null);
    const { updateNode, removeNode } = useMindMapStore();

    const colors = NODE_COLORS[data.nodeType] || NODE_COLORS.concept;
    const typeLabel = NODE_TYPE_LABELS[data.nodeType] || '概念';

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
            updateNode(id, { label: editValue.trim() });
        }
        setIsEditing(false);
    }, [editValue, data.label, id, updateNode]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') setIsEditing(false);
        },
        [handleSave]
    );

    return (
        <div
            onDoubleClick={handleDoubleClick}
            onClick={() => {
                // 点击 suggestion 节点触发发问
                if (data.nodeType === 'suggestion') {
                    window.dispatchEvent(new CustomEvent('mindmap-ask-suggestion', { detail: data.label }));
                }
            }}
            className="group relative"
            style={{
                minWidth: 100,
                maxWidth: 200,
                cursor: data.nodeType === 'suggestion' ? 'pointer' : undefined,
            }}
        >
            <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-gray-300" />

            <div
                className="px-4 py-2.5 rounded-xl text-sm font-medium shadow-md border-2 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-lg"
                style={{
                    background: colors.bg,
                    borderColor: colors.border,
                    color: colors.text,
                }}
            >
                {/* 类型标签 */}
                <span
                    className="absolute -top-2.5 left-3 px-1.5 py-0 text-[9px] font-bold rounded-sm text-white leading-[16px]"
                    style={{ background: colors.border }}
                >
                    {typeLabel}
                </span>

                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        className="w-full bg-transparent outline-none text-center text-sm font-medium"
                        style={{ color: colors.text }}
                    />
                ) : (
                    <span className="block text-center break-words">{data.label}</span>
                )}

                {/* 删除按钮 */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        removeNode(id);
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 shadow"
                >
                    ×
                </button>
            </div>

            <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-gray-300" />
        </div>
    );
}

// ── 自定义边组件（支持标签显示 + 双击编辑 + 删除按钮） ──

function MindMapCustomEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    label,
    style = {},
    markerEnd,
}: EdgeProps) {
    const { removeEdge, updateEdgeLabel } = useMindMapStore();
    const [hovered, setHovered] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(String(label || ''));
    const inputRef = useRef<HTMLInputElement>(null);
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
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
        }
        setIsEditing(false);
    }, [editValue, label, id, updateEdgeLabel]);

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
                    stroke: hovered ? '#7c3aed' : (style.stroke || '#a78bfa'),
                    strokeWidth: hovered ? 3 : (Number(style.strokeWidth) || 2),
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
                            className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-white border-2 border-violet-400 text-violet-700 outline-none shadow-md"
                            style={{ width: `${Math.max(40, editValue.length * 10 + 20)}px` }}
                        />
                    ) : (
                        <span
                            className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-white/90 border border-violet-200 text-violet-600 shadow-sm cursor-pointer hover:border-violet-400 hover:bg-white transition-colors"
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
                            }}
                            className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full text-[9px] leading-none flex items-center justify-center hover:bg-red-600 shadow"
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
    const {
        nodes,
        edges,
        isGenerating,
        addNode,
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

    // 合并正式节点和草稿节点
    const mergedNodes = useMemo(() => [...nodes, ...draftNodes], [nodes, draftNodes]);
    const mergedEdges = useMemo(() => [...edges, ...draftEdges], [edges, draftEdges]);

    const nodeTypes = useMemo(() => ({ mindMapNode: MindMapCustomNode }), []);
    const edgeTypes = useMemo(() => ({ default: MindMapCustomEdge }), []);
    const prevNodeCountRef = useRef(mergedNodes.length);

    // dagre 自动布局：仅在节点数量变化时触发
    useEffect(() => {
        if (mergedNodes.length > 0 && mergedNodes.length !== prevNodeCountRef.current) {
            const { nodes: layouted } = getLayoutedElements(mergedNodes, mergedEdges);
            // 通过 onNodesChange 应用位置变更（仅正式节点）
            const changes = layouted
                .filter((n) => !n.id.startsWith('draft_'))
                .map((n) => ({
                    type: 'position' as const,
                    id: n.id,
                    position: n.position,
                }));
            if (changes.length > 0) onNodesChange(changes);
        }
        prevNodeCountRef.current = mergedNodes.length;
    }, [mergedNodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // 导出图片（SVG 格式，兼容性最好）
    const handleExportPng = useCallback(() => {
        const flowEl = document.querySelector('.react-flow') as HTMLElement;
        if (!flowEl) { alert('无法找到画布'); return; }

        // 获取 SVG 边和 HTML 节点
        const svgEdges = flowEl.querySelector('.react-flow__edges') as SVGElement;
        const nodeContainer = flowEl.querySelector('.react-flow__nodes') as HTMLElement;
        if (!svgEdges || !nodeContainer) { alert('画布为空'); return; }

        const viewportEl = flowEl.querySelector('.react-flow__viewport') as HTMLElement;
        const flowRect = flowEl.getBoundingClientRect();
        const w = flowRect.width;
        const h = flowRect.height;

        // 克隆 SVG 边
        const edgesClone = svgEdges.cloneNode(true) as SVGElement;

        // 克隆节点
        const nodesClone = nodeContainer.cloneNode(true) as HTMLElement;

        // 收集所有内联样式
        const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
            .map(s => {
                if (s.tagName === 'STYLE') return s.outerHTML;
                return '';
            }).filter(Boolean).join('\n');

        const svgStr = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#f9fafb"/>
  <g transform="${viewportEl?.style.transform || ''}">
    ${edgesClone.innerHTML}
    <foreignObject width="${w * 3}" height="${h * 3}" x="${-w}" y="${-h}">
      <div xmlns="http://www.w3.org/1999/xhtml">
        <style>
          .react-flow__node { position: absolute; }
          .react-flow__handle { display: none; }
          ${styles}
        </style>
        ${nodesClone.outerHTML}
      </div>
    </foreignObject>
  </g>
</svg>`;

        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mindmap_${new Date().toISOString().slice(0, 10)}.svg`;
        a.click();
        URL.revokeObjectURL(url);
        setShowExportMenu(false);
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
        <div className="relative w-full h-full bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
            {/* 工具栏 */}
            <div className="absolute top-3 right-3 z-10 flex gap-1.5">
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
                                    🖼️ 导出 SVG 图片
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
                <ReactFlow
                    nodes={mergedNodes}
                    edges={mergedEdges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={handleConnect}
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
                        animated: true,
                        style: { stroke: '#a78bfa', strokeWidth: 2 },
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
                            return NODE_COLORS[nt]?.border || '#6366f1';
                        }}
                        maskColor="rgba(255,255,255,0.7)"
                        className="!bg-white !shadow-md !rounded-lg !border !border-gray-200"
                        pannable
                        zoomable
                    />
                </ReactFlow>
            )}
        </div>
    );
}

// ── 导出 ──

export const MindMapPanel: React.FC<MindMapFlowProps> = (props) => (
    <MindMapErrorBoundary>
        <MindMapFlowInner {...props} />
    </MindMapErrorBoundary>
);
