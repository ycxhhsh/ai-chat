import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useGroupStore } from '../../store/useGroupStore';
import { useChatStore } from '../../store/useChatStore';
import { useAsyncTaskStore } from '../../store/useAsyncTaskStore';
import { generateUUID } from '../../utils/uuid';
import type {
    LearningSpaceAccelerationCheck,
    LearningSpaceEntry,
    LearningSpaceMessage,
    LearningSpaceSessionPayload,
    LearningSpaceStepKey,
    LearningSpaceStudentQuestionItem,
} from '../../types';
import { LearningSpaceDesignReport } from '../LearningSpaceDesign/LearningSpaceDesignReport';
import { MarkdownContent } from '../Chat/MarkdownContent';

const STEP_LABELS: Record<LearningSpaceStepKey, string> = {
    self_think: '自主思考',
    ai_question: '对话提问',
    verify: '获取验证',
    challenge: '追问/反驳',
    integrate: '深化整合',
};

const STEP_GUIDES: Record<LearningSpaceStepKey, { goal: string; example: string }> = {
    self_think: {
        goal: '先写出自己的初始判断、依据和困惑，不急着让 AI 代替完成。',
        example: '我认为当前学习空间最大的问题是……依据是……我还不确定……',
    },
    ai_question: {
        goal: '向 AI 提出澄清、比较或漏洞发现问题，让初始想法变得更具体。',
        example: '请指出我这个方案里最容易被忽略的使用者需求。',
    },
    verify: {
        goal: '补充资料、案例、访谈或反馈，用证据检验前一步想法。',
        example: '我用……资料验证了……，它支持/修正了我的判断。',
    },
    challenge: {
        goal: '主动追问、反驳或请 AI 从反方视角挑战方案边界。',
        example: '请从反方角度质疑我的结论，并指出需要补证的地方。',
    },
    integrate: {
        goal: '整合自主思考、AI 对话、验证证据和反驳回应，形成最终观点。',
        example: '综合前面的证据和反驳，我将方案修订为……',
    },
};

const STAGE_ORDER = ['入项与启动', '规划与构建', '探究与创作', '展示与评价'];
const TEXT_STEPS: LearningSpaceStepKey[] = ['self_think', 'verify', 'integrate'];

export const LearningSpaceDesignPanel: React.FC = () => {
    const { currentGroupId } = useGroupStore();
    const { selectedProvider } = useChatStore();
    const startTask = useAsyncTaskStore((state) => state.startTask);
    const completeTask = useAsyncTaskStore((state) => state.completeTask);
    const failTask = useAsyncTaskStore((state) => state.failTask);
    const asyncTasks = useAsyncTaskStore((state) => state.tasks);
    const [items, setItems] = useState<LearningSpaceStudentQuestionItem[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [payload, setPayload] = useState<LearningSpaceSessionPayload | null>(null);
    const [report, setReport] = useState<any | null>(null);
    const [loading, setLoading] = useState(false);
    const [textDraft, setTextDraft] = useState('');
    const [chatDraft, setChatDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [viewMode, setViewMode] = useState<'workspace' | 'report'>('workspace');
    const [notice, setNotice] = useState('');

    const loadQuestions = async () => {
        const data = await api.learningSpaceDesign.studentQuestions();
        setItems(data);
        if (!selectedSessionId) {
            const firstStarted = data.find((item) => item.session)?.session?.id || null;
            if (firstStarted) setSelectedSessionId(firstStarted);
        }
    };

    const loadSession = useCallback(async (sessionId: string) => {
        setLoading(true);
        try {
            const data = await api.learningSpaceDesign.getSession(sessionId);
            setPayload(data);
            setTextDraft(currentTextContent(data));
            if (data.session.status === 'completed') {
                setReport(await api.learningSpaceDesign.report(sessionId));
            } else {
                setReport(null);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadQuestions().catch((error) => console.error('Load learning space design questions failed:', error));
    }, []);

    useEffect(() => {
        if (selectedSessionId) {
            loadSession(selectedSessionId).catch((error) => console.error('Load learning space session failed:', error));
        }
    }, [selectedSessionId, loadSession]);

    const groupedItems = useMemo(() => {
        return STAGE_ORDER.map((stageName) => ({
            stageName,
            items: items.filter((item) => item.question.stage_name === stageName),
        }));
    }, [items]);

    const currentStep = payload?.session.current_step;
    const currentEntry = payload && currentStep ? payload.entries.find((entry) => entry.step_key === currentStep) : undefined;
    const currentMessages = payload && currentStep ? payload.messages.filter((message) => message.step_key === currentStep) : [];
    const currentChecks = payload && currentStep
        ? payload.acceleration_checks.filter((check) => check.step_key === currentStep)
        : [];

    useEffect(() => {
        if (!payload) return;
        const savedDraft = currentStep
            ? window.localStorage.getItem(draftKey(payload.session.id, currentStep))
            : null;
        setTextDraft(savedDraft ?? currentTextContent(payload));
    }, [payload?.session.current_step, payload?.entries.length]);

    useEffect(() => {
        if (!payload || !currentStep || !TEXT_STEPS.includes(currentStep)) return;
        window.localStorage.setItem(draftKey(payload.session.id, currentStep), textDraft);
    }, [payload?.session.id, currentStep, textDraft]);

    const handleStart = async (questionId: string) => {
        const session = await api.learningSpaceDesign.startSession(questionId, currentGroupId);
        await loadQuestions();
        setSelectedSessionId(session.id);
        setViewMode('workspace');
    };

    const handleOpenReport = async (sessionId: string) => {
        setLoading(true);
        setNotice('');
        try {
            setSelectedSessionId(sessionId);
            setReport(await api.learningSpaceDesign.report(sessionId));
            setViewMode('report');
        } catch (error: any) {
            setNotice(error?.response?.data?.detail || '报告加载失败，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveText = async () => {
        if (!payload || !currentStep) return;
        setSaving(true);
        setNotice('');
        try {
            if (currentEntry) {
                await api.learningSpaceDesign.updateEntry(payload.session.id, currentEntry.id, textDraft);
            } else {
                await api.learningSpaceDesign.createEntry(payload.session.id, currentStep, textDraft);
            }
            window.localStorage.removeItem(draftKey(payload.session.id, currentStep));
            setNotice('内容已保存');
            await loadSession(payload.session.id);
        } catch (error: any) {
            setNotice(error?.response?.data?.detail || '保存失败，请检查内容后重试');
        } finally {
            setSaving(false);
        }
    };

    const handleSendAi = async (contentOverride?: string, providerOverride?: string) => {
        const content = (contentOverride ?? chatDraft).trim();
        if (!payload || !currentStep || !content) return;
        const taskId = generateUUID();
        const provider = providerOverride || selectedProvider;
        setSaving(true);
        setNotice('');
        startTask({
            taskId,
            type: 'learning_space_ai',
            title: 'AI 正在回应本步骤',
            status: 'running',
            progressText: 'AI 正在回应本步骤',
            retryable: true,
            retryPayload: {
                kind: 'learning_space_ai',
                sessionId: payload.session.id,
                stepKey: currentStep,
                content,
                provider,
            },
            source: 'http',
            relatedId: payload.session.id,
        });
        try {
            await api.learningSpaceDesign.sendAiMessage(payload.session.id, currentStep, content, provider);
            completeTask(taskId);
            setChatDraft('');
            await loadSession(payload.session.id);
        } catch (error: any) {
            failTask(taskId, error?.response?.data?.detail || 'AI 回应失败，请稍后重试');
            setNotice(error?.response?.data?.detail || '发送失败，请稍后重试');
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
            if (detail?.sessionId && detail.sessionId === payload?.session.id) {
                loadSession(detail.sessionId).catch((error) => console.error('Reload learning space session failed:', error));
            }
        };
        window.addEventListener('learning-space-ai-completed', handler);
        return () => window.removeEventListener('learning-space-ai-completed', handler);
    }, [payload?.session.id, loadSession]);

    const handleSubmitStep = async () => {
        if (!payload || !currentStep) return;
        setSaving(true);
        setNotice('');
        try {
            if (TEXT_STEPS.includes(currentStep)) {
                if (currentEntry) {
                    await api.learningSpaceDesign.updateEntry(payload.session.id, currentEntry.id, textDraft);
                } else {
                    await api.learningSpaceDesign.createEntry(payload.session.id, currentStep, textDraft);
                }
            }
            await api.learningSpaceDesign.submitStep(payload.session.id, currentStep);
            window.localStorage.removeItem(draftKey(payload.session.id, currentStep));
            await loadSession(payload.session.id);
            await loadQuestions();
        } catch (error: any) {
            setNotice(error?.response?.data?.detail || '提交失败，请先完成当前步骤要求');
        } finally {
            setSaving(false);
        }
    };

    const handleCheckAcceleration = async () => {
        if (!payload || !currentStep || !textDraft.trim()) return;
        setSaving(true);
        setNotice('');
        try {
            await api.learningSpaceDesign.checkAcceleration(payload.session.id, currentStep, textDraft, selectedProvider);
            await loadSession(payload.session.id);
        } catch (error: any) {
            setNotice(error?.response?.data?.detail || 'AI 判断失败，请稍后重试');
        } finally {
            setSaving(false);
        }
    };

    const handleAdoptAcceleration = async (checkId: string) => {
        if (!payload) return;
        setSaving(true);
        setNotice('');
        try {
            await api.learningSpaceDesign.adoptAcceleration(payload.session.id, checkId);
            await loadSession(payload.session.id);
            await loadQuestions();
        } catch (error: any) {
            setNotice(error?.response?.data?.detail || '采用加速建议失败');
        } finally {
            setSaving(false);
        }
    };

    const handleGenerateSummary = async () => {
        if (!payload) return;
        setSaving(true);
        setNotice('');
        try {
            await api.learningSpaceDesign.generateSummary(payload.session.id, selectedProvider);
            setReport(await api.learningSpaceDesign.report(payload.session.id));
            setViewMode('report');
            await loadSession(payload.session.id);
        } catch (error: any) {
            setNotice(error?.response?.data?.detail || '生成摘要失败');
        } finally {
            setSaving(false);
        }
    };

    const currentCompletion = payload?.step_completion?.find((item) => item.step_key === currentStep);
    const currentAsyncTask = payload
        ? Object.values(asyncTasks)
            .filter((task) =>
                task.type === 'learning_space_ai'
                && task.relatedId === payload.session.id
                && (task.status === 'running' || task.status === 'failed')
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
        : null;
    const textCount = compactLength(textDraft);
    const minWords = currentCompletion?.min_words || (currentStep ? minWordsForStep(payload, currentStep) : 0);
    const roundLimit = payload?.question.ai_round_limit || 0;
    const userRounds = currentMessages.filter((message) => message.role === 'user').length;
    const roundRemaining = Math.max(roundLimit - userRounds, 0);

    return (
        <div className="h-full flex gap-4">
            <div className="w-[320px] shrink-0 bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                    <h2 className="text-sm font-semibold text-gray-900">学习空间设计</h2>
                    <p className="text-xs text-gray-400 mt-1">按项目阶段完成结构化学习单</p>
                </div>
                <div className="overflow-y-auto h-[calc(100%-65px)] p-3 space-y-4">
                    {groupedItems.map((group) => (
                        <div key={group.stageName}>
                            <div className="text-xs font-semibold text-gray-400 mb-2">{group.stageName}</div>
                            <div className="space-y-2">
                                {group.items.length === 0 && (
                                    <div className="text-xs text-gray-300 px-2 py-2">暂无子问题</div>
                                )}
                                {group.items.map((item) => {
                                    const isSelected = item.session?.id === selectedSessionId;
                                    return (
                                        <div
                                            key={item.question.id}
                                            className={`rounded-xl border p-3 ${isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}
                                        >
                                            <div className="text-sm font-medium text-gray-900">{item.question.title}</div>
                                            {item.question.description && (
                                                <div className="text-xs text-gray-500 mt-1 line-clamp-2">{item.question.description}</div>
                                            )}
                                            {item.session ? (
                                                <button
                                                    onClick={() => {
                                                        if (item.session?.status === 'completed') {
                                                            handleOpenReport(item.session.id);
                                                        } else {
                                                            setSelectedSessionId(item.session!.id);
                                                            setViewMode('workspace');
                                                        }
                                                    }}
                                                    className="mt-3 w-full py-2 text-xs rounded-lg bg-gray-900 text-white hover:bg-gray-800"
                                                >
                                                    {item.session.status === 'completed' ? '查看报告' : `继续：${STEP_LABELS[item.session.current_step]}`}
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleStart(item.question.id)}
                                                    className="mt-3 w-full py-2 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                                                >
                                                    开始学习单
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-1 min-w-0 h-full min-h-0">
                {!payload ? (
                    <div className="h-full bg-white border border-gray-200 rounded-xl flex items-center justify-center text-gray-400 text-sm">
                        选择一个“学习空间设计”子问题开始
                    </div>
                ) : loading ? (
                    <div className="h-full bg-white border border-gray-200 rounded-xl flex items-center justify-center text-gray-400 text-sm">
                        正在加载学习单...
                    </div>
                ) : viewMode === 'report' && report ? (
                    <div className="h-full min-h-0 overflow-y-auto pr-1 pb-6">
                        <LearningSpaceDesignReport report={report} viewer="student" />
                    </div>
                ) : (
                    <div className="h-full bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-100">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-900">{payload.question.title}</h2>
                                    <p className="text-sm text-gray-500 mt-1">{payload.question.stage_name}</p>
                                </div>
                                {payload.session.status === 'completed' && (
                                    <button
                                        onClick={() => handleOpenReport(payload.session.id)}
                                        className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                                    >
                                        查看报告
                                    </button>
                                )}
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                {payload.question.enabled_steps.map((step, index) => (
                                    <div
                                        key={step}
                                        className={`px-3 py-1.5 rounded-full text-xs ${
                                            payload.session.current_step === step
                                                ? 'bg-blue-600 text-white'
                                                : payload.question.enabled_steps.indexOf(step) < payload.session.current_step_index
                                                    ? 'bg-green-100 text-green-700'
                                                    : 'bg-gray-100 text-gray-500'
                                        }`}
                                    >
                                        {index + 1}. {STEP_LABELS[step]}
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 h-2 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                    className="h-full bg-blue-600 transition-all"
                                    style={{ width: `${Math.min(100, Math.max(0, ((payload.session.current_step_index + (payload.session.status === 'completed' ? 1 : 0)) / payload.question.enabled_steps.length) * 100))}%` }}
                                />
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            <div className="bg-gray-50 rounded-xl p-4">
                                <div className="text-sm font-semibold text-gray-900 mb-1">当前步骤：{currentStep ? STEP_LABELS[currentStep] : '-'}</div>
                                <div className="text-xs text-gray-500 leading-6">
                                    {currentStep ? STEP_GUIDES[currentStep].goal : '请按启用步骤顺序完成'}
                                </div>
                                {currentStep && (
                                    <div className="mt-2 text-xs text-blue-600 bg-white border border-blue-100 rounded-lg px-3 py-2">
                                        示例：{STEP_GUIDES[currentStep].example}
                                    </div>
                                )}
                            </div>
                            {notice && (
                                <div className={`rounded-lg px-3 py-2 text-sm ${notice.includes('失败') || notice.includes('请') ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                                    {notice}
                                </div>
                            )}

                            {currentStep && TEXT_STEPS.includes(currentStep) ? (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                                        <span>字数进度：{textCount}/{minWords}</span>
                                        <span className={textCount >= minWords ? 'text-emerald-600' : 'text-amber-600'}>
                                            {textCount >= minWords ? '已达到提交要求' : `还差 ${Math.max(minWords - textCount, 0)} 字`}
                                        </span>
                                        <span>草稿会自动保存在本机浏览器</span>
                                    </div>
                                    <textarea
                                        value={textDraft}
                                        onChange={(event) => setTextDraft(event.target.value)}
                                        rows={10}
                                        className="w-full border border-gray-200 rounded-xl p-4 text-sm leading-7 outline-none focus:ring-2 focus:ring-blue-300"
                                        placeholder="在这里填写你的学习记录..."
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={handleSaveText}
                                            disabled={saving || !textDraft.trim()}
                                            className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
                                        >
                                            保存内容
                                        </button>
                                        {payload.question.allow_ai_acceleration && (
                                            <button
                                                onClick={handleCheckAcceleration}
                                                disabled={saving || !textDraft.trim()}
                                                className="px-4 py-2 text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                                            >
                                                AI 判断是否可加速
                                            </button>
                                        )}
                                        <button
                                            onClick={handleSubmitStep}
                                            disabled={saving || textCount < minWords}
                                            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                        >
                                            提交当前步骤
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                                        <span>AI 对话轮数：{userRounds}/{roundLimit}</span>
                                        <span className={roundRemaining > 0 ? 'text-blue-600' : 'text-amber-600'}>
                                            {roundRemaining > 0 ? `还可发送 ${roundRemaining} 轮` : '已达到轮数上限'}
                                        </span>
                                    </div>
                                    {currentAsyncTask && (
                                        <div className={`rounded-lg px-3 py-2 text-sm ${
                                            currentAsyncTask.status === 'failed'
                                                ? 'bg-red-50 text-red-700 border border-red-100'
                                                : 'bg-blue-50 text-blue-700 border border-blue-100'
                                        }`}>
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span>
                                                    {currentAsyncTask.status === 'failed'
                                                        ? currentAsyncTask.errorMessage || 'AI 回应失败，请稍后重试'
                                                        : currentAsyncTask.progressText || 'AI 正在回应本步骤'}
                                                </span>
                                                {currentAsyncTask.status === 'failed' && currentAsyncTask.retryable && (
                                                    <button
                                                        onClick={() => {
                                                            const retryPayload = currentAsyncTask.retryPayload as { content?: string; provider?: string } | undefined;
                                                            handleSendAi(retryPayload?.content || chatDraft, retryPayload?.provider);
                                                        }}
                                                        className="px-2 py-1 text-xs text-red-700 bg-white border border-red-200 rounded-md hover:bg-red-100"
                                                    >
                                                        重试
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    <div className="space-y-3">
                                        {currentMessages.length === 0 && (
                                            <div className="text-sm text-gray-400">还没有开始本步骤的 AI 对话</div>
                                        )}
                                        {currentMessages.map((message: LearningSpaceMessage) => (
                                            <div
                                                key={message.id}
                                                className={`rounded-xl p-4 text-sm leading-7 ${
                                                    message.role === 'assistant'
                                                        ? 'bg-violet-50 border border-violet-100'
                                                        : 'bg-gray-50 border border-gray-200'
                                                }`}
                                            >
                                                <div className="text-[11px] text-gray-500 mb-1">
                                                    {message.role === 'assistant' ? 'AI' : '学生'} · 第 {message.round_index} 轮
                                                </div>
                                                {message.role === 'assistant' ? (
                                                    <MarkdownContent content={message.content} />
                                                ) : (
                                                    <div className="whitespace-pre-wrap">{message.content}</div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        <textarea
                                            value={chatDraft}
                                            onChange={(event) => setChatDraft(event.target.value)}
                                            rows={3}
                                            className="flex-1 border border-gray-200 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-300"
                                            placeholder="输入你想向 AI 提出的问题、追问或反驳..."
                                        />
                                        <div className="flex flex-col gap-2">
                                            <button
                                                onClick={() => handleSendAi()}
                                                disabled={saving || !chatDraft.trim() || roundRemaining <= 0}
                                                className="px-4 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
                                            >
                                                发送
                                            </button>
                                            <button
                                                onClick={handleSubmitStep}
                                                disabled={saving || userRounds <= 0}
                                                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                提交步骤
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {currentChecks.length > 0 && (
                                <div className="space-y-2">
                                    <div className="text-sm font-semibold text-gray-900">加速建议</div>
                                    {currentChecks.map((check: LearningSpaceAccelerationCheck) => (
                                        <div key={check.id} className="rounded-xl border border-gray-200 p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className={`text-xs px-2 py-1 rounded-full ${check.allowed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                                    {check.allowed ? '允许加速' : '暂不建议加速'}
                                                </div>
                                                {check.allowed && !check.adopted && check.suggested_next_step && (
                                                    <button
                                                        onClick={() => handleAdoptAcceleration(check.id)}
                                                        disabled={saving}
                                                        className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                                                    >
                                                        采用建议，跳转到 {STEP_LABELS[check.suggested_next_step]}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-700 mt-2">{check.reason}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {payload.revisions.filter((item) => item.entry_id === currentEntry?.id).length > 0 && (
                                <div>
                                    <div className="text-sm font-semibold text-gray-900 mb-2">修改历史</div>
                                    <div className="space-y-2">
                                        {payload.revisions
                                            .filter((item) => item.entry_id === currentEntry?.id)
                                            .map((revision) => (
                                                <div key={revision.id} className="bg-gray-50 rounded-xl p-4 text-sm">
                                                    <div className="text-xs text-gray-400 mb-2">{new Date(revision.edited_at).toLocaleString('zh-CN')}</div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                        <div>
                                                            <div className="text-xs font-medium text-gray-500 mb-1">旧版本</div>
                                                            <div className="whitespace-pre-wrap text-gray-700">{revision.old_content}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-medium text-gray-500 mb-1">新版本</div>
                                                            <div className="whitespace-pre-wrap text-gray-700">{revision.new_content}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}

                            {payload.session.status === 'completed' && (
                                <div className="pt-3 border-t border-dashed border-gray-200">
                                    <button
                                        onClick={handleGenerateSummary}
                                        disabled={saving}
                                        className="px-4 py-2 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                                    >
                                        生成报告摘要
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

function currentTextContent(payload: LearningSpaceSessionPayload): string {
    const step = payload.session.current_step;
    const entry = payload.entries.find((item: LearningSpaceEntry) => item.step_key === step);
    return entry?.content || '';
}

function compactLength(text: string): number {
    return (text || '').replace(/\s+/g, '').length;
}

function minWordsForStep(payload: LearningSpaceSessionPayload | null | undefined, step: LearningSpaceStepKey): number {
    if (!payload) return 0;
    if (step === 'self_think') return payload.question.min_words_step1;
    if (step === 'verify') return payload.question.min_words_step3;
    if (step === 'integrate') return payload.question.min_words_step5;
    return 0;
}

function draftKey(sessionId: string, step: LearningSpaceStepKey): string {
    return `learning-space-draft:${sessionId}:${step}`;
}
