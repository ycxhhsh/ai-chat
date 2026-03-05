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
import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useChatStore } from '../store/useChatStore';
import { useScaffoldStore } from '../store/useScaffoldStore';
import { useMindMapStore } from '../store/useMindMapStore';
import type { ChatMessage } from '../types';

// 心跳配置
const HEARTBEAT_INTERVAL = 25_000; // 25 秒发一次 PONG
const HEARTBEAT_TIMEOUT = 60_000;  // 60 秒内没收到 PING 视为断连（宽松值，避免 LLM 繁忙时误断）

// 重连配置
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function useWebSocket(sessionId: string | null) {
    const wsRef = useRef<WebSocket | null>(null);
    const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { token } = useAuthStore();

    const {
        addGroupMessage,
        addAiMessage,
        setGroupMessages,
        setAiMessages,
        setAiTyping,
        appendAiStream,
        resetAiStream,
        setAvailableProviders,
        updateMessageStatus,
    } = useChatStore();

    const { updateScaffoldState, setScaffolds, handleScaffoldDisabled } = useScaffoldStore();
    const { setMindMapData, setIsGenerating, setDraft, addNode, removeNode, updateNode, addEdge, removeEdge } = useMindMapStore();

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

    // 重置心跳超时（收到服务端 PING 后调用）
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
        resetHeartbeatTimeout();
    }, [stopHeartbeat, resetHeartbeatTimeout]);

    const handleEvent = useCallback((eventName: string, data: Record<string, unknown>) => {
        switch (eventName) {
            case 'PING':
                // 收到服务端心跳，回复 PONG 并重置超时
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send('{"event":"PONG","data":{}}');
                }
                resetHeartbeatTimeout();
                break;

            case 'SESSION_JOINED':
                if (data.available_providers) {
                    setAvailableProviders(data.available_providers as Array<{ name: string; display_name: string; model: string }>);
                }
                // P0-2: 初始化支架列表
                if (data.scaffolds && Array.isArray(data.scaffolds)) {
                    setScaffolds(data.scaffolds as Array<{ scaffold_id: string; display_name: string; prompt_template: string; is_active: boolean; sort_order: number }>);
                }
                // P0-2: 初始化历史消息 — 始终替换，确保切换小组后消息正确
                if (data.recent_messages && Array.isArray(data.recent_messages)) {
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
                    // 始终设置，即使为空 — 确保旧消息被清除
                    setGroupMessages(groupMsgs);
                    setAiMessages(aiMsgs);
                }
                break;

            case 'CHAT_MESSAGE': {
                const msg = data as unknown as ChatMessage;
                const isAiPrivate =
                    (msg.sender?.role === 'ai' && msg.recipient_id) ||
                    msg.recipient_id === 'ai';
                if (isAiPrivate) {
                    addAiMessage(msg);
                } else {
                    addGroupMessage(msg);
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
                if (data.chunk) appendAiStream(data.chunk as string);
                break;

            case 'AI_REPLY_DONE': {
                // 防御性处理：正常情况下后端会拦截此事件并转为 CHAT_MESSAGE，
                // 但若意外到达前端，需手动构造最终消息以免流式内容丢失
                const doneMsg: ChatMessage = {
                    message_id: (data.task_id as string) || crypto.randomUUID(),
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
                    addGroupMessage(doneMsg);
                }
                resetAiStream();
                break;
            }

            case 'AI_TYPING':
                if (data.is_typing === false) {
                    resetAiStream();
                } else {
                    // 新的 AI 回复开始 — 先清空旧流式内容，防止累积
                    resetAiStream();
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
                    case 'add_edge': addEdge(payload as unknown as import('../types').MindMapEdge); break;
                    case 'remove_edge': removeEdge(payload.id as string); break;
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
                console.log('[WS] Unhandled:', eventName, data);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetHeartbeatTimeout]);

    const connect = useCallback(() => {
        if (!sessionId || !token || wsRef.current) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws/${sessionId}?token=${token}`;
        const ws = new WebSocket(url);

        ws.onopen = () => {
            console.log('[WS] Connected:', sessionId);
            reconnectAttemptRef.current = 0; // 重置重连计数
            startHeartbeat();
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
            console.warn('[WS] Not connected, cannot send:', event);
            // 用户可见提示
            const toast = document.createElement('div');
            toast.textContent = '⚠️ 连接已断开，正在重连...';
            toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 20px;background:#f59e0b;color:white;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s';
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
        }
    }, []);

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
    }, [stopHeartbeat]);

    // 自动连接/断开
    useEffect(() => {
        connect();
        return () => disconnect();
    }, [connect, disconnect]);

    return { send, disconnect, isConnected: !!wsRef.current };
}
