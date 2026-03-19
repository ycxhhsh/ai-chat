/**
 * 知识库管理 Tab — 提取自 TeacherDashboard
 */
import React, { useState } from 'react';
import { api as apiTyped } from '../../api';
import { Upload, RefreshCw, Trash2, Eye } from 'lucide-react';
import { DocumentPreviewModal } from '../Shared/DocumentPreviewModal';

interface KnowledgeBaseProps {
    documents: Array<Record<string, unknown>>;
    loadDocuments: () => void;
}

export const KnowledgeBase: React.FC<KnowledgeBaseProps> = ({ documents, loadDocuments }) => {
    const [previewDoc, setPreviewDoc] = useState<{ title: string; url: string } | null>(null);

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
            } catch (_err) { alert('上传失败'); }
        };
        input.click();
    };

    const handleDeleteDoc = async (sourceFile: string) => {
        if (!confirm(`确认删除 "${sourceFile}" 的所有切片？`)) return;
        try {
            await apiTyped.knowledge.delete(sourceFile);
            loadDocuments();
        } catch (_e) { alert('删除失败'); }
    };

    const handlePreview = (doc: Record<string, unknown>) => {
        if (!doc.file_url) {
            alert('该文档是旧版本上传，未保存原文件，请重新上传以支持预览。');
            return;
        }
        setPreviewDoc({
            title: doc.source_file as string,
            url: doc.file_url as string,
        });
    };

    return (
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
                                <td className="px-4 py-3 text-right flex items-center justify-end gap-3">
                                    <button 
                                        onClick={() => handlePreview(d)} 
                                        className={`transition-colors ${d.file_url ? 'text-blue-500 hover:text-blue-700' : 'text-gray-300 hover:text-gray-400 cursor-help'}`}
                                        title={d.file_url ? "预览文档" : "旧版文档，不支持预览"}
                                    >
                                        <Eye className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => handleDeleteDoc(d.source_file as string)} className="text-red-400 hover:text-red-600" title="删除文档及切片">
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
