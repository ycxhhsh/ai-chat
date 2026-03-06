/**
 * 学生端主视图 — 三栏布局：侧边栏 + 聊天区 + 思维导图。
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useGroupStore } from '../../store/useGroupStore';
import { useChatStore } from '../../store/useChatStore';
import { useScaffoldStore } from '../../store/useScaffoldStore';
import { useAiConversationStore } from '../../store/useAiConversationStore';
import { useMindMapStore } from '../../store/useMindMapStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { api } from '../../api';
import { Sidebar } from './Sidebar';
import { ChatInterface } from '../Chat/ChatInterface';
import { MindMapPanel } from '../MindMap/MindMapPanel';
import { AssignmentPanel } from './AssignmentPanel';
import { generateUUID } from '../../utils/uuid';
import { PanelRight, PanelRightClose, Menu, MessageSquare as ChatIcon, GitBranch } from 'lucide-react';
import type { ChatMessage } from '../../types';

type ChannelType = 'group' | 'ai' | 'assignment';

export const StudentView: React.FC = () => {
    const [activeChannel, setActiveChannel] = useState<ChannelType>('group');
    const [showMindMap, setShowMindMap] = useState(true);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [mobilePanel, setMobilePanel] = useState<'chat' | 'mindmap'>('chat');
    const { setInputMessage } = useScaffoldStore();

    const { user } = useAuthStore();
    const { currentGroupId } = useGroupStore();
    const {
        groupMessages,
        aiMessages,
        addGroupMessage,
        addAiMessage,
        setAiMessages,
        selectedProvider,
    } = useChatStore();
    const { scaffolds, fetchScaffolds } = useScaffoldStore();
    const {
        currentConversationId,
        createConversation,
    } = useAiConversationStore();
    const { loadMindMap } = useMindMapStore();

    // 使用小组 ID 或用户 ID 作为 WS session
    const sessionId = currentGroupId || user?.user_id || null;
    const { send } = useWebSocket(sessionId);

    // 计算思维导图分区键
    const mapKey = activeChannel === 'group' && currentGroupId
        ? `group:${currentGroupId}`
        : activeChannel === 'ai' && currentConversationId
            ? `conv:${currentConversationId}`
            : null;

    // 定期轮询支架状态（15s），确保教师端开闭同步到学生端
    useEffect(() => {
        fetchScaffolds().catch(() => { });
        const timer = setInterval(() => {
            fetchScaffolds().catch(() => { });
        }, 15_000);
        return () => clearInterval(timer);
    }, [fetchScaffolds]);

    // 切换对话时加载历史消息
    useEffect(() => {
        if (activeChannel !== 'ai') return;
        // 没有选中对话时，清空消息区（显示空白等待用户选择）
        if (!currentConversationId) {
            setAiMessages([]);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const msgs = await api.aiConversations.getMessages(currentConversationId);
                if (!cancelled) {
                    setAiMessages(msgs.map((m: ChatMessage) => ({ ...m, status: 'sent' as const })));
                }
            } catch (e) {
                console.error('Failed to load conversation messages:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [currentConversationId, activeChannel, setAiMessages]);

    // 切换频道/对话时加载对应思维导图
    useEffect(() => {
        if (mapKey) {
            loadMindMap(mapKey);
        }
    }, [mapKey, loadMindMap]);

    // 发送消息
    const handleSend = useCallback(
        async (content: string, metadata?: Record<string, unknown>) => {
            const mentions: string[] = [];
            if (content.toLowerCase().includes('@ai')) {
                mentions.push('ai');
            }

            // AI 频道：确保有对话会话
            let convId = currentConversationId;
            if (activeChannel === 'ai' && !convId) {
                try {
                    const conv = await createConversation(selectedProvider);
                    convId = conv.conversation_id;
                } catch (e) {
                    console.error('Auto-create conversation failed:', e);
                    return;
                }
            }

            // 合并 ChatInput 传入的支架元数据
            const scaffoldInfo = metadata?.scaffold_info || null;
            const isScaffoldUsed = metadata?.is_scaffold_used || false;
            const requestId = (metadata?.request_id as string) || generateUUID();

            // 构造本地乐观消息
            const optimisticMsg: ChatMessage = {
                message_id: requestId, // 临时 ID，ACK 后可能更新
                session_id: sessionId || '',
                sender: {
                    id: user?.user_id || '',
                    name: user?.name || 'Me',
                    role: 'student',
                },
                content,
                timing: {
                    absolute_time: new Date().toISOString(),
                    relative_minute: 0,
                },
                metadata_info: {
                    mentions,
                    is_scaffold_used: !!isScaffoldUsed,
                    scaffold_info: scaffoldInfo as { id: string; name: string } | undefined,
                },
                created_at: new Date().toISOString(),
                recipient_id: activeChannel === 'ai' ? 'ai' : null,
                status: 'sending',
                request_id: requestId,
            };

            // 乐观添加到消息列表
            if (activeChannel === 'ai') {
                addAiMessage(optimisticMsg);
            } else {
                addGroupMessage(optimisticMsg);
            }

            send('CHAT_SEND', {
                content,
                target_user: activeChannel === 'ai' ? 'ai' : null,
                request_id: requestId,
                conversation_id: activeChannel === 'ai' ? convId : null,
                metadata: {
                    mentions,
                    is_scaffold_used: !!isScaffoldUsed,
                    scaffold_info: scaffoldInfo,
                    ...metadata,
                },
                llm_provider: selectedProvider,
            });
        },
        [send, activeChannel, selectedProvider, scaffolds, sessionId, user, addGroupMessage, addAiMessage, currentConversationId]
    );

    // 生成思维导图
    const handleGenerateMindMap = useCallback(() => {
        send('MINDMAP_GENERATE', { map_key: mapKey || '' });
    }, [send, mapKey]);

    // 思维导图编辑同步
    const handleMindMapEditSync = useCallback(
        (operation: string, payload: Record<string, unknown>) => {
            send('MINDMAP_EDIT', { operation, payload, map_key: mapKey || '' });
        },
        [send, mapKey]
    );

    // 当前频道的消息
    const currentMessages =
        activeChannel === 'ai' ? aiMessages : groupMessages;

    const channelTitles: Record<ChannelType, string> = {
        group: currentGroupId ? '小组讨论' : '请先选择或创建小组',
        ai: 'AI 苏格拉底导师（1v1）',
        assignment: '作业提交',
    };

    return (
        <div className="h-screen flex bg-gray-50">
            {/* 移动端侧边栏遮罩 */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/40 z-40 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* 侧边栏：桌面端始终可见，移动端抽屉触发 */}
            <div className={`
                fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out
                md:relative md:translate-x-0
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <Sidebar
                    activeChannel={activeChannel}
                    onChannelChange={(ch) => { setActiveChannel(ch); setSidebarOpen(false); }}
                />
            </div>

            {/* 主内容区 */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* 顶部工具栏 */}
                <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
                    <div className="flex items-center gap-2">
                        {/* 汉堡菜单（仅移动端） */}
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg md:hidden"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                        <h1 className="text-sm font-semibold text-gray-900">
                            {channelTitles[activeChannel]}
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* 移动端聊天/导图切换（仅非作业页面） */}
                        {activeChannel !== 'assignment' && (
                            <div className="flex md:hidden bg-gray-100 rounded-lg p-0.5">
                                <button
                                    onClick={() => setMobilePanel('chat')}
                                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${mobilePanel === 'chat'
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-500'
                                        }`}
                                >
                                    <ChatIcon className="w-3.5 h-3.5 inline mr-1" />对话
                                </button>
                                <button
                                    onClick={() => setMobilePanel('mindmap')}
                                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${mobilePanel === 'mindmap'
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-500'
                                        }`}
                                >
                                    <GitBranch className="w-3.5 h-3.5 inline mr-1" />导图
                                </button>
                            </div>
                        )}
                        {/* 桌面端导图切换 */}
                        {activeChannel !== 'assignment' && (
                            <button
                                onClick={() => setShowMindMap(!showMindMap)}
                                className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-primary hover:bg-primary-light rounded-lg transition-colors"
                            >
                                {showMindMap ? (
                                    <><PanelRightClose className="w-4 h-4" /> 隐藏导图</>
                                ) : (
                                    <><PanelRight className="w-4 h-4" /> 显示导图</>
                                )}
                            </button>
                        )}
                    </div>
                </div>

                {/* 聊天 + 思维导图 */}
                <div className="flex-1 flex overflow-hidden p-2 md:p-3 gap-2 md:gap-3">
                    {/* 聊天区：移动端根据 mobilePanel 显示/隐藏，桌面端始终显示 */}
                    <div className={`
                        ${activeChannel === 'assignment' ? 'w-full' :
                            showMindMap ? 'md:w-1/2' : 'w-full'}
                        ${mobilePanel === 'chat' ? 'block' : 'hidden'} md:block
                        w-full
                    `}>
                        {activeChannel === 'assignment' ? (
                            <AssignmentPanel />
                        ) : (
                            <ChatInterface
                                messages={currentMessages}
                                onSend={handleSend}
                                title={activeChannel === 'ai' ? 'AI 1v1 对话' : '小组讨论'}
                                showScaffolds={true}
                                isAiChannel={activeChannel === 'ai'}
                            />
                        )}
                    </div>

                    {/* 思维导图区：移动端根据 mobilePanel 显示/隐藏，桌面端根据 showMindMap */}
                    {activeChannel !== 'assignment' && (
                        <div className={`
                            w-full md:w-1/2
                            ${mobilePanel === 'mindmap' ? 'block' : 'hidden'}
                            ${showMindMap ? 'md:block' : 'md:hidden'}
                        `}>
                            <MindMapPanel
                                onGenerate={handleGenerateMindMap}
                                onEditSync={handleMindMapEditSync}
                                onSend={send}
                                mapKey={mapKey || undefined}
                                onAskSuggestion={(question) => {
                                    setInputMessage(question.replace(/？$/, '') + ' — 请帮我详细探讨这个方向');
                                    setActiveChannel('ai');
                                    setMobilePanel('chat');
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
