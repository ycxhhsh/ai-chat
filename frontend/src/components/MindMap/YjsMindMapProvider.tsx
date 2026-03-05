/**
 * YjsMindMapProvider — 铁律 2 核心组件。
 *
 * 将 Yjs CRDT 文档绑定到 React Flow 的 nodes/edges，
 * 通过 y-websocket 连接后端 /yjs/{room_name} 端点实现实时协作。
 *
 * 使用方式：
 *   <YjsMindMapProvider sessionId={sessionId}>
 *     <MindMapCanvas />
 *   </YjsMindMapProvider>
 */
import { useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useMindMapStore } from '../../store/useMindMapStore';
import type { MindMapNodeData } from '../../types';

interface YjsMindMapProviderProps {
    sessionId: string;
    children: React.ReactNode;
}

/** Node y-websocket 服务 URL（docker 端口 1234） */
function getYjsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = import.meta.env.VITE_YJS_HOST || `${window.location.hostname}:1234`;
    return `${protocol}//${host}`;
}

export function YjsMindMapProvider({ sessionId, children }: YjsMindMapProviderProps) {
    const docRef = useRef<Y.Doc | null>(null);
    const providerRef = useRef<WebsocketProvider | null>(null);
    const { nodes, edges, setMindMapData } = useMindMapStore();

    // 初始化 Yjs 文档和 WebSocket 连接
    useEffect(() => {
        const doc = new Y.Doc();
        const roomName = `mindmap:${sessionId}`;
        const wsUrl = getYjsUrl();

        const provider = new WebsocketProvider(wsUrl, roomName, doc, {
            connect: true,
        });

        docRef.current = doc;
        providerRef.current = provider;

        // 获取共享类型
        const yNodes = doc.getMap<Y.Map<unknown>>('nodes');
        const yEdges = doc.getMap<Y.Map<unknown>>('edges');

        // 监听远程变更 → 同步到 Zustand store
        const syncToStore = () => {
            const flowNodes = Array.from(yNodes.entries()).map(([id, yNode]) => {
                const nodeData = yNode.toJSON() as Record<string, unknown>;
                return {
                    id,
                    type: 'mindMapNode' as const,
                    position: (nodeData.position as { x: number; y: number }) ?? { x: 0, y: 0 },
                    data: {
                        label: (nodeData.label as string) ?? '',
                        nodeType: (nodeData.nodeType as string) ?? 'concept',
                    } as MindMapNodeData,
                };
            });

            const flowEdges = Array.from(yEdges.entries()).map(([id, yEdge]) => {
                const edgeData = yEdge.toJSON() as Record<string, unknown>;
                return {
                    id,
                    source: (edgeData.source as string) ?? '',
                    target: (edgeData.target as string) ?? '',
                    label: (edgeData.label as string) ?? '',
                    animated: true,
                    style: { stroke: '#a78bfa', strokeWidth: 2 },
                };
            });

            setMindMapData({
                id: sessionId,
                session_id: sessionId,
                nodes: flowNodes.map(n => ({
                    id: n.id,
                    label: n.data.label,
                    type: n.data.nodeType ?? 'concept',
                    position: n.position,
                })),
                edges: flowEdges.map(e => ({
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    label: (e.label as string) ?? '',
                })),
                version: 1,
            });
        };

        yNodes.observeDeep(syncToStore);
        yEdges.observeDeep(syncToStore);

        // 初始同步
        syncToStore();

        // 连接状态日志
        provider.on('status', ({ status }: { status: string }) => {
            console.log(`[Yjs] ${roomName} status: ${status}`);
        });

        return () => {
            yNodes.unobserveDeep(syncToStore);
            yEdges.unobserveDeep(syncToStore);
            provider.disconnect();
            doc.destroy();
            docRef.current = null;
            providerRef.current = null;
        };
    }, [sessionId, setMindMapData]);

    // 将本地 React Flow 变更写回 Yjs 文档
    const pushNodesToYjs = useCallback(() => {
        const doc = docRef.current;
        if (!doc) return;

        const yNodes = doc.getMap<Y.Map<unknown>>('nodes');
        doc.transact(() => {
            // 同步当前 store 中的 nodes
            const currentNodeIds = new Set(nodes.map(n => n.id));

            // 删除 Yjs 中已不存在的节点
            for (const key of yNodes.keys()) {
                if (!currentNodeIds.has(key)) {
                    yNodes.delete(key);
                }
            }

            // 更新/添加节点
            for (const node of nodes) {
                const yNode = yNodes.get(node.id) ?? new Y.Map<unknown>();
                if (!yNodes.has(node.id)) {
                    yNodes.set(node.id, yNode);
                }
                yNode.set('label', node.data?.label ?? '');
                yNode.set('nodeType', node.data?.nodeType ?? 'concept');
                yNode.set('position', node.position);
            }
        });
    }, [nodes]);

    const pushEdgesToYjs = useCallback(() => {
        const doc = docRef.current;
        if (!doc) return;

        const yEdges = doc.getMap<Y.Map<unknown>>('edges');
        doc.transact(() => {
            const currentEdgeIds = new Set(edges.map(e => e.id));

            for (const key of yEdges.keys()) {
                if (!currentEdgeIds.has(key)) {
                    yEdges.delete(key);
                }
            }

            for (const edge of edges) {
                const yEdge = yEdges.get(edge.id) ?? new Y.Map<unknown>();
                if (!yEdges.has(edge.id)) {
                    yEdges.set(edge.id, yEdge);
                }
                yEdge.set('source', edge.source);
                yEdge.set('target', edge.target);
                yEdge.set('label', edge.label ?? '');
            }
        });
    }, [edges]);

    // 当 store 的 nodes/edges 变化时，推送到 Yjs
    useEffect(() => {
        pushNodesToYjs();
    }, [pushNodesToYjs]);

    useEffect(() => {
        pushEdgesToYjs();
    }, [pushEdgesToYjs]);

    return <>{children}</>;
}
