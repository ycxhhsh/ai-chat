import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { LearningSpaceDesignReport } from '../LearningSpaceDesign/LearningSpaceDesignReport';
import type { LearningSpaceQuestion } from '../../types';

const STAGE_OPTIONS = [
    '入项与启动',
    '规划与构建',
    '探究与创作',
    '展示与评价',
];

const STEP_OPTIONS = [
    { key: 'self_think', label: '自主思考', disabled: true },
    { key: 'ai_question', label: '对话提问' },
    { key: 'verify', label: '获取验证' },
    { key: 'challenge', label: '追问/反驳' },
    { key: 'integrate', label: '深化整合', disabled: true },
];

const DEFAULT_FORM = {
    stage_name: STAGE_OPTIONS[0],
    title: '',
    description: '',
    enabled_steps: ['self_think', 'ai_question', 'verify', 'challenge', 'integrate'],
    ai_round_limit: 3,
    min_words_step1: 30,
    min_words_step3: 50,
    min_words_step5: 80,
    allow_ai_acceleration: false,
};

export const LearningSpaceDesignManager: React.FC = () => {
    const [questions, setQuestions] = useState<LearningSpaceQuestion[]>([]);
    const [progress, setProgress] = useState<Array<Record<string, any>>>([]);
    const [form, setForm] = useState(DEFAULT_FORM);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [report, setReport] = useState<any | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [stageFilter, setStageFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [studentFilter, setStudentFilter] = useState('');

    const loadAll = async () => {
        const [questionData, progressData] = await Promise.all([
            api.learningSpaceDesign.teacherQuestions(),
            api.learningSpaceDesign.progress(),
        ]);
        setQuestions(questionData);
        setProgress(progressData);
    };

    useEffect(() => {
        loadAll().catch((error) => console.error('Load learning space design data failed:', error));
    }, []);

    const resetForm = () => {
        setForm(DEFAULT_FORM);
        setEditingId(null);
    };

    const handleSubmit = async () => {
        if (!form.title.trim()) {
            alert('请先填写子问题标题');
            return;
        }

        setSubmitting(true);
        try {
            if (editingId) {
                await api.learningSpaceDesign.updateQuestion(editingId, form);
            } else {
                await api.learningSpaceDesign.createQuestion(form);
            }
            resetForm();
            await loadAll();
        } catch (error: any) {
            alert(error?.response?.data?.detail || '创建子问题失败，请稍后重试');
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = (question: LearningSpaceQuestion) => {
        setEditingId(question.id);
        setForm({
            stage_name: question.stage_name,
            title: question.title,
            description: question.description || '',
            enabled_steps: question.enabled_steps,
            ai_round_limit: question.ai_round_limit,
            min_words_step1: question.min_words_step1,
            min_words_step3: question.min_words_step3,
            min_words_step5: question.min_words_step5,
            allow_ai_acceleration: question.allow_ai_acceleration,
        });
    };

    const handleDelete = async (questionId: string) => {
        if (!window.confirm('确定删除这个子问题吗？')) return;
        try {
            await api.learningSpaceDesign.deleteQuestion(questionId);
            await loadAll();
        } catch (error: any) {
            alert(error?.response?.data?.detail || '删除子问题失败，请稍后重试');
        }
    };

    const toggleStep = (stepKey: string) => {
        if (stepKey === 'self_think' || stepKey === 'integrate') return;
        setForm((prev) => ({
            ...prev,
            enabled_steps: prev.enabled_steps.includes(stepKey)
                ? prev.enabled_steps.filter((item) => item !== stepKey)
                : [...prev.enabled_steps, stepKey],
        }));
    };

    const filteredProgress = useMemo(() => {
        return progress.filter((item) => {
            const matchesStage = stageFilter === 'all' || item.stage_name === stageFilter;
            const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
            const studentText = `${item.student_name || ''} ${item.student_id || ''}`.toLowerCase();
            const matchesStudent = !studentFilter.trim() || studentText.includes(studentFilter.trim().toLowerCase());
            return matchesStage && matchesStatus && matchesStudent;
        });
    }, [progress, stageFilter, statusFilter, studentFilter]);

    const stats = useMemo(() => {
        const completed = progress.filter((item) => item.status === 'completed').length;
        const accelerated = progress.filter((item) => item.used_acceleration).length;
        const stepCounts = progress.reduce<Record<string, number>>((acc, item) => {
            const key = item.current_step_label || item.current_step || '未知';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        return {
            total: progress.length,
            completed,
            completionRate: progress.length ? Math.round((completed / progress.length) * 100) : 0,
            accelerated,
            stepCounts,
        };
    }, [progress]);

    const exportProgressCsv = () => {
        const rows = [
            ['学生', '阶段', '子问题', '状态', '当前步骤', '进度', 'AI轮数', '文本字数', '使用加速', '更新时间'],
            ...filteredProgress.map((item) => [
                item.student_name || '',
                item.stage_name || '',
                item.question_title || '',
                item.status || '',
                item.current_step_label || '',
                `${item.progress_percent ?? 0}%`,
                String(item.ai_rounds_used ?? 0),
                String(item.word_count ?? 0),
                item.used_acceleration ? '是' : '否',
                item.updated_at || '',
            ]),
        ];
        const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'learning-space-progress.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">学习空间设计</h2>
                        <p className="text-sm text-gray-500 mt-1">创建四阶段下的学习单子问题与流程配置</p>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">所属阶段</label>
                        <select
                            value={form.stage_name}
                            onChange={(e) => setForm({ ...form, stage_name: e.target.value })}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        >
                            {STAGE_OPTIONS.map((stage) => (
                                <option key={stage} value={stage}>{stage}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">标题</label>
                        <input
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">描述</label>
                        <textarea
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            rows={4}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-2">启用步骤</label>
                        <div className="space-y-2">
                            {STEP_OPTIONS.map((step) => (
                                <label key={step.key} className="flex items-center gap-2 text-sm text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={form.enabled_steps.includes(step.key)}
                                        disabled={step.disabled}
                                        onChange={() => toggleStep(step.key)}
                                    />
                                    {step.label}
                                    {step.disabled && <span className="text-xs text-gray-400">必选</span>}
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-sm text-gray-700">
                            AI 轮数
                            <input
                                type="number"
                                min={1}
                                max={10}
                                value={form.ai_round_limit}
                                onChange={(e) => setForm({ ...form, ai_round_limit: Number(e.target.value) })}
                                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </label>

                        <label className="text-sm text-gray-700">
                            第 1 步字数
                            <input
                                type="number"
                                min={1}
                                value={form.min_words_step1}
                                onChange={(e) => setForm({ ...form, min_words_step1: Number(e.target.value) })}
                                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </label>

                        <label className="text-sm text-gray-700">
                            第 3 步字数
                            <input
                                type="number"
                                min={1}
                                value={form.min_words_step3}
                                onChange={(e) => setForm({ ...form, min_words_step3: Number(e.target.value) })}
                                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </label>

                        <label className="text-sm text-gray-700">
                            第 5 步字数
                            <input
                                type="number"
                                min={1}
                                value={form.min_words_step5}
                                onChange={(e) => setForm({ ...form, min_words_step5: Number(e.target.value) })}
                                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </label>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={form.allow_ai_acceleration}
                            onChange={(e) => setForm({ ...form, allow_ai_acceleration: e.target.checked })}
                        />
                        允许 AI 加速判断
                    </label>

                    <div className="flex gap-2">
                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-60"
                        >
                            {editingId ? '保存修改' : '创建子问题'}
                        </button>
                        {editingId && (
                            <button onClick={resetForm} className="px-4 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">
                                取消编辑
                            </button>
                        )}
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="bg-white rounded-xl border border-gray-200 p-4">
                            <div className="text-xs text-gray-500">开始人数</div>
                            <div className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 p-4">
                            <div className="text-xs text-gray-500">完成率</div>
                            <div className="text-2xl font-bold text-gray-900 mt-1">{stats.completionRate}%</div>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 p-4">
                            <div className="text-xs text-gray-500">使用加速</div>
                            <div className="text-2xl font-bold text-gray-900 mt-1">{stats.accelerated}</div>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 p-4">
                            <div className="text-xs text-gray-500">当前步骤分布</div>
                            <div className="text-xs text-gray-700 mt-2 line-clamp-3">
                                {Object.entries(stats.stepCounts).map(([step, count]) => `${step} ${count}`).join(' / ') || '暂无'}
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-gray-900">子问题列表</h3>
                            <button onClick={loadAll} className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">刷新</button>
                        </div>
                        <div className="space-y-3">
                            {questions.map((question) => (
                                <div key={question.id} className="border border-gray-200 rounded-xl p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="text-xs text-blue-600 font-medium mb-1">{question.stage_name}</div>
                                            <div className="text-sm font-semibold text-gray-900">{question.title}</div>
                                            {question.description && <div className="text-sm text-gray-500 mt-1">{question.description}</div>}
                                            <div className="text-xs text-gray-400 mt-2">
                                                步骤：{question.enabled_steps.join(' / ')} · AI 轮数：{question.ai_round_limit} · 加速：{question.allow_ai_acceleration ? '开' : '关'}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            <button onClick={() => handleEdit(question)} className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">编辑</button>
                                            <button onClick={() => handleDelete(question.id)} className="px-3 py-2 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50">删除</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {questions.length === 0 && <div className="text-sm text-gray-400">还没有配置任何学习空间设计子问题。</div>}
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                            <h3 className="text-lg font-bold text-gray-900">学生进度</h3>
                            <button onClick={exportProgressCsv} className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800">
                                导出当前筛选
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                            <select
                                value={stageFilter}
                                onChange={(e) => setStageFilter(e.target.value)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            >
                                <option value="all">全部阶段</option>
                                {STAGE_OPTIONS.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                            </select>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            >
                                <option value="all">全部状态</option>
                                <option value="in_progress">进行中</option>
                                <option value="completed">已完成</option>
                            </select>
                            <input
                                value={studentFilter}
                                onChange={(e) => setStudentFilter(e.target.value)}
                                placeholder="按学生姓名或学号筛选"
                                className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </div>
                        <div className="space-y-3">
                            {filteredProgress.map((item) => (
                                <div key={item.session_id} className="border border-gray-200 rounded-xl p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="text-sm font-semibold text-gray-900">{item.student_name}</div>
                                            <div className="text-sm text-gray-500 mt-1">{item.stage_name} · {item.question_title}</div>
                                            <div className="text-xs text-gray-400 mt-2">
                                                当前步骤：{item.current_step_label} · 进度：{item.progress_percent}% · AI轮数：{item.ai_rounds_used || 0} · 文本字数：{item.word_count || 0} · 加速：{item.used_acceleration ? '是' : '否'}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            <button
                                                onClick={async () => setReport(await api.learningSpaceDesign.report(item.session_id))}
                                                className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                                            >
                                                查看报告
                                            </button>
                                            <button
                                                onClick={async () => setReport(await api.learningSpaceDesign.exportReport(item.session_id))}
                                                className="px-3 py-2 text-sm rounded-lg bg-gray-900 text-white hover:bg-gray-800"
                                            >
                                                导出
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {filteredProgress.length === 0 && <div className="text-sm text-gray-400">当前筛选下没有学生进度。</div>}
                        </div>
                    </div>
                </div>
            </div>

            {report && (
                <div className="fixed inset-0 bg-black/40 z-50 overflow-y-auto p-6">
                    <div className="max-w-5xl mx-auto space-y-4">
                        <div className="flex justify-end">
                            <button onClick={() => setReport(null)} className="px-3 py-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-50">
                                关闭
                            </button>
                        </div>
                        <LearningSpaceDesignReport report={report} viewer="teacher" />
                    </div>
                </div>
            )}
        </div>
    );
};

function csvCell(value: unknown): string {
    const text = String(value ?? '').replace(/"/g, '""');
    return `"${text}"`;
}
