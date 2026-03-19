/**
 * 学生管理 Tab — 提取自 TeacherDashboard
 */
import React, { useState } from 'react';
import api, { api as apiTyped } from '../../api';
import { Upload, Users, ChevronLeft, ChevronRight } from 'lucide-react';

interface StudentManagerProps {
    students: Array<Record<string, unknown>>;
    totalStudents: number;
    studentPage: number;
    loadStudents: (page?: number) => void;
    loadStats: () => void;
}

export const StudentManager: React.FC<StudentManagerProps> = ({
    students,
    totalStudents,
    studentPage,
    loadStudents,
    loadStats,
}) => {
    const [showAddStudent, setShowAddStudent] = useState(false);
    const [addStudentName, setAddStudentName] = useState('');
    const [addStudentId, setAddStudentId] = useState('');

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
            } catch (_err) {
                alert('导入失败');
            }
        };
        input.click();
    };

    const handleAddStudent = async () => {
        if (!addStudentName.trim() || !addStudentId.trim()) {
            alert('请填写姓名和学号');
            return;
        }
        try {
            const res = await apiTyped.roster.addOne(addStudentName, addStudentId);
            alert(res.message);
            setShowAddStudent(false);
            setAddStudentName('');
            setAddStudentId('');
            loadStudents();
            loadStats();
        } catch (err: any) {
            alert(err?.response?.data?.detail || '添加失败');
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl font-bold text-gray-900">学生管理</h1>
                <button
                    onClick={handleImport}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                >
                    <Upload className="w-3.5 h-3.5" /> 导入名单
                </button>
                <button
                    onClick={() => setShowAddStudent(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                    <Users className="w-3.5 h-3.5" /> + 添加学生
                </button>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
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

            {/* 添加学生弹窗 */}
            {showAddStudent && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-gray-900">添加学生</h3>
                            <button onClick={() => setShowAddStudent(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">姓名</label>
                                <input type="text" value={addStudentName} onChange={(e) => setAddStudentName(e.target.value)} placeholder="张三" className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">学号</label>
                                <input type="text" value={addStudentId} onChange={(e) => setAddStudentId(e.target.value)} placeholder="20210001" className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            <p className="text-[10px] text-gray-400">账号将自动生成为 学号@stu.edu，默认密码 123456</p>
                            <div className="flex justify-end gap-2 pt-2">
                                <button onClick={() => setShowAddStudent(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
                                <button onClick={handleAddStudent} className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors">确认添加</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
