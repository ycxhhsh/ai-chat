import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudentTourOverlay } from './StudentTourOverlay';

describe('StudentTourOverlay', () => {
    it('renders the current step card and action buttons', () => {
        Object.defineProperty(globalThis, 'window', {
            value: { innerWidth: 1280 },
            configurable: true,
        });

        const onNext = vi.fn();
        const onBack = vi.fn();
        const onSkip = vi.fn();

        const html = renderToStaticMarkup(
            <StudentTourOverlay
                isOpen
                stepTitle="AI 导师"
                stepBody="这里可以和 AI 单独对话。"
                targetRect={{ top: 48, left: 24, right: 144, width: 120, height: 40 } as DOMRect}
                onNext={onNext}
                onBack={onBack}
                onSkip={onSkip}
                isFirstStep
                isLastStep={false}
            />
        );

        expect(html).toContain('AI 导师');
        expect(html).toContain('这里可以和 AI 单独对话。');
        expect(html).toContain('下一步');
        expect(html).toContain('跳过');
    });

    it('falls back to a centered card when no target element is provided', () => {
        const html = renderToStaticMarkup(
            <StudentTourOverlay
                isOpen
                stepTitle="资料"
                stepBody="查看课程资料。"
                targetRect={null}
                onNext={() => {}}
                onBack={() => {}}
                onSkip={() => {}}
                isFirstStep={false}
                isLastStep
            />
        );

        expect(html).toContain('当前步骤暂时不可定位');
        expect(html).toContain('完成');
    });
});
