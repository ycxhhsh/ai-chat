import React, { useEffect, useState } from 'react';
import { api } from '../../api';
import { FileText, Eye, Download, RefreshCw, BookOpen } from 'lucide-react';
import { DocumentPreviewModal } from '../Shared/DocumentPreviewModal';

interface Material {
    source_file: string;
    file_url?: string;
    chunk_count: number;
    uploaded_at: string;
}

export const MaterialsPanel: React.FC = () => {
    const [materials, setMaterials] = useState<Material[]>([]);
    const [loading, setLoading] = useState(true);
    const [previewDoc, setPreviewDoc] = useState<{ title: string; url: string } | null>(null);

    const loadMaterials = async () => {
        setLoading(true);
        try {
            const res = await api.knowledge.list();
            setMaterials(res as Material[]);
        } catch (e) {
            console.error('Failed to load materials:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMaterials();
    }, []);

    const handlePreview = (doc: Material) => {
        if (!doc.file_url) {
            alert('该资料是早期版本，未保存原文件，暂不支持在线预览或下载。');
            return;
        }
        setPreviewDoc({
            title: doc.source_file,
            url: doc.file_url,
        });
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* 顶栏 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                <div className="flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-indigo-500" />
                    <h2 className="text-lg font-semibold text-gray-900">课程资料</h2>
                </div>
                <button
                    onClick={loadMaterials}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    刷新
                </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                {loading ? (
                    <div className="flex justify-center items-center h-40">
                        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    </div>
                ) : materials.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {materials.map((doc) => (
                            <div key={doc.source_file} className="bg-white rounded-xl p-4 border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all group flex flex-col">
                                <div className="flex items-start gap-3 mb-3">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-500 flex-shrink-0">
                                        <FileText className="w-5 h-5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-sm font-medium text-gray-900 truncate" title={doc.source_file}>
                                            {doc.source_file}
                                        </h3>
                                        <p className="text-xs text-gray-400 mt-1">
                                            {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : '未知时间'}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-auto pt-3 border-t border-gray-50 flex items-center justify-between">
                                    <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded">
                                        共 {doc.chunk_count} 个知识切片
                                    </span>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handlePreview(doc)}
                                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                            title="预览"
                                        >
                                            <Eye className="w-4 h-4" />
                                        </button>
                                        {doc.file_url ? (
                                            <a
                                                href={doc.file_url}
                                                download={doc.source_file}
                                                className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors inline-flex"
                                                title="下载"
                                            >
                                                <Download className="w-4 h-4" />
                                            </a>
                                        ) : (
                                            <span 
                                                className="p-1.5 text-gray-300 cursor-not-allowed inline-flex" 
                                                title="不可下载"
                                            >
                                                <Download className="w-4 h-4" />
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-400">
                            <BookOpen className="w-8 h-8" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-900 mb-1">暂无学习资料</h3>
                        <p className="text-xs text-gray-500">老师还没有上传任何资料哦</p>
                    </div>
                )}
            </div>

            {/* 预览弹窗 */}
            {previewDoc && (
                <DocumentPreviewModal
                    title={previewDoc.title}
                    fileUrl={previewDoc.url}
                    onClose={() => setPreviewDoc(null)}
                />
            )}
        </div>
    );
};
