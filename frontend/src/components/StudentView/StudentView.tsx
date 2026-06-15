/**
 * 学生端主视图 — 三栏布局：侧边栏 + 聊天区 + 思维导图。
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
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
import { generateUUID } from '../../utils/uuid';
import { PanelRight, PanelRightClose, Menu, MessageSquare as ChatIcon, GitBranch, Search } from 'lucide-react';
import type { ChatMessage, GroupRoleInfo } from '../../types';
import { NotificationBell } from '../NotificationBell';

const MindMapPanel = React.lazy(() => import('../MindMap/MindMapPanel').then(mod => ({ default: mod.MindMapPanel })));
const AssignmentPanel = React.lazy(() => import('./AssignmentPanel').then(mod => ({ default: mod.AssignmentPanel })));
const MaterialsPanel = React.lazy(() => import('./MaterialsPanel').then(mod => ({ default: mod.MaterialsPanel })));
const LearningSpaceDesignPanel = React.lazy(() => import('./LearningSpaceDesignPanel').then(mod => ({ default: mod.LearningSpaceDesignPanel })));
const DeepSearchDialog = React.lazy(() => import('../Chat/DeepSearchDialog').then(mod => ({ default: mod.DeepSearchDialog })));
const DrawingPromptDialog = React.lazy(() => import('./DrawingPromptDialog').then(mod => ({ default: mod.DrawingPromptDialog })));

const PanelFallback: React.FC = () => (
    <div className="h-full flex items-center justify-center text-sm text-gray-400">
        加载中...
    </div>
);

/** 响应式断点 hook */
function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(
        () => typeof window !== 'undefined' && window.innerWidth >= 768
    );
    useEffect(() => {
        const mql = window.matchMedia('(min-width: 768px)');
        const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, []);
    return isDesktop;
}

type ChannelType = 'group' | 'ai' | 'materials' | 'assignment' | 'learning_space';

const ROLE_OBJECTION_REASONS = [
    '我不理解这个角色要做什么',
    '我觉得这个角色不适合我',
    '我已经连续担任类似角色',
    '小组内角色分工不合理',
    '其他原因',
];

export const StudentView: React.FC = () => {
    const [activeChannel, setActiveChannel] = useState<ChannelType>('ai');
    const [showMindMap, setShowMindMap] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [mobilePanel, setMobilePanel] = useState<'chat' | 'mindmap'>('chat');
    const [deepSearchOpen, setDeepSearchOpen] = useState(false);
    const isDesktop = useIsDesktop();
    const { setInputMessage } = useScaffoldStore();

    const [isDrawingDialogOpen, setIsDrawingDialogOpen] = useState(false);
    const [isDrawingPromptLoading, setIsDrawingPromptLoading] = useState(false);
    const [drawingPrompt, setDrawingPrompt] = useState('');
    const lastClickTimeRef = useRef<number>(0);

    const { user } = useAuthStore();
    const { groups, currentGroupId } = useGroupStore();
    const currentGroup = groups.find(g => g.id === currentGroupId);

    // Initial stage from group data
    const [currentStage, setCurrentStage] = useState<string>(currentGroup?.current_stage || '');
    const [groupRole, setGroupRole] = useState<GroupRoleInfo | null>(null);
    const [isRoleObjectionOpen, setIsRoleObjectionOpen] = useState(false);
    const [roleObjectionReason, setRoleObjectionReason] = useState(ROLE_OBJECTION_REASONS[0]);
    const [roleObjectionNote, setRoleObjectionNote] = useState('');
    const [isRoleObjectionSubmitting, setIsRoleObjectionSubmitting] = useState(false);

    // Sync from store if currentGroup changes, and allow WS to override it
    useEffect(() => {
        if (currentGroup?.current_stage) {
            setCurrentStage(currentGroup.current_stage);
        }
    }, [currentGroup?.current_stage]);

    useEffect(() => {
        if (!currentGroupId) {
            setGroupRole(null);
            return;
        }
        let cancelled = false;
        api.groups.role(currentGroupId)
            .then((role) => {
                if (!cancelled) setGroupRole(role);
            })
            .catch((e) => {
                console.error('Failed to load group role:', e);
                if (!cancelled) setGroupRole(null);
            });
        return () => { cancelled = true; };
    }, [currentGroupId]);

    const {
        groupMessagesBySession,
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
    const { send, connectionState } = useWebSocket(sessionId);

    // 计算思维导图分区键
    const mapKey = activeChannel === 'group' && currentGroupId
        ? `group:${currentGroupId}`
        : activeChannel === 'ai' && currentConversationId
            ? `conv:${currentConversationId}`
            : null;

    // 监听 EDIPT 阶段广播
    useEffect(() => {
        const handler = (e: Event) => setCurrentStage((e as CustomEvent<string>).detail);
        window.addEventListener('edipt-stage-update', handler);
        return () => window.removeEventListener('edipt-stage-update', handler);
    }, []);

    useEffect(() => {
        const promptHandler = (e: Event) => {
            setDrawingPrompt((e as CustomEvent<string>).detail);
            setIsDrawingPromptLoading(false);
        };
        window.addEventListener('drawing-prompt-ready', promptHandler);
        return () => window.removeEventListener('drawing-prompt-ready', promptHandler);
    }, []);

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
                    const conv = await createConversation(selectedProvider, currentGroupId || undefined);
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
                addGroupMessage(sessionId || '', optimisticMsg);
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
                // P2: 深度思考模式标记
                is_deep_thinking: !!metadata?.is_deep_thinking,
                // P3: 联网搜索标记
                enable_search: !!metadata?.enable_search,
            });
        },
        [send, activeChannel, selectedProvider, scaffolds, sessionId, user, addGroupMessage, addAiMessage, currentConversationId]
    );

    // 生成思维导图
    const handleGenerateMindMap = useCallback(() => {
        send('MINDMAP_GENERATE', { map_key: mapKey || '' });
    }, [send, mapKey]);

    // 发起设计草图请求
    const handleRequestDrawing = useCallback((customPrompt?: string | React.MouseEvent | undefined) => {
        const targetSessionId = activeChannel === 'ai' ? currentConversationId : currentGroupId;
        if (!targetSessionId) return;

        if (typeof customPrompt === 'string') {
           send('DESIGN_DRAWING', { api_provider: 'aliyun', custom_prompt: customPrompt, session_id: targetSessionId });
           setIsDrawingDialogOpen(false);
           return;
        }

        const now = Date.now();
        if (now - lastClickTimeRef.current < 5000) {
            console.log("Debounced drawing request");
            return;
        }
        lastClickTimeRef.current = now;

        setIsDrawingDialogOpen(true);
        setIsDrawingPromptLoading(true);
        setDrawingPrompt('');

        send('PREPARE_DRAWING', { llm_provider: 'deepseek', session_id: targetSessionId });
    }, [send, currentGroupId, activeChannel, currentConversationId]);

    // 思维导图编辑同步
    const handleMindMapEditSync = useCallback(
        (operation: string, payload: Record<string, unknown>) => {
            send('MINDMAP_EDIT', { operation, payload, map_key: mapKey || '' });
        },
        [send, mapKey]
    );

    const handleMindMapAskSuggestion = useCallback((question: string) => {
        const trimmed = question.trim();
        const prompt = trimmed.includes('请')
            ? trimmed
            : `${trimmed.replace(/？$/, '')} — 请帮我详细探讨这个方向`;
        setInputMessage(prompt);
        setActiveChannel('ai');
        setMobilePanel('chat');
    }, []);

    const handleSubmitRoleObjection = useCallback(async () => {
        if (!currentGroupId || !groupRole || groupRole.pending_objection) return;
        setIsRoleObjectionSubmitting(true);
        try {
            await api.groups.createRoleObjection(
                currentGroupId,
                roleObjectionReason,
                roleObjectionNote.trim() || null,
            );
            const updatedRole = await api.groups.role(currentGroupId);
            setGroupRole(updatedRole);
            setIsRoleObjectionOpen(false);
            setRoleObjectionNote('');
        } catch (err: any) {
            alert(err?.response?.data?.detail || '提交失败');
        } finally {
            setIsRoleObjectionSubmitting(false);
        }
    }, [currentGroupId, groupRole, roleObjectionNote, roleObjectionReason]);

    // P0 修复：直接订阅 groupMessagesBySession（响应式），按当前 sessionId 获取对应小组的消息
    // 未选择小组时显示空消息列表
    const groupMessages = (activeChannel === 'group' && currentGroupId)
        ? (groupMessagesBySession[currentGroupId] || [])
        : [];
    const currentMessages =
        activeChannel === 'ai' ? aiMessages : groupMessages;

    const groupRoleBanner = activeChannel === 'group' && currentGroupId && groupRole ? (
        <div className="px-4 py-2 border-b border-emerald-100 bg-emerald-50/80">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-medium text-emerald-600">我的本轮角色</span>
                        <span className="px-2 py-0.5 text-xs font-semibold text-emerald-700 bg-white border border-emerald-200 rounded-full">
                            {groupRole.role || '待分配'}
                        </span>
                        {groupRole.pending_objection && (
                            <span className="px-2 py-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full">
                                异议待处理
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-xs text-gray-600 line-clamp-2">{groupRole.prompt || groupRole.description}</p>
                </div>
                <button
                    onClick={() => setIsRoleObjectionOpen(true)}
                    disabled={!!groupRole.pending_objection}
                    className="flex-shrink-0 px-2.5 py-1 text-xs text-emerald-700 bg-white border border-emerald-200 rounded-md hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    提出异议
                </button>
            </div>
        </div>
    ) : null;

    const channelTitles: Record<ChannelType, string> = {
        group: currentGroupId ? '小组讨论' : '请先选择或创建小组',
        ai: 'AI 苏格拉底导师（1v1）',
        materials: '所有课程资料',
        assignment: '作业提交',
        learning_space: '学习空间设计',
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
                        {/* WS 连接状态指示器 */}
                        <div className="flex items-center gap-1.5 ml-2" title={
                            connectionState === 'connected' ? '已连接' :
                            connectionState === 'connecting' ? '正在连接...' : '连接断开，正在重连...'
                        }>
                            <span className={`inline-block w-2 h-2 rounded-full ${
                                connectionState === 'connected'
                                    ? 'bg-emerald-400'
                                    : connectionState === 'connecting'
                                        ? 'bg-amber-400 animate-pulse'
                                        : 'bg-red-400 animate-pulse'
                            }`} />
                            {connectionState !== 'connected' && (
                                <span className="text-[11px] text-gray-400">
                                    {connectionState === 'connecting' ? '连接中' : '已断开'}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* 移动端聊天/导图切换（仅非作业/资料页面） */}
                        {activeChannel !== 'assignment' && activeChannel !== 'materials' && activeChannel !== 'learning_space' && (
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
                        {activeChannel !== 'assignment' && activeChannel !== 'materials' && activeChannel !== 'learning_space' && (
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
                        {/* P3: 通知铃铛 + DeepSearch 按钮 */}
                        <NotificationBell />
                        <button
                            onClick={() => setDeepSearchOpen(true)}
                            className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="深度调研"
                        >
                            <Search className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">深度调研</span>
                        </button>
                    </div>
                </div>

                {/* ── 内容区：桌面用 absolute 动画，移动用 flex 全宽 ── */}
                {isDesktop ? (
                    /* ====== 桌面端：absolute 定位 + left/right 滑动过渡 ====== */
                    <div className="flex-1 relative overflow-hidden p-3">
                        {/* 聊天区 */}
                        <div
                            className="absolute top-3 bottom-3 transition-all duration-500 ease-in-out"
                            style={activeChannel === 'assignment' || activeChannel === 'learning_space' ? {
                                left: '12px', right: '12px',
                            } : {
                                width: '48%',
                                left: showMindMap ? '12px' : '26%',
                            }}
                        >
                            {activeChannel === 'assignment' ? (
                                <React.Suspense fallback={<PanelFallback />}>
                                    <AssignmentPanel />
                                </React.Suspense>
                            ) : activeChannel === 'learning_space' ? (
                                <React.Suspense fallback={<PanelFallback />}>
                                    <LearningSpaceDesignPanel />
                                </React.Suspense>
                            ) : activeChannel === 'materials' ? (
                                <React.Suspense fallback={<PanelFallback />}>
                                    <MaterialsPanel />
                                </React.Suspense>
                            ) : (
                                <ChatInterface
                                    messages={currentMessages}
                                    onSend={handleSend}
                                    title={activeChannel === 'ai' ? 'AI 1v1 对话' : '小组讨论'}
                                    showScaffolds={true}
                                    isAiChannel={activeChannel === 'ai'}
                                    disabled={activeChannel === 'group' && !currentGroupId}
                                    currentStage={activeChannel === 'group' ? currentStage : undefined}
                                    headerAccessory={groupRoleBanner}
                                    onRequestDrawing={handleRequestDrawing}
                                />
                            )}
                        </div>
                        {/* 思维导图区 — 从右侧滑入 */}
                        {activeChannel !== 'assignment' && activeChannel !== 'materials' && activeChannel !== 'learning_space' && (
                            <div
                                className="absolute top-3 bottom-3 transition-all duration-500 ease-in-out"
                                style={{
                                    width: 'calc(50% - 24px)',
                                    right: showMindMap ? '12px' : 'calc(-50%)',
                                    opacity: showMindMap ? 1 : 0,
                                }}
                            >
                                <React.Suspense fallback={<PanelFallback />}>
                                    <MindMapPanel
                                        onGenerate={handleGenerateMindMap}
                                        onEditSync={handleMindMapEditSync}
                                        onSend={send}
                                        mapKey={mapKey || undefined}
                                        onAskSuggestion={handleMindMapAskSuggestion}
                                    />
                                </React.Suspense>
                            </div>
                        )}
                    </div>
                ) : (
                    /* ====== 移动端：flex 全宽 + block/hidden 切换 ====== */
                    <div className="flex-1 flex flex-col overflow-hidden p-2">
                        {/* 聊天区 — 选中时占满 */}
                        <div className={`min-h-0 ${
                            activeChannel === 'assignment' || activeChannel === 'materials' || activeChannel === 'learning_space'
                                ? 'flex-1'
                                : mobilePanel === 'chat' ? 'flex-1' : 'hidden'
                        }`}>
                            {activeChannel === 'assignment' ? (
                                <React.Suspense fallback={<PanelFallback />}>
                                    <AssignmentPanel />
                                </React.Suspense>
                            ) : activeChannel === 'learning_space' ? (
                                <React.Suspense fallback={<PanelFallback />}>
                                    <LearningSpaceDesignPanel />
                                </React.Suspense>
                            ) : activeChannel === 'materials' ? (
                                <React.Suspense fallback={<PanelFallback />}>
                                    <MaterialsPanel />
                                </React.Suspense>
                            ) : (
                                <ChatInterface
                                    messages={currentMessages}
                                    onSend={handleSend}
                                    title={activeChannel === 'ai' ? 'AI 1v1 对话' : '小组讨论'}
                                    showScaffolds={true}
                                    isAiChannel={activeChannel === 'ai'}
                                    disabled={activeChannel === 'group' && !currentGroupId}
                                    currentStage={activeChannel === 'group' ? currentStage : undefined}
                                    headerAccessory={groupRoleBanner}
                                    onRequestDrawing={handleRequestDrawing}
                                />
                            )}
                        </div>
                        {/* 思维导图区 — 选中时占满 */}
                        {activeChannel !== 'assignment' && activeChannel !== 'materials' && activeChannel !== 'learning_space' && (
                            <div className={`min-h-0 ${mobilePanel === 'mindmap' ? 'flex-1' : 'hidden'}`}>
                                <React.Suspense fallback={<PanelFallback />}>
                                    <MindMapPanel
                                        onGenerate={handleGenerateMindMap}
                                        onEditSync={handleMindMapEditSync}
                                        onSend={send}
                                        mapKey={mapKey || undefined}
                                        onAskSuggestion={handleMindMapAskSuggestion}
                                    />
                                </React.Suspense>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* P3: DeepSearch 弹窗 */}
            {deepSearchOpen && (
                <React.Suspense fallback={null}>
                    <DeepSearchDialog
                        open={deepSearchOpen}
                        onClose={() => setDeepSearchOpen(false)}
                        sessionId={sessionId || undefined}
                    />
                </React.Suspense>
            )}

            {/* AI 绘图预设确认弹窗 */}
            {isDrawingDialogOpen && (
                <React.Suspense fallback={null}>
                    <DrawingPromptDialog
                        isOpen={isDrawingDialogOpen}
                        isLoading={isDrawingPromptLoading}
                        initialPrompt={drawingPrompt}
                        onConfirm={handleRequestDrawing}
                        onCancel={() => setIsDrawingDialogOpen(false)}
                    />
                </React.Suspense>
            )}

            {isRoleObjectionOpen && groupRole && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setIsRoleObjectionOpen(false)}>
                    <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <div className="border-b border-gray-100 px-5 py-4">
                            <h3 className="text-sm font-semibold text-gray-900">提出角色异议</h3>
                            <p className="mt-1 text-xs text-gray-500">当前角色：{groupRole.role || '待分配'}</p>
                        </div>
                        <div className="space-y-4 px-5 py-4">
                            <label className="block">
                                <span className="mb-1 block text-xs font-medium text-gray-500">原因</span>
                                <select
                                    value={roleObjectionReason}
                                    onChange={(e) => setRoleObjectionReason(e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                                >
                                    {ROLE_OBJECTION_REASONS.map((reason) => (
                                        <option key={reason} value={reason}>{reason}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <span className="mb-1 block text-xs font-medium text-gray-500">补充说明</span>
                                <textarea
                                    value={roleObjectionNote}
                                    onChange={(e) => setRoleObjectionNote(e.target.value)}
                                    rows={3}
                                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none"
                                    placeholder="可以说明你希望老师考虑的情况"
                                />
                            </label>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
                            <button
                                onClick={() => setIsRoleObjectionOpen(false)}
                                className="px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 rounded-md"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSubmitRoleObjection}
                                disabled={isRoleObjectionSubmitting}
                                className="px-3 py-1.5 text-sm text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
                            >
                                {isRoleObjectionSubmitting ? '提交中...' : '提交'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
