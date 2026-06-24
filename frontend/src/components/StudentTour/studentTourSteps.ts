export type StudentTourPlacement = 'top' | 'right' | 'bottom' | 'left';

export interface StudentTourStep {
    id: string;
    title: string;
    body: string;
    targetKey: string;
    placement: StudentTourPlacement;
}

export const studentTourSteps: StudentTourStep[] = [
    {
        id: 'ai',
        title: 'AI 导师',
        body: '这里可以和 AI 单独对话，适合先把你的问题、思路和追问说清楚。',
        targetKey: 'sidebar-ai',
        placement: 'right',
    },
    {
        id: 'group',
        title: '小组讨论',
        body: '这里是和同学协作讨论的入口，需要时也可以在组内继续和 AI 配合。',
        targetKey: 'sidebar-group',
        placement: 'right',
    },
    {
        id: 'learning-space',
        title: '学习空间设计',
        body: '这里是更结构化的学习流程，适合按步骤完成思考、验证和整合。',
        targetKey: 'sidebar-learning-space',
        placement: 'right',
    },
    {
        id: 'assignment',
        title: '作业提交',
        body: '这里可以提交作业，之后也能继续查看自评、互评和反馈。',
        targetKey: 'sidebar-assignment',
        placement: 'right',
    },
    {
        id: 'materials',
        title: '资料与检索',
        body: '这里可以查看资料；需要更重的检索和整理时，再使用对应的搜索能力。',
        targetKey: 'sidebar-materials',
        placement: 'right',
    },
];
