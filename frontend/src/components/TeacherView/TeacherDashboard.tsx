/**
 * 教师仪表盘 — 薄壳组件
 * Tab 路由 + 侧边栏布局，具体 Tab 内容委托给子组件。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { ChangePasswordModal } from '../Auth/ChangePasswordModal';
import api, { api as apiTyped } from '../../api';
import {
    Users, MessageSquare, BarChart3, FileText, LogOut, RefreshCw,
    Upload, BookOpen, TrendingUp, ClipboardCheck, GraduationCap,
    Menu, KeyRound, ChevronDown, UsersRound,
} from 'lucide-react';
import clsx from 'clsx';

import { StatCard } from './StatCard';

const StudentManager = React.lazy(() => import('./StudentManager').then(mod => ({ default: mod.StudentManager })));
const MessageLog = React.lazy(() => import('./MessageLog').then(mod => ({ default: mod.MessageLog })));
const ScaffoldManager = React.lazy(() => import('./ScaffoldManager').then(mod => ({ default: mod.ScaffoldManager })));
const AnalyticsPanel = React.lazy(() => import('./AnalyticsPanel').then(mod => ({ default: mod.AnalyticsPanel })));
const KnowledgeBase = React.lazy(() => import('./KnowledgeBase').then(mod => ({ default: mod.KnowledgeBase })));
const AssignmentGrading = React.lazy(() => import('./AssignmentGrading').then(mod => ({ default: mod.AssignmentGrading })));
const CourseManager = React.lazy(() => import('./CourseManager').then(mod => ({ default: mod.CourseManager })));
const GroupManager = React.lazy(() => import('./GroupManager').then(mod => ({ default: mod.GroupManager })));
const LearningSpaceDesignManager = React.lazy(() => import('./LearningSpaceDesignManager').then(mod => ({ default: mod.LearningSpaceDesignManager })));

const TabFallback: React.FC = () => (
    <div className="h-full flex items-center justify-center text-sm text-gray-400">
        加载中...
    </div>
);

type TabType = 'overview' | 'students' | 'groups' | 'messages' | 'scaffolds' | 'learning_space_design' | 'analytics' | 'knowledge' | 'assignments' | 'courses';
type ChatTypeFilter = 'all' | 'group' | 'personal';

export const TeacherDashboard: React.FC = () => {
    const { user, logout } = useAuthStore();
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const [_loading, setLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);

    // Shared data state
    const [stats, setStats] = useState<Record<string, number>>({});
    const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
    const [messages, setMessages] = useState<Array<Record<string, unknown>>>([]);
    const [scaffolds, setScaffolds] = useState<Array<Record<string, unknown>>>([]);
    const [studentPage, setStudentPage] = useState(1);
    const [msgPage, setMsgPage] = useState(1);
    const [totalStudents, setTotalStudents] = useState(0);
    const [totalMessages, setTotalMessages] = useState(0);
    const [chatTypeFilter, setChatTypeFilter] = useState<ChatTypeFilter>('all');
    const [filterStudentId, setFilterStudentId] = useState('');
    const [analyticsData, setAnalyticsData] = useState<Record<string, any> | null>(null);
    const [documents, setDocuments] = useState<Array<Record<string, unknown>>>([]);
    const [assignments, setAssignments] = useState<Array<Record<string, any>>>([]);
    const [courses, setCourses] = useState<Array<Record<string, unknown>>>([]);
    const [groupsData, setGroupsData] = useState<Array<Record<string, any>>>([]);

    // Data loaders
    const loadStats = useCallback(async () => {
        try { const res = await api.get('/teacher/stats'); setStats(res.data); } catch (e) { console.error('Load stats failed:', e); }
    }, []);

    const loadStudents = useCallback(async (page = 1) => {
        try {
            const res = await api.get('/teacher/students', { params: { page, page_size: 15 } });
            setStudents(res.data.students || []); setTotalStudents(res.data.total || 0); setStudentPage(page);
        } catch (e) { console.error('Load students failed:', e); }
    }, []);

    const loadMessages = useCallback(async (page = 1) => {
        try {
            const params: Record<string, any> = { page, page_size: 50, type: chatTypeFilter };
            if (filterStudentId) params.student_id = filterStudentId;
            const data = await apiTyped.teacher.unifiedMessages(params);

            if (page === 1) {
                setMessages(data.messages || []);
            } else {
                setMessages(prev => {
                    const existingIds = new Set(prev.map(m => m.message_id));
                    const newMsgs = (data.messages || []).filter((m: any) => !existingIds.has(m.message_id));
                    return [...prev, ...newMsgs];
                });
            }

            setTotalMessages(data.total || 0); setMsgPage(page);
        } catch (e) { console.error('Load messages failed:', e); }
    }, [chatTypeFilter, filterStudentId]);

    const loadScaffolds = useCallback(async () => {
        try { const res = await api.get('/scaffolds'); setScaffolds(res.data || []); } catch (e) { console.error('Load scaffolds failed:', e); }
    }, []);

    const loadAnalytics = useCallback(async () => {
        try { const data = await apiTyped.teacher.analytics(); setAnalyticsData(data); } catch (e) { console.error('Load analytics failed:', e); }
    }, []);

    const loadDocuments = useCallback(async () => {
        try { const data = await apiTyped.knowledge.list(); setDocuments(data); } catch (e) { console.error('Load documents failed:', e); }
    }, []);

    const loadAssignments = useCallback(async () => {
        try { const data = await apiTyped.teacher.assignments(); setAssignments(data || []); } catch (e) { console.error('Load assignments failed:', e); }
    }, []);

    const loadGroups = useCallback(async () => {
        try { const data = await apiTyped.teacher.groups(); setGroupsData(data || []); } catch (e) { console.error('Load groups failed:', e); }
    }, []);

    const loadCourses = useCallback(async () => {
        try { const res = await api.get('/courses'); setCourses(res.data || []); } catch (e) { console.error('Load courses failed:', e); }
    }, []);

    // Initial load
    useEffect(() => {
        setLoading(true);
        Promise.all([loadStats(), loadStudents(), loadScaffolds()]).finally(() => setLoading(false));
    }, [loadStats, loadStudents, loadScaffolds]);

    // Lazy load on tab switch
    useEffect(() => {
        if (activeTab === 'messages' && messages.length === 0) loadMessages();
        if (activeTab === 'analytics' && !analyticsData) loadAnalytics();
        if (activeTab === 'knowledge' && documents.length === 0) loadDocuments();
        if (activeTab === 'assignments' && assignments.length === 0) loadAssignments();
        if (activeTab === 'groups' && groupsData.length === 0) loadGroups();
        if (activeTab === 'courses' && courses.length === 0) loadCourses();
    }, [activeTab, messages.length, loadMessages, analyticsData, loadAnalytics, documents.length, loadDocuments, assignments.length, loadAssignments, groupsData.length, loadGroups, courses.length, loadCourses]);

    const tabs: { type: TabType; icon: React.ElementType; label: string }[] = [
        { type: 'overview', icon: BarChart3, label: '数据概览' },
        { type: 'students', icon: Users, label: '学生管理' },
        { type: 'groups', icon: UsersRound, label: '小组管理' },
        { type: 'messages', icon: MessageSquare, label: '对话记录' },
        { type: 'scaffolds', icon: BookOpen, label: '支架管理' },
        { type: 'learning_space_design', icon: BookOpen, label: '学习空间设计' },
        { type: 'analytics', icon: TrendingUp, label: '学习分析' },
        { type: 'knowledge', icon: Upload, label: '教材上传' },
        { type: 'assignments', icon: ClipboardCheck, label: '作业批阅' },
        { type: 'courses', icon: GraduationCap, label: '课程管理' },
    ];

    return (
        <div className="h-screen flex bg-gray-50">
            {/* 移动端侧边栏遮罩 */}
            {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />}

            {/* 侧边栏 */}
            <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="w-56 h-full bg-white border-r border-gray-200 flex flex-col">
                    <div className="p-4 border-b border-gray-100">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-900 rounded-xl text-white flex items-center justify-center text-sm font-bold">Co</div>
                            <div>
                                <p className="text-sm font-semibold text-gray-900">CoThink AI</p>
                                <p className="text-[11px] text-gray-400">教师指挥舱</p>
                            </div>
                        </div>
                    </div>
                    <nav className="flex-1 p-2 overflow-y-auto">
                        {tabs.map(({ type, icon: Icon, label }) => (
                            <button key={type} onClick={() => { setActiveTab(type); setSidebarOpen(false); }}
                                className={clsx('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors mb-0.5',
                                    activeTab === type ? 'bg-gray-900 text-white font-medium' : 'text-gray-600 hover:bg-gray-50')}>
                                <Icon className="w-4 h-4" />{label}
                            </button>
                        ))}
                    </nav>
                    <div className="p-4 border-t border-gray-100 relative">
                        <button onClick={() => setShowUserMenu(!showUserMenu)}
                            className="flex items-center justify-between w-full hover:bg-gray-50 rounded-lg p-1 -m-1 transition-colors">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-medium">
                                    {user?.name?.charAt(0) || '?'}
                                </div>
                                <span className="text-sm text-gray-700">{user?.name}</span>
                            </div>
                            <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', showUserMenu && 'rotate-180')} />
                        </button>
                        {showUserMenu && (
                            <div className="absolute left-3 right-3 bottom-full mb-1 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
                                <button onClick={() => { setShowPasswordModal(true); setShowUserMenu(false); }}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                                    <KeyRound className="w-4 h-4 text-gray-400" />修改密码
                                </button>
                                <button onClick={logout}
                                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                                    <LogOut className="w-4 h-4" />退出登录
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 主内容 */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-gray-200 md:hidden">
                    <button onClick={() => setSidebarOpen(true)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg">
                        <Menu className="w-5 h-5" />
                    </button>
                    <h1 className="text-sm font-semibold text-gray-900">{tabs.find(t => t.type === activeTab)?.label}</h1>
                </div>
                <div className="flex-1 overflow-y-auto p-4 md:p-6">
                    {/* ── 概览 ── */}
                    {activeTab === 'overview' && (
                        <div>
                            <div className="flex items-center justify-between mb-6">
                                <h1 className="text-xl font-bold text-gray-900">数据概览</h1>
                                <button onClick={() => { loadStats(); loadStudents(); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                    <RefreshCw className="w-3.5 h-3.5" /> 刷新
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-4 md:mb-6">
                                <StatCard icon={Users} label="学生总数" value={stats.student_count ?? '-'} color="#6366f1" />
                                <StatCard icon={Users} label="小组数" value={stats.group_count ?? '-'} color="#f59e0b" />
                                <StatCard icon={MessageSquare} label="消息总数" value={stats.message_count ?? '-'} color="#10b981" />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                                <StatCard icon={MessageSquare} label="AI 回复数" value={stats.ai_message_count ?? '-'} color="#8b5cf6" />
                                <StatCard icon={FileText} label="作业数" value={stats.assignment_count ?? '-'} color="#ef4444" />
                            </div>
                        </div>
                    )}

                    <React.Suspense fallback={<TabFallback />}>
                        {activeTab === 'students' && (
                            <StudentManager students={students} totalStudents={totalStudents}
                                studentPage={studentPage} loadStudents={loadStudents} loadStats={loadStats} />
                        )}

                        {activeTab === 'groups' && (
                            <GroupManager groups={groupsData as any} loadGroups={loadGroups} />
                        )}

                        {activeTab === 'messages' && (
                            <MessageLog messages={messages} totalMessages={totalMessages} msgPage={msgPage}
                                students={students} chatTypeFilter={chatTypeFilter} filterStudentId={filterStudentId}
                                setChatTypeFilter={setChatTypeFilter} setFilterStudentId={setFilterStudentId}
                                setMsgPage={setMsgPage} loadMessages={loadMessages} />
                        )}

                        {activeTab === 'scaffolds' && (
                            <ScaffoldManager scaffolds={scaffolds} loadScaffolds={loadScaffolds} />
                        )}

                        {activeTab === 'learning_space_design' && (
                            <LearningSpaceDesignManager />
                        )}

                        {activeTab === 'analytics' && (
                            <AnalyticsPanel analyticsData={analyticsData} loadAnalytics={loadAnalytics} />
                        )}

                        {activeTab === 'knowledge' && (
                            <KnowledgeBase documents={documents} loadDocuments={loadDocuments} />
                        )}

                        {activeTab === 'assignments' && (
                            <AssignmentGrading assignments={assignments} setAssignments={setAssignments}
                                loadAssignments={loadAssignments} />
                        )}

                        {activeTab === 'courses' && (
                            <CourseManager courses={courses} loadCourses={loadCourses} />
                        )}
                    </React.Suspense>
                </div>
            </div>

            {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
        </div>
    );
};
