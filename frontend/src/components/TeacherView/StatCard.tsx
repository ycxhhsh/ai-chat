/**
 * 统计卡片 (Bento Box) — 提取自 TeacherDashboard
 */
import React from 'react';

export function StatCard({
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
        <div className="bg-white rounded-3xl border border-gray-100 p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
            <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: color + '12' }}
            >
                <Icon className="w-6 h-6" style={{ color }} />
            </div>
            <div>
                <p className="text-3xl font-extrabold text-gray-900 tracking-tight">{value}</p>
                <p className="text-xs text-gray-400 mt-0.5 font-medium">{label}</p>
            </div>
        </div>
    );
}
