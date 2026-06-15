/**
 * 支架管理 Tab — 提取自 TeacherDashboard
 * 新增：智能推送开关 Toggle
 */
import React, { useState, useEffect } from 'react';
import api from '../../api';
import { api as apiTyped } from '../../api';
import clsx from 'clsx';
import { RefreshCw, Zap, Heart, Target, Lightbulb, PenTool, CheckSquare } from 'lucide-react';
import {
    getStoredStageControlEnabled,
    nextStoredStageControlEnabled,
} from './stageControlSetting';

interface ScaffoldManagerProps {
    scaffolds: Array<Record<string, unknown>>;
    loadScaffolds: () => void;
}

const EDIPT_STAGES = [
    { id: 'Empathy', label: '共情', icon: Heart, desc: '挖掘痛点' },
    { id: 'Define', label: '定义', icon: Target, desc: '明确问题' },
    { id: 'Ideate', label: '构思', icon: Lightbulb, desc: '头脑风暴' },
    { id: 'Prototype', label: '原型', icon: PenTool, desc: '制作方案' },
    { id: 'Test', label: '测试', icon: CheckSquare, desc: '验证反馈' }
];

export const ScaffoldManager: React.FC<ScaffoldManagerProps> = ({
    scaffolds, loadScaffolds,
}) => {
    const [editingScaffold, setEditingScaffold] = useState<Record<string, any> | null>(null);
    const [suggestEnabled, setSuggestEnabled] = useState(true);
    const [suggestLoading, setSuggestLoading] = useState(false);
    const [globalStage, setGlobalStage] = useState('Empathy');
    const [pushingStage, setPushingStage] = useState(false);
    const [stageControlEnabled, setStageControlEnabled] = useState(
        () => getStoredStageControlEnabled(),
    );

    // 加载开关状态
    useEffect(() => {
        apiTyped.teacher.getScaffoldSuggestEnabled()
            .then((data) => setSuggestEnabled(data.enabled))
            .catch(() => {});
    }, []);

    const toggleSuggest = async () => {
        setSuggestLoading(true);
        try {
            const res = await apiTyped.teacher.setScaffoldSuggestEnabled(!suggestEnabled);
            setSuggestEnabled(res.enabled);
        } catch (_e) {
            alert('切换失败');
        } finally {
            setSuggestLoading(false);
        }
    };

    const toggleStageControl = () => {
        setStageControlEnabled((current) =>
            nextStoredStageControlEnabled(window.localStorage, !current)
        );
    };

    const toggleScaffold = async (id: string, currentActive: boolean) => {
        try {
            await api.patch(`/scaffolds/${id}`, { is_active: !currentActive });
            loadScaffolds();
        } catch (_e) { alert('切换状态失败'); }
    };

    const saveScaffold = async () => {
        if (!editingScaffold) return;
        try {
            await api.patch(`/scaffolds/${editingScaffold.scaffold_id}`, {
                prompt_template: editingScaffold.prompt_template,
                display_name: editingScaffold.display_name,
            });
            setEditingScaffold(null);
            loadScaffolds();
        } catch (_e) { alert('保存失败'); }
    };

    const handlePushStage = async (stageId: string) => {
        if (!window.confirm(`即将把全班所有小组强行推进至【${EDIPT_STAGES.find(s=>s.id===stageId)?.label}】阶段，确定吗？`)) return;
        setPushingStage(true);
        try {
            await apiTyped.groups.pushStageToAll(stageId);
            setGlobalStage(stageId);
        } catch (e) {
            alert('推送阶段失败');
        } finally {
            setPushingStage(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-xl font-bold text-gray-900">支架与过程管理</h1>
                <button onClick={loadScaffolds} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                    <RefreshCw className="w-3.5 h-3.5" /> 刷新
                </button>
            </div>

            {/* ── 全局阶段控制 ── */}
            <div className="bg-white rounded-xl border border-indigo-100 p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-semibold text-gray-900">全局课程阶段控制 (EDIPT)</h2>
                        <p className="text-xs text-gray-500 mt-1">
                            {stageControlEnabled
                                ? '切换阶段将强制全班小组跳转，并赋予 AI 该阶段的专属引导指令。'
                                : '当前已关闭阶段强制推进，适合单独测试小组协作角色功能。'}
                        </p>
                    </div>
                    <button
                        onClick={toggleStageControl}
                        className={clsx(
                            'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
                            stageControlEnabled ? 'bg-indigo-600' : 'bg-gray-300'
                        )}
                        title={stageControlEnabled ? '关闭 EDIPT 阶段控制' : '开启 EDIPT 阶段控制'}
                    >
                        <span className={clsx(
                            'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                            stageControlEnabled ? 'translate-x-6' : 'translate-x-1'
                        )} />
                    </button>
                </div>

                <div className={clsx(
                    'flex flex-wrap items-center justify-between gap-2',
                    !stageControlEnabled && 'pointer-events-none opacity-40'
                )}>
                    {EDIPT_STAGES.map((stage, idx) => {
                        const Icon = stage.icon;
                        const isActive = globalStage === stage.id;
                        return (
                            <React.Fragment key={stage.id}>
                                <button
                                    onClick={() => handlePushStage(stage.id)}
                                    disabled={pushingStage || !stageControlEnabled}
                                    className={clsx(
                                        'flex-1 relative group rounded-xl p-3 text-left transition-all duration-200 border-2',
                                        isActive
                                            ? 'bg-indigo-50 border-indigo-500 shadow-sm'
                                            : 'bg-white border-transparent hover:bg-gray-50 hover:border-gray-200'
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={clsx(
                                            'w-8 h-8 rounded-lg flex items-center justify-center transition-colors',
                                            isActive ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500 group-hover:text-indigo-600'
                                        )}>
                                            <Icon className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <div className={clsx("text-sm font-bold", isActive ? 'text-indigo-900' : 'text-gray-700')}>
                                                {stage.label}
                                            </div>
                                            <div className="text-[11px] text-gray-400 mt-0.5">{stage.desc}</div>
                                        </div>
                                    </div>
                                    {isActive && (
                                        <div className="absolute -top-2 -right-2 w-5 h-5 bg-green-500 rounded-full border-2 border-white flex items-center justify-center animate-bounce">
                                            <CheckSquare className="w-3 h-3 text-white" />
                                        </div>
                                    )}
                                </button>
                                {idx < EDIPT_STAGES.length - 1 && (
                                    <div className="hidden lg:block w-4 h-0.5 bg-gray-200"></div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>

            {/* ── 智能推送开关 ── */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={clsx(
                            'w-9 h-9 rounded-xl flex items-center justify-center transition-colors',
                            suggestEnabled ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-400'
                        )}>
                            <Zap className="w-4.5 h-4.5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">智能支架推送</h3>
                            <p className="text-xs text-gray-400 mt-0.5">
                                AI 检测到学生需要帮助时，自动推荐预填好的学习支架
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={toggleSuggest}
                        disabled={suggestLoading}
                        className={clsx(
                            'relative inline-flex items-center w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none',
                            suggestEnabled ? 'bg-green-500' : 'bg-gray-300',
                            suggestLoading && 'opacity-50'
                        )}
                    >
                        <span className={clsx(
                            'inline-block w-4 h-4 bg-white rounded-full shadow transform transition-transform duration-200',
                            suggestEnabled ? 'translate-x-[1.375rem]' : 'translate-x-1'
                        )} />
                    </button>
                </div>
            </div>

            {/* ── 支架列表 ── */}
            <div className="space-y-3">
                {scaffolds.map((s) => (
                    <div key={s.scaffold_id as string} className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-medium text-gray-900">{s.display_name as string}</h3>
                            <div className="flex items-center gap-3">
                                <button onClick={() => setEditingScaffold(s)} className="text-xs text-indigo-600 hover:text-indigo-800">编辑</button>
                                <button onClick={() => toggleScaffold(s.scaffold_id as string, s.is_active as boolean)}
                                    className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium cursor-pointer transition-colors',
                                        s.is_active ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-gray-100 text-gray-400 hover:bg-gray-200')}>
                                    {s.is_active ? '启用中 (点击停用)' : '已停用 (点击启用)'}
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-gray-400 font-mono bg-gray-50 p-2 rounded">{s.prompt_template as string}</p>
                    </div>
                ))}
                {scaffolds.length === 0 && <div className="text-center py-8 text-gray-300 text-sm">暂无支架</div>}
            </div>

            {/* ── 编辑弹窗 ── */}
            {editingScaffold && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-gray-900">编辑支架</h3>
                            <button onClick={() => setEditingScaffold(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">支架名称</label>
                                <input type="text" value={editingScaffold.display_name as string}
                                    onChange={(e) => setEditingScaffold({ ...editingScaffold, display_name: e.target.value })}
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">提示词模板</label>
                                <textarea value={editingScaffold.prompt_template as string}
                                    onChange={(e) => setEditingScaffold({ ...editingScaffold, prompt_template: e.target.value })}
                                    rows={5} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button onClick={() => setEditingScaffold(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
                                <button onClick={saveScaffold} className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors">保存</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
