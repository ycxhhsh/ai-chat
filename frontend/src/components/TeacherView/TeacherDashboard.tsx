/**
 * 教师仪表盘 — 数据概览 + 学生管理 + 消息日志 + 支架管理
 *   + 学习分析 (P1-5/P2-9) + 知识库 (P1-6) + 作业批阅 (P1-8) + 课程管理 (P2-11)
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import api, { api as apiTyped } from '../../api';
import {
    LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts';
import {
    Users,
    MessageSquare,
    BarChart3,
    FileText,
    LogOut,
    RefreshCw,
    Upload,
    ChevronLeft,
    ChevronRight,
    BookOpen,
    Download,
    TrendingUp,
    ClipboardCheck,
    GraduationCap,
    Trash2,
    Star,
    Copy,
    Paperclip,
} from 'lucide-react';
import clsx from 'clsx';

type TabType =
    | 'overview'
    | 'students'
    | 'messages'
    | 'scaffolds'
    | 'analytics'
    | 'knowledge'
    | 'assignments'
    | 'courses';

type ChatTypeFilter = 'all' | 'group' | 'personal';

const CHART_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// ── 统计卡片 ──
function StatCard({
    icon: Icon,
    label,
    value,
    color,
}: {
    icon: React.ElementType;
    label: string;
    value: number | string;
    color: string;
}) {
    return (
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
            <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: color + '15' }}
            >
                <Icon className="w-6 h-6" style={{ color }} />
            </div>
            <div>
                <p className="text-2xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
        </div>
    );
}

// ── 主组件 ──

export const TeacherDashboard: React.FC = () => {
    const { user, logout } = useAuthStore();
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const [_loading, setLoading] = useState(false);

    // 数据状态
    const [stats, setStats] = useState<Record<string, number>>({});
    const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
    const [messages, setMessages] = useState<Array<Record<string, unknown>>>([]);
    const [scaffolds, setScaffolds] = useState<Array<Record<string, unknown>>>([]);
    const [studentPage, setStudentPage] = useState(1);
    const [msgPage, setMsgPage] = useState(1);
    const [editingScaffold, setEditingScaffold] = useState<Record<string, any> | null>(null);
    const [totalStudents, setTotalStudents] = useState(0);
    const [totalMessages, setTotalMessages] = useState(0);

    // 统一消息筛选
    const [chatTypeFilter, setChatTypeFilter] = useState<ChatTypeFilter>('all');
    const [filterStudentId, setFilterStudentId] = useState('');

    // P1-5 / P2-9: 学习分析
    const [analyticsData, setAnalyticsData] = useState<Record<string, any> | null>(null);
    // P1-6: 知识库
    const [documents, setDocuments] = useState<Array<Record<string, unknown>>>([]);
    // P1-8: 作业
    const [assignments, setAssignments] = useState<Array<Record<string, any>>>([]);
    const [reviewingAssignment, setReviewingAssignment] = useState<Record<string, any> | null>(null);
    const [reviewScore, setReviewScore] = useState('');
    const [reviewComment, setReviewComment] = useState('');
    // P2-11: 课程
    const [courses, setCourses] = useState<Array<Record<string, unknown>>>([]);
    const [newCourseName, setNewCourseName] = useState('');
    const [newCourseDesc, setNewCourseDesc] = useState('');

    // 加载统计
    const loadStats = useCallback(async () => {
        try {
            const res = await api.get('/teacher/stats');
            setStats(res.data);
        } catch (e) {
            console.error('Load stats failed:', e);
        }
    }, []);

    // 加载学生
    const loadStudents = useCallback(async (page = 1) => {
        try {
            const res = await api.get('/teacher/students', { params: { page, page_size: 15 } });
            setStudents(res.data.students || []);
            setTotalStudents(res.data.total || 0);
            setStudentPage(page);
        } catch (e) {
            console.error('Load students failed:', e);
        }
    }, []);

    // 加载统一消息
    const loadMessages = useCallback(async (page = 1) => {
        try {
            const params: Record<string, any> = { page, page_size: 30, type: chatTypeFilter };
            if (filterStudentId) params.student_id = filterStudentId;

            const data = await apiTyped.teacher.unifiedMessages(params);
            setMessages(data.messages || []);
            setTotalMessages(data.total || 0);
            setMsgPage(page);
        } catch (e) {
            console.error('Load messages failed:', e);
        }
    }, [chatTypeFilter, filterStudentId]);

    // 支架启停/编辑
    const toggleScaffold = async (id: string, currentActive: boolean) => {
        try {
            await api.patch(`/scaffolds/${id}`, { is_active: !currentActive });
            loadScaffolds();
        } catch (e) {
            alert('切换状态失败');
        }
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
        } catch (e) {
            alert('保存失败');
        }
    };

    // 加载支架
    const loadScaffolds = useCallback(async () => {
        try {
            const res = await api.get('/scaffolds');
            setScaffolds(res.data || []);
        } catch (e) {
            console.error('Load scaffolds failed:', e);
        }
    }, []);

    // P1-5 / P2-9: 加载分析数据
    const loadAnalytics = useCallback(async () => {
        try {
            const data = await apiTyped.teacher.analytics();
            setAnalyticsData(data);
        } catch (e) {
            console.error('Load analytics failed:', e);
        }
    }, []);

    // P1-6: 加载知识库文档
    const loadDocuments = useCallback(async () => {
        try {
            const data = await apiTyped.knowledge.list();
            setDocuments(data);
        } catch (e) {
            console.error('Load documents failed:', e);
        }
    }, []);

    // P1-8: 加载作业
    const loadAssignments = useCallback(async () => {
        try {
            const data = await apiTyped.teacher.assignments();
            setAssignments(data || []);
        } catch (e) {
            console.error('Load assignments failed:', e);
        }
    }, []);

    // P2-11: 加载课程
    const loadCourses = useCallback(async () => {
        try {
            const res = await api.get('/courses');
            setCourses(res.data || []);
        } catch (e) {
            console.error('Load courses failed:', e);
        }
    }, []);

    // 统一 CSV 导出
    const handleExportUnifiedCsv = async () => {
        try {
            const blob = await apiTyped.teacher.exportUnifiedCsv();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `unified_messages_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('导出失败');
        }
    };

    // 初始加载
    useEffect(() => {
        setLoading(true);
        Promise.all([loadStats(), loadStudents(), loadScaffolds()])
            .finally(() => setLoading(false));
    }, [loadStats, loadStudents, loadScaffolds]);

    useEffect(() => {
        if (activeTab === 'messages' && messages.length === 0) loadMessages();
        if (activeTab === 'analytics' && !analyticsData) loadAnalytics();
        if (activeTab === 'knowledge' && documents.length === 0) loadDocuments();
        if (activeTab === 'assignments' && assignments.length === 0) loadAssignments();
        if (activeTab === 'courses' && courses.length === 0) loadCourses();
    }, [activeTab, messages.length, loadMessages, analyticsData, loadAnalytics, documents.length, loadDocuments, assignments.length, loadAssignments, courses.length, loadCourses]);

    // XLSX 导入
    const handleImport = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.onchange = async (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const formData = new FormData();
            formData.append('file', file);
            try {
                const res = await api.post('/roster/import', formData);
                alert(`导入完成：新增 ${res.data.created} 人，跳过 ${res.data.skipped} 人`);
                loadStudents();
                loadStats();
            } catch (err) {
                alert('导入失败');
            }
        };
        input.click();
    };

    // P1-5: CSV 导出
    const handleExportCsv = async () => {
        try {
            const blob = await apiTyped.teacher.exportCsv();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `messages_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            alert('导出失败');
        }
    };

    // P1-6: 知识库上传
    const handleUploadDoc = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.docx,.doc,.txt';
        input.onchange = async (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                await apiTyped.knowledge.upload(file);
                alert('上传成功');
                loadDocuments();
            } catch (err) {
                alert('上传失败');
            }
        };
        input.click();
    };

    // P1-6: 删除文档
    const handleDeleteDoc = async (sourceFile: string) => {
        if (!confirm(`确认删除 "${sourceFile}" 的所有切片？`)) return;
        try {
            await apiTyped.knowledge.delete(sourceFile);
            loadDocuments();
        } catch (e) {
            alert('删除失败');
        }
    };

    // P1-8: AI 评分
    const handleAiGrade = async (assignmentId: string) => {
        try {
            const result = await apiTyped.assignments.grade(assignmentId);
            alert('AI 评分完成');
            setAssignments(prev => prev.map(a =>
                a.assignment_id === assignmentId ? { ...a, ...result } : a
            ));
        } catch (e) {
            alert('AI 评分失败');
        }
    };

    // P1-8: 教师复核
    const handleTeacherReview = async () => {
        if (!reviewingAssignment) return;
        try {
            await apiTyped.assignments.review(
                reviewingAssignment.assignment_id,
                reviewScore ? parseInt(reviewScore, 10) : null,
                reviewComment || null,
            );
            setReviewingAssignment(null);
            setReviewScore('');
            setReviewComment('');
            loadAssignments();
        } catch (e) {
            alert('复核失败');
        }
    };

    // P2-11: 创建课程
    const handleCreateCourse = async () => {
        if (!newCourseName.trim()) return;
        try {
            await api.post('/courses', {
                name: newCourseName.trim(),
                description: newCourseDesc.trim(),
            });
            setNewCourseName('');
            setNewCourseDesc('');
            loadCourses();
        } catch (e) {
            alert('创建课程失败');
        }
    };

    const tabs: { type: TabType; icon: React.ElementType; label: string }[] = [
        { type: 'overview', icon: BarChart3, label: '数据概览' },
        { type: 'students', icon: Users, label: '学生管理' },
        { type: 'messages', icon: MessageSquare, label: '对话记录' },
        { type: 'scaffolds', icon: BookOpen, label: '支架管理' },
        { type: 'analytics', icon: TrendingUp, label: '学习分析' },
        { type: 'knowledge', icon: Upload, label: '教材上传' },
        { type: 'assignments', icon: ClipboardCheck, label: '作业批阅' },
        { type: 'courses', icon: GraduationCap, label: '课程管理' },
    ];

    return (
        <div className="h-screen flex bg-gray-50">
            {/* 侧边栏 */}
            <div className="w-56 bg-white border-r border-gray-200 flex flex-col">
                {/* 头部 */}
                <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-900 rounded-xl text-white flex items-center justify-center text-sm font-bold">
                            Co
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-gray-900">CoThink AI</p>
                            <p className="text-[11px] text-gray-400">教师指挥舱</p>
                        </div>
                    </div>
                </div>

                {/* 导航 */}
                <nav className="flex-1 p-2 overflow-y-auto">
                    {tabs.map(({ type, icon: Icon, label }) => (
                        <button
                            key={type}
                            onClick={() => setActiveTab(type)}
                            className={clsx(
                                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors mb-0.5',
                                activeTab === type
                                    ? 'bg-gray-900 text-white font-medium'
                                    : 'text-gray-600 hover:bg-gray-50'
                            )}
                        >
                            <Icon className="w-4 h-4" />
                            {label}
                        </button>
                    ))}
                </nav>

                {/* 用户 */}
                <div className="p-4 border-t border-gray-100">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-medium">
                                {user?.name?.charAt(0) || '?'}
                            </div>
                            <span className="text-sm text-gray-700">{user?.name}</span>
                        </div>
                        <button
                            onClick={logout}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* 主内容 */}
            <div className="flex-1 overflow-y-auto p-6">
                {/* ────── 概览 ────── */}
                {activeTab === 'overview' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h1 className="text-xl font-bold text-gray-900">数据概览</h1>
                            <button
                                onClick={() => { loadStats(); loadStudents(); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> 刷新
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <StatCard icon={Users} label="学生总数" value={stats.student_count ?? '-'} color="#6366f1" />
                            <StatCard icon={Users} label="小组数" value={stats.group_count ?? '-'} color="#f59e0b" />
                            <StatCard icon={MessageSquare} label="消息总数" value={stats.message_count ?? '-'} color="#10b981" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <StatCard icon={MessageSquare} label="AI 回复数" value={stats.ai_message_count ?? '-'} color="#8b5cf6" />
                            <StatCard icon={FileText} label="作业数" value={stats.assignment_count ?? '-'} color="#ef4444" />
                        </div>
                    </div>
                )}

                {/* ────── 学生管理 ────── */}
                {activeTab === 'students' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h1 className="text-xl font-bold text-gray-900">学生管理</h1>
                            <button
                                onClick={handleImport}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                            >
                                <Upload className="w-3.5 h-3.5" /> 导入名单
                            </button>
                        </div>
                        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                                        <th className="px-4 py-3 text-left font-medium">姓名</th>
                                        <th className="px-4 py-3 text-left font-medium">邮箱</th>
                                        <th className="px-4 py-3 text-right font-medium">消息数</th>
                                        <th className="px-4 py-3 text-right font-medium">注册时间</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {students.map((s) => (
                                        <tr key={s.user_id as string} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.name as string}</td>
                                            <td className="px-4 py-3 text-sm text-gray-500">{s.email as string}</td>
                                            <td className="px-4 py-3 text-sm text-right text-gray-600">{s.message_count as number}</td>
                                            <td className="px-4 py-3 text-sm text-right text-gray-400">
                                                {new Date(s.created_at as string).toLocaleDateString('zh-CN')}
                                            </td>
                                        </tr>
                                    ))}
                                    {students.length === 0 && (
                                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-300 text-sm">暂无学生</td></tr>
                                    )}
                                </tbody>
                            </table>
                            {totalStudents > 15 && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                                    <span className="text-xs text-gray-400">共 {totalStudents} 人</span>
                                    <div className="flex gap-1">
                                        <button onClick={() => loadStudents(studentPage - 1)} disabled={studentPage <= 1} className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                                        <span className="text-xs text-gray-500 flex items-center px-2">{studentPage}</span>
                                        <button onClick={() => loadStudents(studentPage + 1)} disabled={studentPage * 15 >= totalStudents} className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ────── 对话记录（统一视图） ────── */}
                {activeTab === 'messages' && (
                    <div>
                        <div className="flex flex-col gap-4 mb-6">
                            <div className="flex items-center justify-between">
                                <h1 className="text-xl font-bold text-gray-900">对话记录</h1>
                                <div className="flex gap-2">
                                    <button onClick={handleExportUnifiedCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
                                        <Download className="w-3.5 h-3.5" /> 导出 CSV
                                    </button>
                                    <button onClick={() => loadMessages(msgPage)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                        <RefreshCw className="w-3.5 h-3.5" /> 刷新
                                    </button>
                                </div>
                            </div>
                            {/* 筛选区 */}
                            <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-gray-200 flex-wrap">
                                {/* 类型按钮组 */}
                                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                                    {([['all', '全部'], ['group', '小组对话'], ['personal', 'AI 1v1']] as const).map(([val, lbl]) => (
                                        <button
                                            key={val}
                                            onClick={() => { setChatTypeFilter(val); setMsgPage(1); }}
                                            className={clsx(
                                                'px-3 py-1.5 text-xs rounded-md transition-colors font-medium',
                                                chatTypeFilter === val
                                                    ? 'bg-white text-gray-900 shadow-sm'
                                                    : 'text-gray-500 hover:text-gray-700'
                                            )}
                                        >
                                            {lbl}
                                        </button>
                                    ))}
                                </div>

                                {/* 学生下拉 */}
                                <select
                                    value={filterStudentId}
                                    onChange={(e) => { setFilterStudentId(e.target.value); setMsgPage(1); }}
                                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-indigo-400 min-w-[140px]"
                                >
                                    <option value="">全部学生</option>
                                    {students.map((s) => (
                                        <option key={s.user_id as string} value={s.user_id as string}>
                                            {s.name as string}
                                        </option>
                                    ))}
                                </select>

                                <button
                                    onClick={() => loadMessages(1)}
                                    className="px-4 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800"
                                >
                                    查询
                                </button>
                                <button
                                    onClick={() => { setChatTypeFilter('all'); setFilterStudentId(''); setMsgPage(1); setTimeout(() => loadMessages(1), 0); }}
                                    className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600"
                                >
                                    重置
                                </button>
                            </div>
                        </div>

                        {/* 消息列表 */}
                        <div className="space-y-2">
                            {messages.map((m) => {
                                const sender = m.sender as Record<string, string>;
                                const isAi = sender?.role === 'ai';
                                const chatType = m.chat_type as string;
                                const groupName = m.group_name as string;
                                return (
                                    <div key={m.message_id as string} className="bg-white rounded-lg border border-gray-200 p-3">
                                        <div className="flex items-center gap-2 mb-1">
                                            {/* 类型标签 */}
                                            <span className={clsx(
                                                'text-[10px] font-medium px-1.5 py-0.5 rounded',
                                                chatType === 'personal' ? 'bg-violet-50 text-violet-600' : 'bg-emerald-50 text-emerald-600'
                                            )}>
                                                {chatType === 'personal' ? '🤖 AI 1v1' : `🟢 ${groupName || '小组'}`}
                                            </span>
                                            {/* 发送者 */}
                                            <span className={clsx(
                                                'text-xs font-medium px-1.5 py-0.5 rounded',
                                                isAi ? 'bg-violet-50 text-violet-600' : 'bg-gray-100 text-gray-600'
                                            )}>
                                                {sender?.name || '未知'}
                                            </span>
                                            <span className="text-[10px] text-gray-300 ml-auto">
                                                {new Date(m.created_at as string).toLocaleString('zh-CN')}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-700 line-clamp-2">{m.content as string}</p>
                                    </div>
                                );
                            })}
                            {messages.length === 0 && <div className="text-center py-8 text-gray-300 text-sm">暂无消息</div>}
                        </div>
                        {totalMessages > 30 && (
                            <div className="flex items-center justify-center gap-2 mt-4">
                                <button onClick={() => loadMessages(msgPage - 1)} disabled={msgPage <= 1} className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
                                <span className="text-xs text-gray-500">第 {msgPage} 页 · 共 {totalMessages} 条</span>
                                <button onClick={() => loadMessages(msgPage + 1)} disabled={msgPage * 30 >= totalMessages} className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
                            </div>
                        )}
                    </div>
                )}

                {/* ────── 支架管理 ────── */}
                {activeTab === 'scaffolds' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h1 className="text-xl font-bold text-gray-900">支架管理</h1>
                            <button onClick={loadScaffolds} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                <RefreshCw className="w-3.5 h-3.5" /> 刷新
                            </button>
                        </div>
                        <div className="space-y-3">
                            {scaffolds.map((s) => (
                                <div key={s.scaffold_id as string} className="bg-white rounded-xl border border-gray-200 p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-medium text-gray-900">{s.display_name as string}</h3>
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => setEditingScaffold(s)} className="text-xs text-indigo-600 hover:text-indigo-800">编辑</button>
                                            <button
                                                onClick={() => toggleScaffold(s.scaffold_id as string, s.is_active as boolean)}
                                                className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium cursor-pointer transition-colors', s.is_active ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-gray-100 text-gray-400 hover:bg-gray-200')}
                                            >
                                                {s.is_active ? '启用中 (点击停用)' : '已停用 (点击启用)'}
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 font-mono bg-gray-50 p-2 rounded">{s.prompt_template as string}</p>
                                </div>
                            ))}
                            {scaffolds.length === 0 && <div className="text-center py-8 text-gray-300 text-sm">暂无支架</div>}
                        </div>

                        {/* 编辑弹窗 */}
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
                                            <input type="text" value={editingScaffold.display_name as string} onChange={(e) => setEditingScaffold({ ...editingScaffold, display_name: e.target.value })} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 mb-1">提示词模板</label>
                                            <textarea value={editingScaffold.prompt_template as string} onChange={(e) => setEditingScaffold({ ...editingScaffold, prompt_template: e.target.value })} rows={5} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
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
                )}

                {/* ────── P1-5 / P2-9: 学习分析 ────── */}
                {activeTab === 'analytics' && (
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
                                {/* 参与度曲线 */}
                                {analyticsData.participation_trend && analyticsData.participation_trend.length > 0 && (
                                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                                        <h3 className="text-sm font-semibold text-gray-900 mb-4">参与度趋势</h3>
                                        <ResponsiveContainer width="100%" height={250}>
                                            <LineChart data={analyticsData.participation_trend}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                                <YAxis tick={{ fontSize: 11 }} />
                                                <Tooltip />
                                                <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="消息数" />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {/* AI 介入率 */}
                                {analyticsData.ai_intervention_rate && analyticsData.ai_intervention_rate.length > 0 && (
                                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                                        <h3 className="text-sm font-semibold text-gray-900 mb-4">AI 介入率（每位学生）</h3>
                                        <ResponsiveContainer width="100%" height={250}>
                                            <BarChart data={analyticsData.ai_intervention_rate}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                                <XAxis dataKey="student_name" tick={{ fontSize: 10 }} />
                                                <YAxis tick={{ fontSize: 11 }} />
                                                <Tooltip />
                                                <Bar dataKey="ai_ratio" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="AI 消息占比" />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {/* 支架使用饼图 */}
                                {analyticsData.scaffold_usage && analyticsData.scaffold_usage.length > 0 && (
                                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                                        <h3 className="text-sm font-semibold text-gray-900 mb-4">支架使用分布</h3>
                                        <ResponsiveContainer width="100%" height={250}>
                                            <PieChart>
                                                <Pie
                                                    data={analyticsData.scaffold_usage}
                                                    cx="50%"
                                                    cy="50%"
                                                    outerRadius={80}
                                                    dataKey="count"
                                                    nameKey="scaffold_name"
                                                    label={(props: any) =>
                                                        `${props.scaffold_name || ''} ${((props.percent || 0) * 100).toFixed(0)}%`
                                                    }
                                                >
                                                    {analyticsData.scaffold_usage.map((_: unknown, idx: number) => (
                                                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                                                    ))}
                                                </Pie>
                                                <Tooltip />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}

                                {/* 活跃会话 */}
                                {analyticsData.active_sessions && analyticsData.active_sessions.length > 0 && (
                                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                                        <h3 className="text-sm font-semibold text-gray-900 mb-4">活跃会话</h3>
                                        <div className="space-y-2">
                                            {analyticsData.active_sessions.map((s: Record<string, unknown>, i: number) => (
                                                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                                                    <span className="text-gray-700 font-mono text-xs">{(s.session_id as string)?.slice(0, 12)}...</span>
                                                    <span className="text-gray-500">{s.message_count as number} 条消息</span>
                                                    <span className="text-gray-400 text-xs">{s.last_activity as string}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 非空但无任何子数据 */}
                                {!analyticsData.participation_trend?.length && !analyticsData.ai_intervention_rate?.length && !analyticsData.scaffold_usage?.length && (
                                    <div className="text-center py-12 text-gray-400 text-sm">暂无足够数据生成分析图表</div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ────── P1-6: 知识库 ────── */}
                {activeTab === 'knowledge' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h1 className="text-xl font-bold text-gray-900">知识库管理</h1>
                            <div className="flex gap-2">
                                <button onClick={handleUploadDoc} className="flex items-center gap-1.5 px-3 py-2 text-xs text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
                                    <Upload className="w-3.5 h-3.5" /> 上传文档
                                </button>
                                <button onClick={loadDocuments} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                    <RefreshCw className="w-3.5 h-3.5" /> 刷新
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-gray-400 mb-4">支持 PDF、Docx、TXT 格式，最大 20MB。上传后将自动切片并建立向量索引，AI 回复时会检索相关上下文。</p>
                        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                                        <th className="px-4 py-3 text-left font-medium">文件名</th>
                                        <th className="px-4 py-3 text-right font-medium">切片数</th>
                                        <th className="px-4 py-3 text-right font-medium">上传时间</th>
                                        <th className="px-4 py-3 text-right font-medium">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {documents.map((d) => (
                                        <tr key={d.source_file as string} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.source_file as string}</td>
                                            <td className="px-4 py-3 text-sm text-right text-gray-600">{d.chunk_count as number}</td>
                                            <td className="px-4 py-3 text-sm text-right text-gray-400">
                                                {d.uploaded_at ? new Date(d.uploaded_at as string).toLocaleDateString('zh-CN') : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button onClick={() => handleDeleteDoc(d.source_file as string)} className="text-red-400 hover:text-red-600">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {documents.length === 0 && (
                                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-300 text-sm">暂无文档</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ────── P1-8: 作业批阅 ────── */}
                {activeTab === 'assignments' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h1 className="text-xl font-bold text-gray-900">作业批阅</h1>
                            <button onClick={loadAssignments} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                <RefreshCw className="w-3.5 h-3.5" /> 刷新
                            </button>
                        </div>
                        <div className="space-y-3">
                            {assignments.map((a) => (
                                <div key={a.assignment_id} className="bg-white rounded-xl border border-gray-200 p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-gray-900">{a.student_name || '未知'}</span>
                                            <span className="text-xs text-gray-400">{a.student_email}</span>
                                            <span className={clsx(
                                                'text-[10px] px-2 py-0.5 rounded-full font-medium',
                                                a.status === 'reviewed' ? 'bg-green-50 text-green-600' :
                                                    a.status === 'ai_graded' ? 'bg-violet-50 text-violet-600' :
                                                        'bg-yellow-50 text-yellow-600'
                                            )}>
                                                {a.status === 'reviewed' ? '已复核' : a.status === 'ai_graded' ? 'AI 已评' : '待批阅'}
                                            </span>
                                        </div>
                                        <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
                                    </div>
                                    <p className="text-sm text-gray-700 line-clamp-3 mb-3">{a.content || '(无文本内容)'}</p>

                                    {/* 附件链接 */}
                                    {a.file_url && (
                                        <div className="mb-3 bg-gray-50 rounded-lg p-2.5">
                                            <div className="flex items-center gap-1.5 mb-1.5">
                                                <Paperclip className="w-3 h-3 text-gray-500" />
                                                <span className="text-xs font-medium text-gray-600">附件</span>
                                            </div>
                                            <div className="space-y-1">
                                                {a.file_url.split(',').filter(Boolean).map((url: string, i: number) => {
                                                    const name = url.split('/').pop()?.replace(/^[a-f0-9]+_/, '') || '附件';
                                                    return (
                                                        <a
                                                            key={i}
                                                            href={url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 hover:underline"
                                                        >
                                                            <Download className="w-3 h-3" />
                                                            {name}
                                                        </a>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* AI 评分结果 */}
                                    {a.ai_review && (
                                        <div className="bg-violet-50 rounded-lg p-3 mb-3">
                                            <p className="text-xs font-medium text-violet-700 mb-1">AI 评分</p>
                                            <div className="flex gap-3 text-xs text-violet-600">
                                                <span>批判性思维: {a.ai_review.scores?.critical_thinking ?? '-'}</span>
                                                <span>论据: {a.ai_review.scores?.evidence ?? '-'}</span>
                                                <span>逻辑: {a.ai_review.scores?.logic ?? '-'}</span>
                                                <span className="font-bold">总分: {a.ai_review.total_score ?? '-'}</span>
                                            </div>
                                            {a.ai_review.summary && <p className="text-xs text-violet-500 mt-1">{a.ai_review.summary}</p>}
                                        </div>
                                    )}

                                    {/* 教师复核结果 */}
                                    {a.teacher_review && (
                                        <div className="bg-green-50 rounded-lg p-3 mb-3">
                                            <p className="text-xs font-medium text-green-700 mb-1">教师复核</p>
                                            <p className="text-xs text-green-600">评分: {a.teacher_review.score ?? '-'} | {a.teacher_review.comment || '无评语'}</p>
                                        </div>
                                    )}

                                    <div className="flex gap-2">
                                        {a.status === 'submitted' && (
                                            <button onClick={() => handleAiGrade(a.assignment_id)} className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-violet-600 rounded-lg hover:bg-violet-700">
                                                <Star className="w-3 h-3" /> AI 评分
                                            </button>
                                        )}
                                        <button onClick={() => { setReviewingAssignment(a); setReviewScore(''); setReviewComment(''); }} className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                            <ClipboardCheck className="w-3 h-3" /> 教师复核
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {assignments.length === 0 && <div className="text-center py-8 text-gray-300 text-sm">暂无作业</div>}
                        </div>

                        {/* 复核弹窗 */}
                        {reviewingAssignment && (
                            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                                <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-sm font-semibold text-gray-900">教师复核</h3>
                                        <button onClick={() => setReviewingAssignment(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                                    </div>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 mb-1">评分 (0-30)</label>
                                            <input type="number" value={reviewScore} onChange={(e) => setReviewScore(e.target.value)} min="0" max="30" className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 mb-1">评语</label>
                                            <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} rows={3} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                                        </div>
                                        <div className="flex justify-end gap-2 pt-2">
                                            <button onClick={() => setReviewingAssignment(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
                                            <button onClick={handleTeacherReview} className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors">提交</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}



                {/* ────── P2-11: 课程管理 ────── */}
                {activeTab === 'courses' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h1 className="text-xl font-bold text-gray-900">课程管理</h1>
                            <button onClick={loadCourses} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                <RefreshCw className="w-3.5 h-3.5" /> 刷新
                            </button>
                        </div>

                        {/* 创建课程表单 */}
                        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                            <h3 className="text-sm font-semibold text-gray-900 mb-3">创建新课程</h3>
                            <div className="flex items-end gap-3">
                                <div className="flex-1">
                                    <label className="block text-xs text-gray-500 mb-1">课程名称</label>
                                    <input type="text" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)} placeholder="例：批判性思维导论" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs text-gray-500 mb-1">描述（可选）</label>
                                    <input type="text" value={newCourseDesc} onChange={(e) => setNewCourseDesc(e.target.value)} placeholder="课程简介..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                                </div>
                                <button onClick={handleCreateCourse} className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 whitespace-nowrap">
                                    创建
                                </button>
                            </div>
                        </div>

                        {/* 课程列表 */}
                        <div className="space-y-3">
                            {courses.map((c) => (
                                <div key={c.course_id as string} className="bg-white rounded-xl border border-gray-200 p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-sm font-medium text-gray-900">{c.name as string}</h3>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(c.invite_code as string); alert('邀请码已复制'); }}
                                            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                                        >
                                            <Copy className="w-3 h-3" />
                                            {c.invite_code as string}
                                        </button>
                                    </div>
                                    {c.description ? <p className="text-xs text-gray-400 mb-2">{String(c.description)}</p> : null}
                                    <p className="text-[10px] text-gray-300">
                                        创建于 {c.created_at ? new Date(c.created_at as string).toLocaleDateString('zh-CN') : '-'}
                                    </p>
                                </div>
                            ))}
                            {courses.length === 0 && <div className="text-center py-8 text-gray-300 text-sm">暂无课程</div>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
