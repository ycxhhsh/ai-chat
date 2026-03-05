/**
 * 学生端主视图 — 三栏布局：侧边栏 + 聊天区 + 思维导图。
 */
import React, { useState, useCallback, useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useGroupStore } from '../../store/useGroupStore';
import { useChatStore } from '../../store/useChatStore';
import { useScaffoldStore } from '../../store/useScaffoldStore';
import { useAiConversationStore } from '../../store/useAiConversationStore';
import { useWebSocket } from '../../hooks/useWebSocket';
import { api } from '../../api';
import { Sidebar } from './Sidebar';
import { ChatInterface } from '../Chat/ChatInterface';
import { MindMapPanel } from '../MindMap/MindMapPanel';
import { AssignmentPanel } from './AssignmentPanel';
import { generateUUID } from '../../utils/uuid';
import { PanelRight, PanelRightClose } from 'lucide-react';
import type { ChatMessage } from '../../types';

type ChannelType = 'group' | 'ai' | 'assignment';

export const StudentView: React.FC = () => {
    const [activeChannel, setActiveChannel] = useState<ChannelType>('group');
    const [showMindMap, setShowMindMap] = useState(true);

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
    const { scaffolds } = useScaffoldStore();
    const {
        currentConversationId,
        createConversation,
    } = useAiConversationStore();

    // 使用小组 ID 或用户 ID 作为 WS session
    const sessionId = currentGroupId || user?.user_id || null;
    const { send } = useWebSocket(sessionId);

    // 切换对话时加载历史消息
    useEffect(() => {
        if (!currentConversationId || activeChannel !== 'ai') return;
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
        send('MINDMAP_GENERATE', {});
    }, [send]);

    // 思维导图编辑同步
    const handleMindMapEditSync = useCallback(
        (operation: string, payload: Record<string, unknown>) => {
            send('MINDMAP_EDIT', { operation, payload });
        },
        [send]
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
            {/* 侧边栏 */}
            <Sidebar
                activeChannel={activeChannel}
                onChannelChange={setActiveChannel}
            />

            {/* 主内容区 */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* 顶部工具栏 */}
                <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
                    <h1 className="text-sm font-semibold text-gray-900">
                        {channelTitles[activeChannel]}
                    </h1>
                    {activeChannel !== 'assignment' && (
                        <button
                            onClick={() => setShowMindMap(!showMindMap)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 hover:text-primary hover:bg-primary-light rounded-lg transition-colors"
                        >
                            {showMindMap ? (
                                <><PanelRightClose className="w-4 h-4" /> 隐藏导图</>
                            ) : (
                                <><PanelRight className="w-4 h-4" /> 显示导图</>
                            )}
                        </button>
                    )}
                </div>

                {/* 聊天 + 思维导图 */}
                <div className="flex-1 flex overflow-hidden p-3 gap-3">
                    {/* 聊天区 */}
                    <div className={showMindMap && activeChannel !== 'assignment' ? 'w-1/2' : 'w-full'}>
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

                    {/* 思维导图区 */}
                    {showMindMap && activeChannel !== 'assignment' && (
                        <div className="w-1/2">
                            <MindMapPanel
                                onGenerate={handleGenerateMindMap}
                                onEditSync={handleMindMapEditSync}
                                onSend={send}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
