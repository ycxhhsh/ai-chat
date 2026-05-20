import React, { useState, useEffect } from 'react';
import { X, ExternalLink, Download } from 'lucide-react';
import mammoth from 'mammoth';

interface Props {
    title: string;
    fileUrl: string;
    onClose: () => void;
}

export const DocumentPreviewModal: React.FC<Props> = ({ title, fileUrl, onClose }) => {
    // 基础后缀判断
    const ext = title.split('.').pop()?.toLowerCase() || '';
    const isPdfOrTxt = ['pdf', 'txt'].includes(ext);
    const isOfficeDoc = ['doc', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext);

    // Mammoth DOCX state
    const [docxHtml, setDocxHtml] = useState<string>('');
    const [docxLoading, setDocxLoading] = useState<boolean>(false);

    useEffect(() => {
        if (ext === 'docx') {
            setDocxLoading(true);
            fetch(fileUrl)
                .then(res => res.arrayBuffer())
                .then(buffer => mammoth.convertToHtml({ arrayBuffer: buffer }))
                .then(result => setDocxHtml(result.value))
                .catch(err => setDocxHtml(`<div class="text-red-500">解析文档失败: ${err.message}</div>`))
                .finally(() => setDocxLoading(false));
        }
    }, [fileUrl, ext]);

    // 确保 URL 为绝对路径以便 Office Web Viewer 读取
    const absoluteFileUrl = fileUrl.startsWith('http')
        ? fileUrl
        : `${window.location.protocol}//${window.location.host}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;

    // 生成 Office Viewer 链接
    const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteFileUrl)}`;

    // 对于不支持 iframe 的，直接显示下载提示
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                {/* 头部 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                    <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900 truncate" title={title}>
                            {title}
                        </h3>
                        <span className="px-2 py-0.5 rounded bg-gray-200 text-gray-600 text-[10px] uppercase font-medium">
                            {ext}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <a
                            href={fileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="在新标签页中打开"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </a>
                        <a
                            href={fileUrl}
                            download={title}
                            className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="下载文件"
                        >
                            <Download className="w-4 h-4" />
                        </a>
                        <div className="w-px h-4 bg-gray-200 mx-1" />
                        <button
                            onClick={onClose}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="关闭预览"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* 内容区 */}
                <div className="flex-1 bg-gray-100/50 relative overflow-hidden flex items-center justify-center p-4">
                    {isPdfOrTxt ? (
                        <iframe
                            src={fileUrl}
                            className="w-full h-full bg-white rounded-lg shadow-sm border border-gray-200"
                            title={title}
                        />
                    ) : ext === 'docx' ? (
                        <div className="w-full h-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-auto p-4 md:p-8">
                            {docxLoading ? (
                                <div className="flex items-center justify-center h-full text-gray-500 space-x-2">
                                    <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                    <span>正在加载文档...</span>
                                </div>
                            ) : (
                                <div
                                    className="prose prose-blue max-w-none prose-img:rounded-md"
                                    dangerouslySetInnerHTML={{ __html: docxHtml }}
                                />
                            )}
                        </div>
                    ) : isOfficeDoc ? (
                        <iframe
                            src={officeViewerUrl}
                            className="w-full h-full bg-white rounded-lg shadow-sm border border-gray-200"
                            title={title}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center text-center max-w-md">
                            <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center mb-4">
                                <Download className="w-8 h-8" />
                            </div>
                            <h4 className="text-lg font-medium text-gray-900 mb-2">
                                浏览器不支持预览该格式
                            </h4>
                            <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                                {title} 属于不支持直接在线渲染的格式。请点击下方按钮下载并在本地设备查看。
                            </p>
                            <a
                                href={fileUrl}
                                download={title}
                                className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
                            >
                                <Download className="w-4 h-4" />
                                下载文件
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
