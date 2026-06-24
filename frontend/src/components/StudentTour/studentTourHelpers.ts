type StudentTourChannel = 'group' | 'ai' | 'materials' | 'assignment' | 'learning_space';

const STEP_CHANNEL_MAP: Record<string, StudentTourChannel> = {
    ai: 'ai',
    group: 'group',
    'learning-space': 'learning_space',
    assignment: 'assignment',
    materials: 'materials',
};

export function getStudentTourChannel(stepId: string): StudentTourChannel {
    return STEP_CHANNEL_MAP[stepId] || 'ai';
}

export function findTourTargetElement(
    targetKey: string,
    root: Pick<Document, 'querySelector'> = document,
) {
    return root.querySelector(`[data-tour-target="${targetKey}"]`);
}
