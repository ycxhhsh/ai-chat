/**
 * 课程管理 Tab — 提取自 TeacherDashboard
 */
import React, { useState } from 'react';
import api from '../../api';
import { RefreshCw, Copy } from 'lucide-react';

interface CourseManagerProps {
    courses: Array<Record<string, unknown>>;
    loadCourses: () => void;
}

export const CourseManager: React.FC<CourseManagerProps> = ({ courses, loadCourses }) => {
    const [newCourseName, setNewCourseName] = useState('');
    const [newCourseDesc, setNewCourseDesc] = useState('');

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
        } catch (_e) { alert('创建课程失败'); }
    };

    return (
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
                        <input type="text" value={newCourseName} onChange={(e) => setNewCourseName(e.target.value)}
                            placeholder="例：批判性思维导论"
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">描述（可选）</label>
                        <input type="text" value={newCourseDesc} onChange={(e) => setNewCourseDesc(e.target.value)}
                            placeholder="课程简介..."
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    </div>
                    <button onClick={handleCreateCourse}
                        className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 whitespace-nowrap">
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
                            <button onClick={() => { navigator.clipboard.writeText(c.invite_code as string); alert('邀请码已复制'); }}
                                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800">
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
    );
};
