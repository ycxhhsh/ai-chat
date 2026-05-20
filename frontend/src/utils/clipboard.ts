/**
 * 剪贴板工具类
 * 兼容处理在非安全上下文（HTTP）下 navigator.clipboard 不可用的问题
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
    // 优先使用现代 API (需要 HTTPS 或 localhost)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            console.error("Failed to copy with navigator.clipboard", e);
        }
    }

    // 降级方案：document.execCommand('copy')
    try {
        const textArea = document.createElement("textarea");
        textArea.value = text;

        // 确保它不影响页面布局，不在屏幕可见范围内
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);

        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
    } catch (e) {
        console.error("Fallback copy failed", e);
        return false;
    }
};
