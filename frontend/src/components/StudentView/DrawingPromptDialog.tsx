import React, { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';

interface DrawingPromptDialogProps {
  isOpen: boolean;
  isLoading: boolean;
  initialPrompt: string;
  onConfirm: (prompt: string) => void;
  onCancel: () => void;
}

export const DrawingPromptDialog: React.FC<DrawingPromptDialogProps> = ({
  isOpen,
  isLoading,
  initialPrompt,
  onConfirm,
  onCancel,
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);

  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm transition-opacity">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col transform transition-all">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            AI 绘图设置
          </h2>
          <button
            onClick={onCancel}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1">
          <p className="text-sm text-gray-500 mb-4">
            系统已为您提取讨论共识，您可以在此基础上补充或修改画面细节：
          </p>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 space-y-3 bg-gray-50/50 rounded-xl border border-gray-100">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500 font-medium animate-pulse">正在提炼设计要素...</p>
            </div>
          ) : (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full h-48 p-4 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-400 resize-none transition-all outline-none text-gray-700 leading-relaxed text-sm"
              placeholder="请输入您期望的生图描述..."
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50/50 flex justify-end space-x-3 border-t border-gray-100">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-5 py-2 rounded-xl text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(prompt)}
            disabled={isLoading || !prompt.trim()}
            className="px-5 py-2 rounded-xl text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 shadow-sm transition-all disabled:opacity-50 active:scale-95"
          >
            确认生图
          </button>
        </div>
      </div>
    </div>
  );
};
