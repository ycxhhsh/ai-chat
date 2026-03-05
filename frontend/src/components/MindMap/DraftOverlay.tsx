/**
 * 草稿浮层控制栏 — AI 生成的脑图草稿采纳/放弃按钮。
 *
 * 当 hasDraft=true 时显示在脑图画布上方，提供：
 * - 采纳按钮：将草稿节点合入 Yjs 主文档并通过 WS 持久化到 DB
 * - 放弃按钮：清除草稿数据
 */
import { useMindMapStore } from '../../store/useMindMapStore';

interface DraftOverlayProps {
    /** WS 发送函数，由父组件传入 */
    onSend: (event: string, data: Record<string, unknown>) => void;
}

export function DraftOverlay({ onSend }: DraftOverlayProps) {
    const { hasDraft, draftRawNodes, acceptDraft, rejectDraft } = useMindMapStore();

    if (!hasDraft) return null;

    const handleAccept = () => {
        const { nodes, edges } = acceptDraft();
        // 发送 WS 事件让后端持久化
        onSend('MINDMAP_ACCEPT_DRAFT', { nodes, edges });
    };

    const handleReject = () => {
        rejectDraft();
    };

    return (
        <div style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 20px',
            borderRadius: '12px',
            background: 'rgba(30, 30, 46, 0.9)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(167, 139, 250, 0.4)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: '#c4b5fd',
                fontSize: '13px',
                fontWeight: 500,
            }}>
                <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#a78bfa',
                    animation: 'pulse 2s infinite',
                }} />
                AI 生成了 {draftRawNodes.length} 个节点
            </div>

            <button
                onClick={handleAccept}
                style={{
                    padding: '6px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                }}
                onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
                onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
                ✓ 采纳
            </button>

            <button
                onClick={handleReject}
                style={{
                    padding: '6px 16px',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'transparent',
                    color: '#94a3b8',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                }}
                onMouseOver={(e) => (e.currentTarget.style.color = '#f87171')}
                onMouseOut={(e) => (e.currentTarget.style.color = '#94a3b8')}
            >
                ✕ 放弃
            </button>
        </div>
    );
}
