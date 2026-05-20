import React, { useRef } from 'react';
import { MarkdownContent } from '../Chat/MarkdownContent';

interface Props {
    report: any;
    viewer: 'student' | 'teacher';
}

const stepLabelMap: Record<string, string> = {
    self_think: '自主思考',
    ai_question: '对话提问',
    verify: '获取验证',
    challenge: '追问/反驳',
    integrate: '深化整合',
};

export const LearningSpaceDesignReport: React.FC<Props> = ({ report, viewer }) => {
    const reportRef = useRef<HTMLDivElement>(null);
    if (!report) return null;

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => printReportElement(reportRef.current, report.question?.title || '学习空间设计报告')}
                    className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                >
                    打印 / 导出 PDF
                </button>
            </div>

            <div ref={reportRef} className="bg-white rounded-xl border border-gray-200 p-5 space-y-5 print:border-0 print:shadow-none">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">学习空间设计报告</h2>
                    <p className="text-sm text-gray-500 mt-1">{report.question?.title}</p>
                </div>

                {report.summary && (
                    <section>
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">摘要</h3>
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-gray-700 leading-7">
                            <MarkdownContent content={report.summary} />
                        </div>
                    </section>
                )}

                <section>
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">基础信息</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div className="bg-gray-50 rounded-lg p-3">学生姓名：{report.basic_info?.student_name || '-'}</div>
                        <div className="bg-gray-50 rounded-lg p-3">项目阶段：{report.basic_info?.stage_name || '-'}</div>
                        <div className="bg-gray-50 rounded-lg p-3">子问题：{report.basic_info?.question_title || '-'}</div>
                        <div className="bg-gray-50 rounded-lg p-3">完成状态：{report.basic_info?.status || '-'}</div>
                        <div className="bg-gray-50 rounded-lg p-3">
                            启用步骤：{(report.basic_info?.enabled_steps || []).map((step: string) => stepLabelMap[step] || step).join(' / ')}
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3">使用加速：{report.basic_info?.used_acceleration ? '是' : '否'}</div>
                    </div>
                </section>

                <section className="space-y-4">
                    <h3 className="text-sm font-semibold text-gray-900">完整过程</h3>
                    {(report.steps || []).map((step: any) => (
                        <div key={step.step_key} className="break-inside-avoid border border-gray-200 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-semibold text-gray-900">{step.label || stepLabelMap[step.step_key] || step.step_key}</h4>
                                <span className="text-[11px] px-2 py-1 bg-gray-100 rounded-full text-gray-500">
                                    {step.type === 'ai' ? 'AI 对话' : '文本记录'}
                                </span>
                            </div>
                            {step.type === 'text' ? (
                                <div className="text-sm text-gray-700 leading-7">
                                    {step.final_content ? <MarkdownContent content={step.final_content} /> : '暂无内容'}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {(step.messages || []).map((message: any) => (
                                        <div
                                            key={message.id}
                                            className={`rounded-lg p-3 text-sm leading-7 ${
                                                message.role === 'assistant'
                                                    ? 'bg-violet-50 border border-violet-100'
                                                    : 'bg-gray-50 border border-gray-200'
                                            }`}
                                        >
                                            <div className="text-[11px] font-medium mb-1 text-gray-500">
                                                {message.role === 'assistant' ? 'AI' : '学生'} · 第 {message.round_index} 轮
                                            </div>
                                            {message.role === 'assistant' ? (
                                                <MarkdownContent content={message.content} />
                                            ) : (
                                                <div className="whitespace-pre-wrap">{message.content}</div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {viewer === 'teacher' && step.revisions?.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
                                    <h5 className="text-xs font-semibold text-gray-800 mb-2">修改历史</h5>
                                    <div className="space-y-2">
                                        {step.revisions.map((revision: any) => (
                                            <div key={revision.id} className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
                                                <div className="mb-2 text-gray-500">{new Date(revision.edited_at).toLocaleString('zh-CN')}</div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <div>
                                                        <div className="font-medium mb-1">修改前</div>
                                                        <div className="whitespace-pre-wrap">{revision.old_content}</div>
                                                    </div>
                                                    <div>
                                                        <div className="font-medium mb-1">修改后</div>
                                                        <div className="whitespace-pre-wrap">{revision.new_content}</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </section>

                {viewer === 'teacher' && (report.acceleration_checks || []).length > 0 && (
                    <section>
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">AI 加速判断记录</h3>
                        <div className="space-y-2">
                            {report.acceleration_checks.map((check: any) => (
                                <div key={check.id} className="break-inside-avoid border border-gray-200 rounded-lg p-3 text-sm">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-medium text-gray-800">{stepLabelMap[check.step_key] || check.step_key}</span>
                                        <span className={`text-xs px-2 py-1 rounded-full ${check.allowed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                            {check.allowed ? '允许加速' : '不允许加速'}
                                        </span>
                                    </div>
                                    <div className="text-gray-600">{check.reason}</div>
                                    <div className="text-xs text-gray-400 mt-2">
                                        建议下一步：{check.suggested_next_step ? (stepLabelMap[check.suggested_next_step] || check.suggested_next_step) : '无'}，
                                        是否采用：{check.adopted ? '是' : '否'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

function printReportElement(element: HTMLDivElement | null, title: string) {
    if (!element) {
        window.print();
        return;
    }

    const printWindow = window.open('', '_blank', 'width=900,height=1200');
    if (!printWindow) {
        window.print();
        return;
    }

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map((node) => node.outerHTML)
        .join('\n');

    printWindow.document.write(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  ${styles}
  <style>
    @page { size: A4; margin: 14mm; }
    html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
    body { padding: 0; color: #111827; }
    * { overflow: visible !important; max-height: none !important; }
    .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
  </style>
</head>
<body>
  ${element.outerHTML}
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => {
        printWindow.print();
    }, 300);
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
