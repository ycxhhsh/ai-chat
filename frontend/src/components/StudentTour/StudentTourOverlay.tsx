interface StudentTourOverlayProps {
    isOpen: boolean;
    stepTitle: string;
    stepBody: string;
    targetRect: DOMRect | null;
    onNext: () => void;
    onBack: () => void;
    onSkip: () => void;
    isFirstStep: boolean;
    isLastStep: boolean;
}

export function StudentTourOverlay({
    isOpen,
    stepTitle,
    stepBody,
    targetRect,
    onNext,
    onBack,
    onSkip,
    isFirstStep,
    isLastStep,
}: StudentTourOverlayProps) {
    if (!isOpen) return null;

    const cardStyle = targetRect
        ? {
            position: 'fixed' as const,
            top: Math.max(16, targetRect.top),
            left: Math.min(window.innerWidth - 336, targetRect.right + 16),
            width: 320,
        }
        : {
            position: 'fixed' as const,
            top: '50%',
            left: '50%',
            width: 320,
            transform: 'translate(-50%, -50%)',
        };

    return (
        <div className="fixed inset-0 z-[120]">
            <div className="absolute inset-0 bg-slate-950/55" />
            {targetRect && (
                <div
                    className="absolute rounded-2xl border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]"
                    style={{
                        top: targetRect.top - 6,
                        left: targetRect.left - 6,
                        width: targetRect.width + 12,
                        height: targetRect.height + 12,
                    }}
                />
            )}
            <div
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
                style={cardStyle}
            >
                {!targetRect && (
                    <p className="mb-2 text-xs font-medium text-amber-600">当前步骤暂时不可定位</p>
                )}
                <h3 className="text-sm font-semibold text-slate-900">{stepTitle}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{stepBody}</p>
                <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                        {!isFirstStep && (
                            <button
                                onClick={onBack}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                            >
                                上一步
                            </button>
                        )}
                        <button
                            onClick={onSkip}
                            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
                        >
                            跳过
                        </button>
                    </div>
                    <button
                        onClick={onNext}
                        className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                    >
                        {isLastStep ? '完成' : '下一步'}
                    </button>
                </div>
            </div>
        </div>
    );
}
