/**
 * WebSocket 连接管理 Hook。
 * 从 Store 中抽离，统一管理连接/断开/事件分发。
 *
 * 优化：
 * - 指数退避重连（1s → 2s → 4s → 8s → 16s → 30s max）
 * - 应用层心跳（PING/PONG）检测死连接
 * - 连接状态日志
 * - SESSION_JOINED 初始化支架 + 历史消息
 * - CHAT_ACK 消息确认
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useGroupStore } from '../store/useGroupStore';
import { useChatStore } from '../store/useChatStore';
import { useScaffoldStore } from '../store/useScaffoldStore';
import { useMindMapStore } from '../store/useMindMapStore';
import type { ChatMessage } from '../types';
import { generateUUID } from '../utils/uuid';
import { shouldAppendStreamChunk } from './streamDedupe';

// 心跳配置 — 增加容忍度以避免浏览器后台挂起导致的误判断连
const HEARTBEAT_TIMEOUT = 120_000;

// 重连配置 — 首次重连 500ms，减少感知延迟
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;

export function useWebSocket(sessionId: string | null) {
    const wsRef = useRef<WebSocket | null>(null);
    const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
    const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 游标：记录最后收到消息的时间戳，重连时只拉取增量
    const lastMsgTimestampRef = useRef<string | null>(null);
    const isReconnectRef = useRef(false);
    const activeStreamTaskRef = useRef<string | null>(null);
    const streamSeqRef = useRef<Record<string, number>>({});
    const { token } = useAuthStore();

    const {
        addGroupMessage,
        addAiMessage,
        setGroupMessages,
        setAiTyping,
        appendAiStream,
        resetAiStream,
        setAvailableProviders,
        updateMessageStatus,
        setScaffoldSuggestion,
        setSearchSources,
    } = useChatStore();

    const { updateScaffoldState, setScaffolds, handleScaffoldDisabled } = useScaffoldStore();
    const {
        setMindMapData,
        setIsGenerating,
        setDraft,
        addNode,
        removeNode,
        updateNode,
        updateNodePosition,
        addEdge,
        removeEdge,
        updateEdgeLabel,
    } = useMindMapStore();

    // 停止心跳检测
    const stopHeartbeat = useCallback(() => {
        if (heartbeatTimerRef.current) {
            clearInterval(heartbeatTimerRef.current);
            heartbeatTimerRef.current = null;
        }
        if (heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
            heartbeatTimeoutRef.current = null;
        }
    }, []);

    // 重置心跳超时（收到服务端消息/PING 后调用）
    const resetHeartbeatTimeout = useCallback(() => {
        if (heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
        }
        heartbeatTimeoutRef.current = setTimeout(() => {
            console.warn('[WS] Heartbeat timeout, reconnecting...');
            if (wsRef.current) {
                wsRef.current.close(4002, 'Heartbeat timeout');
            }
        }, HEARTBEAT_TIMEOUT);
    }, []);

    // 启动心跳
    const startHeartbeat = useCallback(() => {
        stopHeartbeat();
        // 客户端主动发心跳保持 Nginx/TCP 活跃
        heartbeatTimerRef.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send('{"event":"PING","data":{}}');
            }
        }, 15_000);
        resetHeartbeatTimeout();
    }, [stopHeartbeat, resetHeartbeatTimeout]);

    const handleEvent = useCallback((eventName: string, data: Record<string, unknown>) => {
        // 收到任何事件都说明连接存活，可重置超时
        resetHeartbeatTimeout();

        switch (eventName) {
            case 'PING':
                // 收到服务端心跳，回复 PONG
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send('{"event":"PONG","data":{}}');
                }
                break;

            case 'SESSION_JOINED':
                if (data.current_stage) {
                    const currentSessionId = data.session_id as string || sessionId || '';
                    useGroupStore.getState().updateGroupStage(currentSessionId, data.current_stage as string);
                    window.dispatchEvent(new CustomEvent('edipt-stage-update', { detail: data.current_stage }));
                }
                if (data.available_providers) {
                    setAvailableProviders(data.available_providers as Array<{ name: string; display_name: string; model: string }>);
                }
                // P0-2: 初始化支架列表
                if (data.scaffolds && Array.isArray(data.scaffolds)) {
                    setScaffolds(data.scaffolds as Array<{ scaffold_id: string; display_name: string; prompt_template: string; is_active: boolean; sort_order: number }>);
                }
                // P0-2: 消息处理 — 区分首次连接和重连
                if (data.recent_messages && Array.isArray(data.recent_messages)) {
                    const currentSessionId = data.session_id as string || sessionId || '';
                    const msgs = data.recent_messages as ChatMessage[];
                    const groupMsgs: ChatMessage[] = [];
                    const aiMsgs: ChatMessage[] = [];
                    for (const msg of msgs) {
                        const isAiPrivate =
                            (msg.sender?.role === 'ai' && msg.recipient_id) ||
                            msg.recipient_id === 'ai';
                        if (isAiPrivate) {
                            aiMsgs.push({ ...msg, status: 'sent' });
                        } else {
                            groupMsgs.push({ ...msg, status: 'sent' });
                        }
                    }
                    if (isReconnectRef.current && msgs.length > 0) {
                        // 重连：增量追加（游标之后的新消息）
                        for (const m of groupMsgs) addGroupMessage(currentSessionId, m);
                        for (const m of aiMsgs) addAiMessage(m);
                    } else {
                        // P0 修复：首次连接时也预填小组消息（来自后端 recent_messages）
                        if (groupMsgs.length > 0) {
                            setGroupMessages(currentSessionId, groupMsgs);
                        }
                        // AI 消息由 StudentView 按 currentConversationId 加载
                    }
                    // 更新游标到最后一条消息的时间
                    if (msgs.length > 0) {
                        const lastMsg = msgs[msgs.length - 1];
                        if (lastMsg.created_at) {
                            lastMsgTimestampRef.current = lastMsg.created_at;
                        }
                    }
                }
                break;

            case 'CHAT_MESSAGE': {
                const msg = data as unknown as ChatMessage;
                // 更新游标
                if (msg.created_at) {
                    lastMsgTimestampRef.current = msg.created_at;
                }
                const isAiPrivate =
                    (msg.sender?.role === 'ai' && msg.recipient_id) ||
                    msg.recipient_id === 'ai';
                if (isAiPrivate) {
                    addAiMessage(msg);
                } else {
                    // P0 修复：传入 sessionId 用于分片存储
                    const msgSessionId = msg.session_id || sessionId || '';
                    addGroupMessage(msgSessionId, msg);
                }
                break;
            }

            case 'CHAT_ACK': {
                // P0-1: 消息确认
                const requestId = data.request_id as string;
                const persisted = data.persisted as boolean;
                const messageId = data.message_id as string | undefined;
                if (requestId) {
                    updateMessageStatus(
                        requestId,
                        persisted ? 'sent' : 'failed',
                        messageId,
                    );
                }
                break;
            }

            case 'AI_STREAM_CHUNK':
                setAiTyping(true);
                if (
                    data.chunk
                    && shouldAppendStreamChunk(
                        streamSeqRef.current,
                        data.task_id,
                        data.seq,
                    )
                ) {
                    appendAiStream(data.chunk as string);
                }
                break;

            case 'AI_REPLY_DONE': {
                // 防御性处理：正常情况下后端会拦截此事件并转为 CHAT_MESSAGE，
                // 但若意外到达前端，需手动构造最终消息以免流式内容丢失
                const doneMsg: ChatMessage = {
                    message_id: (data.task_id as string) || generateUUID(),
                    session_id: (data.session_id as string) || '',
                    sender: { id: 'ai', name: 'AI 助教', role: 'ai' },
                    content: (data.content as string) || '',
                    timing: { absolute_time: new Date().toISOString(), relative_minute: 0 },
                    metadata_info: { llm_provider: data.llm_provider as string } as unknown as import('../types').MessageMetadata,
                    created_at: new Date().toISOString(),
                    recipient_id: (data.is_private as boolean) ? (data.user_info as Record<string, string>)?.user_id : null,
                    status: 'sent',
                };
                if (data.is_private) {
                    addAiMessage(doneMsg);
                } else {
                    const doneSessionId = (data.session_id as string) || sessionId || '';
                    addGroupMessage(doneSessionId, doneMsg);
                }
                resetAiStream();
                break;
            }

            case 'AI_TYPING':
                if (data.is_typing === false) {
                    activeStreamTaskRef.current = null;
                    streamSeqRef.current = {};
                    resetAiStream();
                } else {
                    const taskId = typeof data.task_id === 'string'
                        ? data.task_id
                        : null;
                    // 新的 AI 回复开始时清空旧流式内容；重复的 typing 事件不重置当前流。
                    if (!taskId || activeStreamTaskRef.current !== taskId) {
                        activeStreamTaskRef.current = taskId;
                        streamSeqRef.current = {};
                        resetAiStream();
                    }
                    setAiTyping(true);
                }
                break;

            case 'SCAFFOLD_STATE_CHANGED':
                if (data.scaffold_id && data.is_active !== undefined) {
                    if (data.is_active === false) {
                        // 铁律 4：软关闭 — 隐藏按钮但不强关已打开的弹窗
                        handleScaffoldDisabled(data.scaffold_id as string);
                    } else {
                        updateScaffoldState(
                            data.scaffold_id as string,
                            data.is_active as boolean,
                        );
                    }
                }
                break;

            case 'SCAFFOLD_SUGGEST':
                // P2: AI 判断学生需要时的支架建议
                if (data.scaffolds) {
                    setScaffoldSuggestion({
                        scaffolds: data.scaffolds as { scaffold_id: string; label: string; content: string }[],
                        recommendedIndex: (data.recommended_index as number) || 0,
                        learningState: (data.learning_state as string) || 'exploring',
                    });
                }
                break;

            case 'WEB_SEARCH_RESULT':
                // P3: 搜索来源展示
                if (data.sources) {
                    setSearchSources(data.sources as { title: string; url: string; content: string }[]);
                }
                break;

            case 'STAGE_UPDATE': {
                // Design Thinking EDIPT 阶段切换广播
                const newStage = data.stage as string;
                const groupId = data.group_id as string;
                if (newStage) {
                    if (groupId) {
                        useGroupStore.getState().updateGroupStage(groupId, newStage);
                    }
                    window.dispatchEvent(new CustomEvent('edipt-stage-update', { detail: newStage }));
                }
                break;
            }

            case 'DRAWING_DONE': {
                // 绘图任务完成 — 插入草图
                const drawingContent = data.content as string;
                if (drawingContent) {
                    const drawingSessionId = (data.session_id as string) || sessionId || '';
                    const isPrivate = drawingSessionId === useAuthStore.getState().user?.user_id;
                    const imgMsg: ChatMessage = {
                        message_id: (data.task_id as string) || generateUUID(),
                        session_id: drawingSessionId,
                        sender: { id: 'ai', name: 'AI 助教', role: 'ai' },
                        content: drawingContent,
                        timing: { absolute_time: new Date().toISOString(), relative_minute: 0 },
                        metadata_info: { llm_provider: 'drawing' } as unknown as import('../types').MessageMetadata,
                        created_at: new Date().toISOString(),
                        recipient_id: isPrivate ? useAuthStore.getState().user?.user_id : null,
                        status: 'sent',
                    };
                    if (isPrivate) {
                        useChatStore.getState().addAiMessage(imgMsg);
                    } else {
                        addGroupMessage(drawingSessionId, imgMsg);
                    }
                }
                break;
            }

            case 'DRAWING_PROMPT_READY': {
                if (data.prompt) {
                    window.dispatchEvent(new CustomEvent('drawing-prompt-ready', { detail: data.prompt }));
                }
                break;
            }

            case 'MINDMAP_DRAFT': {
                // 铁律 2：AI 生成的脑图作为草稿展示，不直接合入
                const draftNodes = data.nodes as import('../types').MindMapNode[];
                const draftEdges = data.edges as import('../types').MindMapEdge[];
                if (draftNodes?.length) {
                    setDraft(draftNodes, draftEdges ?? []);
                }
                break;
            }

            case 'MINDMAP_DATA':
                setMindMapData(data as unknown as import('../types').MindMapData);
                break;

            case 'MINDMAP_GENERATING':
                setIsGenerating(data.is_generating as boolean);
                break;

            case 'MINDMAP_SYNC': {
                const op = data.operation as string;
                const payload = data.payload as Record<string, unknown>;
                switch (op) {
                    case 'add_node': addNode(payload as unknown as import('../types').MindMapNode); break;
                    case 'remove_node': removeNode(payload.id as string); break;
                    case 'update_node': updateNode(payload.id as string, payload); break;
                    case 'update_node_position': updateNodePosition(payload.id as string, payload.position as { x: number; y: number }); break;
                    case 'add_edge': addEdge(payload as unknown as import('../types').MindMapEdge); break;
                    case 'remove_edge': removeEdge(payload.id as string); break;
                    case 'update_edge': updateEdgeLabel(payload.id as string, String(payload.label || '')); break;
                }
                break;
            }

            case 'AI_CONVERSATION_TITLE': {
                // 对话自动标题生成完成
                const { conversation_id, title } = data as { conversation_id: string; title: string };
                if (conversation_id && title) {
                    // 动态导入避免循环依赖
                    import('../store/useAiConversationStore').then(({ useAiConversationStore }) => {
                        useAiConversationStore.getState().updateTitle(conversation_id, title);
                    });
                }
                break;
            }

            case 'PONG':
                // 客户端发出的 PING 的相应回复，直接忽略
                break;

            case 'USER_JOINED':
            case 'SESSION_LEFT':
                // 用户进出事件，无需强制重做逻辑，可以直接忽略
                break;

            case 'ERROR':
                console.error('[WS] Server error:', data);
                if (typeof data === 'object' && data && 'message' in data) {
                    // 非阻塞提示，避免 alert 阻塞 WS 事件循环导致连接断开
                    const errMsg = (data as { message: string }).message;
                    const toast = document.createElement('div');
                    toast.textContent = `⚠️ ${errMsg}`;
                    toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;padding:12px 24px;background:#ef4444;color:white;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s';
                    document.body.appendChild(toast);
                    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 5000);
                }
                break;

            default:
                // console.log('[WS] Unhandled:', eventName, data);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetHeartbeatTimeout]);

    const pendingMessagesRef = useRef<{ event: string; data: Record<string, unknown> }[]>([]);

    const connect = useCallback(() => {
        // 清理残留连接后再建新连接
        if (wsRef.current) {
            if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
                return; // 已有正常连接，不重复创建
            }
            // 连接已关闭/半关闭，清理引用
            wsRef.current = null;
        }
        if (!sessionId || !token) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let url = `${protocol}//${window.location.host}/ws/${sessionId}?token=${token}`;

        // 切换 session 时清空游标
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prevSessionId = (wsRef as any)._prevSessionId;
        if (prevSessionId !== sessionId) {
            lastMsgTimestampRef.current = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (wsRef as any)._prevSessionId = sessionId;
        }

        // 重连时附加游标，后端只返回游标之后的增量消息
        if (lastMsgTimestampRef.current) {
            url += `&cursor=${encodeURIComponent(lastMsgTimestampRef.current)}`;
            isReconnectRef.current = true;
        } else {
            isReconnectRef.current = false;
        }
        setConnectionState('connecting');
        const ws = new WebSocket(url);

        ws.onopen = () => {
            console.log('[WS] Connected:', sessionId);
            setConnectionState('connected');
            reconnectAttemptRef.current = 0; // 重置重连计数
            startHeartbeat();

            // 发送之前堆积在队列中的消息
            if (pendingMessagesRef.current.length > 0) {
                console.log(`[WS] Flushing ${pendingMessagesRef.current.length} pending messages`);
                pendingMessagesRef.current.forEach((msg) => {
                    ws.send(JSON.stringify(msg));
                });
                pendingMessagesRef.current = [];
            }
        };

        ws.onmessage = (event) => {
            try {
                const { event: eventName, data } = JSON.parse(event.data);
                handleEvent(eventName, data);
            } catch (e) {
                console.error('[WS] Parse error:', e);
            }
        };

        ws.onclose = (e) => {
            console.log('[WS] Closed:', e.code, e.reason);
            wsRef.current = null;
            stopHeartbeat();
            setConnectionState('disconnected');

            // P0-4: 断开时不清空聊天记录（注意：不调用 clearMessages）

            // 自动重连（非主动关闭 + 非认证失败）
            if (e.code !== 1000 && e.code !== 4001) {
                const attempt = reconnectAttemptRef.current;
                const delay = Math.min(
                    RECONNECT_BASE_MS * Math.pow(2, attempt),
                    RECONNECT_MAX_MS,
                );
                console.log(`[WS] Reconnecting in ${delay}ms (attempt ${attempt + 1})...`);
                reconnectAttemptRef.current = attempt + 1;
                reconnectTimerRef.current = setTimeout(connect, delay);
            }
        };

        ws.onerror = (e) => {
            console.error('[WS] Error:', e);
        };

        wsRef.current = ws;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, token]);

    const send = useCallback((event: string, data: Record<string, unknown>) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ event, data }));
        } else {
            console.log('[WS] Not connected, queueing message:', event);
            // 放入积压队列，等下一次 onopen 再发
            pendingMessagesRef.current.push({ event, data });

            // 自动触发重连
            if (connectionState !== 'connecting') {
                connect();
            }
        }
    }, [connect, connectionState]);

    const disconnect = useCallback(() => {
        stopHeartbeat();
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        if (wsRef.current) {
            wsRef.current.close(1000, 'Manual disconnect');
            wsRef.current = null;
        }
        pendingMessagesRef.current = []; // 清空队列
    }, [stopHeartbeat]);

    // 自动连接/断开
    useEffect(() => {
        connect();
        return () => disconnect();
    }, [connect, disconnect]);

    // 页面恢复可见时检查连接状态并重连
    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                // 页面从后台恢复，检查 WS 连接是否还活着
                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                    console.log('[WS] Page visible, connection lost, reconnecting...');
                    connect();
                }
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [connect]);

    return { send, disconnect, isConnected: connectionState === 'connected', connectionState };
}
