/**
 * 学习分析 Tab — 提取自 TeacherDashboard
 * 包含：KPI 概览、参与度趋势、AI 介入率、支架使用饼图、讨论深度、
 *       支架依赖度、活跃会话、参与度热力图、词云、Bloom 认知层次分析
 */
import React, { useState } from 'react';
import { api as apiTyped } from '../../api';
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import { Download, RefreshCw, TrendingUp } from 'lucide-react';

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

interface AnalyticsPanelProps {
    analyticsData: Record<string, any> | null;
    loadAnalytics: () => void;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({
    analyticsData, loadAnalytics,
}) => {
    const [bloomData, setBloomData] = useState<Record<string, any> | null>(null);
    const [bloomLoading, setBloomLoading] = useState(false);

    const handleBloomAnalysis = async () => {
        setBloomLoading(true);
        try {
            const data = await apiTyped.teacher.bloomAnalysis();
            setBloomData(data);
        } catch (_e) {
            alert('Bloom 分析失败，请稍后重试');
        } finally { setBloomLoading(false); }
    };

    const handleExportCsv = async () => {
        try {
            const blob = await apiTyped.teacher.exportCsv();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `messages_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (_e) { alert('导出失败'); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl font-bold text-gray-900">学习分析</h1>
                <div className="flex gap-2">
                    <button onClick={handleExportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
                        <Download className="w-3.5 h-3.5" /> 导出 CSV
                    </button>
                    <button onClick={loadAnalytics} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                        <RefreshCw className="w-3.5 h-3.5" /> 刷新
                    </button>
                </div>
            </div>
            {!analyticsData ? (
                <div className="text-center py-12 text-gray-400">加载中...</div>
            ) : (
                <div className="space-y-6">
                    <KpiCards data={analyticsData} />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <ParticipationTrend data={analyticsData.participation_trend} />
                        <AiInterventionRate data={analyticsData.ai_intervention_rate} />
                        <ScaffoldUsagePie data={analyticsData.scaffold_usage} />
                        <DiscussionDepth data={analyticsData.discussion_depth} />
                        <ScaffoldDependency data={analyticsData.scaffold_dependency} />
                        <ActiveSessions data={analyticsData.active_sessions} />
                        <ParticipationHeatmap data={analyticsData.participation_heatmap} />
                        <WordCloud data={analyticsData.word_cloud} />
                    </div>
                    <BloomSection data={bloomData} loading={bloomLoading} onAnalyze={handleBloomAnalysis} />
                    {!analyticsData.participation_trend?.length && !analyticsData.ai_intervention_rate?.length &&
                        !analyticsData.scaffold_usage?.length && !analyticsData.participation_heatmap?.length &&
                        !analyticsData.word_cloud?.length && !analyticsData.discussion_depth?.length && (
                            <div className="text-center py-12 text-gray-400 text-sm">暂无足够数据生成分析图表</div>
                        )}
                </div>
            )}
        </div>
    );
};

// ── KPI 概览卡组 ──
function KpiCards({ data }: { data: Record<string, any> }) {
    const totalMsgs = data.participation_trend
        ?.reduce((s: number, d: { count: number }) => s + d.count, 0) || 0;
    const activeStudents = data.ai_intervention_rate?.length || 0;
    const avgAiRate = activeStudents > 0
        ? (data.ai_intervention_rate!.reduce((s: number, d: { ai_ratio: number }) => s + d.ai_ratio, 0) / activeStudents * 100).toFixed(1)
        : '0';
    const days = data.participation_trend?.length || 1;
    const dailyAvg = (totalMsgs / days).toFixed(1);
    const cards = [
        { label: '总发言数', value: totalMsgs, from: 'indigo' },
        { label: '活跃学生', value: activeStudents, from: 'emerald' },
        { label: 'AI 介入率', value: `${avgAiRate}%`, from: 'violet' },
        { label: '日均发言', value: dailyAvg, from: 'amber' },
    ];
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {cards.map(c => (
                <div key={c.label} className={`bg-gradient-to-br from-${c.from}-50 to-${c.from}-100 rounded-xl p-4 border border-${c.from}-200/50`}>
                    <p className={`text-xs text-${c.from}-500 font-medium`}>{c.label}</p>
                    <p className={`text-2xl font-bold text-${c.from}-700 mt-1`}>{c.value}</p>
                </div>
            ))}
        </div>
    );
}

// ── 参与度趋势 ──
function ParticipationTrend({ data }: { data?: any[] }) {
    if (!data?.length) return null;
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">参与度趋势</h3>
            <ResponsiveContainer width="100%" height={250}>
                <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="消息数" />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

// ── AI 介入率 ──
function AiInterventionRate({ data }: { data?: any[] }) {
    if (!data?.length) return null;
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">AI 介入率（每位学生）</h3>
            <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="student_name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="ai_ratio" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="AI 消息占比" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// ── 支架使用饼图 ──
function ScaffoldUsagePie({ data }: { data?: any[] }) {
    if (!data?.length) return null;
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">支架使用分布</h3>
            <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                    <Pie data={data} cx="50%" cy="50%" outerRadius={80} dataKey="count" nameKey="scaffold_name"
                        label={(props: any) => `${props.scaffold_name || ''} ${((props.percent || 0) * 100).toFixed(0)}%`}>
                        {data.map((_: unknown, idx: number) => (
                            <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                        ))}
                    </Pie>
                    <Tooltip /><Legend />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}

// ── 讨论深度 ──
function DiscussionDepth({ data }: { data?: any[] }) {
    if (!data?.length) return null;
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">💬 讨论深度（平均消息长度）</h3>
            <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number | string | undefined) => [`${v} 字`, '平均长度']} />
                    <Bar dataKey="avg_length" fill="#10b981" radius={[4, 4, 0, 0]} name="平均字数" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// ── 支架依赖度 ──
function ScaffoldDependency({ data }: { data?: Record<string, any> }) {
    if (!data?.total) return null;
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">🔧 支架依赖度</h3>
            <div className="flex items-center gap-4">
                <div className="flex-1">
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all"
                            style={{ width: `${data.rate}%` }} />
                    </div>
                </div>
                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">{data.rate}%</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">{data.scaffold_used} / {data.total} 条学生消息使用了支架辅助</p>
        </div>
    );
}

// ── 活跃会话 ──
function ActiveSessions({ data }: { data?: any[] }) {
    if (!data?.length) return null;
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">活跃会话</h3>
            <div className="space-y-2">
                {data.map((s: Record<string, unknown>, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                        <span className="text-gray-700 text-sm font-medium">{(s.group_name as string) || (s.session_id as string)?.slice(0, 12) + '...'}</span>
                        <span className="text-gray-500">{s.message_count as number} 条消息</span>
                        <span className="text-gray-400 text-xs">{s.last_activity as string}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── 参与度热力图 ──
function ParticipationHeatmap({ data }: { data?: { student_name: string; date: string; count: number }[] }) {
    if (!data?.length) return null;
    const hmStudents = [...new Set(data.map(d => d.student_name))];
    const dates = [...new Set(data.map(d => d.date))].sort();
    const maxCount = Math.max(...data.map(d => d.count), 1);
    const lookup = new Map(data.map(d => [`${d.student_name}-${d.date}`, d.count]));
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">📊 参与度热力图</h3>
            <div className="overflow-x-auto">
                <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `100px repeat(${dates.length}, 28px)` }}>
                    <div className="text-[9px] text-gray-400" />
                    {dates.map(d => <div key={d} className="text-[8px] text-gray-400 text-center rotate-[-45deg] origin-bottom-left h-6">{d.slice(5)}</div>)}
                    {hmStudents.map(s => (
                        <React.Fragment key={`row-${s}`}>
                            <div className="text-[10px] text-gray-600 truncate pr-1 flex items-center">{s}</div>
                            {dates.map(d => {
                                const v = lookup.get(`${s}-${d}`) || 0;
                                const intensity = v / maxCount;
                                return <div key={`${s}-${d}`} className="w-6 h-6 rounded-sm"
                                    style={{ backgroundColor: v === 0 ? '#f3f4f6' : `rgba(99, 102, 241, ${0.15 + intensity * 0.85})` }}
                                    title={`${s} ${d}: ${v} 条`} />;
                            })}
                        </React.Fragment>
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
                <span className="text-[9px] text-gray-400">少</span>
                {[0.1, 0.3, 0.5, 0.7, 1].map(v => (
                    <div key={v} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(99, 102, 241, ${0.15 + v * 0.85})` }} />
                ))}
                <span className="text-[9px] text-gray-400">多</span>
            </div>
        </div>
    );
}

// ── 词云 ──
function WordCloud({ data }: { data?: { word: string; count: number }[] }) {
    if (!data?.length) return null;
    const top50 = data.slice(0, 50);
    const maxC = Math.max(...top50.map(w => w.count), 1);
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];
    const cx = 300, cy = 150;
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">☁️ 高频词云</h3>
            <svg viewBox="0 0 600 300" className="w-full" style={{ maxHeight: 300 }}>
                {top50.map((w, i) => {
                    const ratio = w.count / maxC;
                    const size = 12 + ratio * 22;
                    const angle = i * 137.508 * (Math.PI / 180);
                    const r = 20 + i * 3.5;
                    const x = cx + r * Math.cos(angle);
                    const y = cy + r * Math.sin(angle) * 0.6;
                    const rotation = i % 5 === 0 ? -90 : i % 7 === 0 ? 90 : 0;
                    return (
                        <text key={w.word} x={x} y={y} textAnchor="middle" dominantBaseline="central"
                            fontSize={size} fontWeight={ratio > 0.5 ? 700 : 400}
                            fill={colors[i % colors.length]} opacity={0.6 + ratio * 0.4}
                            transform={rotation ? `rotate(${rotation}, ${x}, ${y})` : undefined}
                            className="transition-all hover:opacity-100 cursor-default">
                            <title>{`${w.word}: ${w.count} 次`}</title>{w.word}
                        </text>
                    );
                })}
            </svg>
        </div>
    );
}

// ── Bloom 认知层次分析 ──
function BloomSection({ data, loading, onAnalyze }: { data: Record<string, any> | null; loading: boolean; onAnalyze: () => void }) {
    const bloomColors = ['#94a3b8', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa'];
    const levelColorMap: Record<string, string> = {
        '创造': 'bg-violet-100 text-violet-700', '评价': 'bg-red-100 text-red-700',
        '分析': 'bg-amber-100 text-amber-700', '应用': 'bg-emerald-100 text-emerald-700',
        '理解': 'bg-blue-100 text-blue-700',
    };
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">🧠 Bloom 认知层次分析</h3>
                <button onClick={onAnalyze} disabled={loading}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors">
                    {loading ? (<><RefreshCw className="w-3.5 h-3.5 animate-spin" /> 分析中...</>) : (<><TrendingUp className="w-3.5 h-3.5" /> 开始分析</>)}
                </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">基于 LLM 对最近学生发言进行 Bloom 认知层次分类（记忆→创造）</p>
            {data && !data.error ? (
                <div className="space-y-4">
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={Object.entries(data.levels || {}).map(([name, value]) => ({ name, value }))} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis type="number" tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={50} />
                            <Tooltip />
                            <Bar dataKey="value" radius={[0, 4, 4, 0]} name="发言数">
                                {Object.entries(data.levels || {}).map((_: unknown, idx: number) => (
                                    <Cell key={idx} fill={bloomColors[idx % bloomColors.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <p className="text-xs text-gray-400 text-right">共分析 {data.total} 条发言</p>
                    {data.details?.length > 0 && (
                        <div>
                            <h4 className="text-xs font-medium text-gray-600 mb-2">部分发言分类详情</h4>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {data.details.slice(0, 15).map((d: { content: string; level: string }, i: number) => (
                                    <div key={i} className="flex items-start gap-2 text-xs">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${levelColorMap[d.level] || 'bg-gray-100 text-gray-600'}`}>{d.level}</span>
                                        <span className="text-gray-500 line-clamp-1">{d.content}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : data?.error ? (
                <div className="text-center py-4 text-red-400 text-sm">分析失败: {data.error}</div>
            ) : !loading ? (
                <div className="text-center py-6 text-gray-300 text-sm">点击「开始分析」按钮触发 AI 分析</div>
            ) : (
                <div className="space-y-3 py-4">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" style={{ width: `${60 + i * 10}%` }} />
                    ))}
                </div>
            )}
        </div>
    );
}
