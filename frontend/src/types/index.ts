/**
 * CoThink AI 类型定义。
 * 从原项目迁移并扩展。
 */

// ── 基础类型 ──

export interface Sender {
    id: string;
    name: string;
    role: 'student' | 'teacher' | 'ai';
}

export interface TimingInfo {
    absolute_time: string;
    relative_minute: number;
}

export interface ScaffoldInfo {
    id: string;
    name: string;
}

export interface MessageMetadata {
    is_scaffold_used?: boolean;
    scaffold_info?: ScaffoldInfo;
    is_deep_thinking?: boolean;
    mentions?: string[];
}

// ── 消息 ──

export interface ChatMessage {
    message_id: string;
    session_id: string;
    sender: Sender;
    content: string;
    timing: TimingInfo;
    metadata_info: MessageMetadata;
    created_at: string;
    recipient_id?: string | null;
    status?: 'sending' | 'sent' | 'failed';
    request_id?: string;
}

// ── 用户 ──

export interface User {
    user_id: string;
    email: string;
    name: string;
    role: 'student' | 'teacher';
    created_at: string;
}

// ── 小组 ──

export interface Group {
    id: string;
    name: string;
    invite_code: string;
    created_by: string;
    created_at: string;
    current_stage: string;
}

// ── 支架 ──

export interface Scaffold {
    scaffold_id: string;
    display_name: string;
    prompt_template: string;
    is_active: boolean;
    sort_order: number;
}

// ── 作业 ──

export interface Assignment {
    assignment_id: string;
    task_id?: string | null;
    session_id: string;
    student_id: string;
    content: string | null;
    file_url: string | null;
    ai_review: Record<string, unknown> | null;
    teacher_review: Record<string, unknown> | null;
    status: 'submitted' | 'ai_graded' | 'reviewed' | 'graded' | string;
    created_at: string;
}

export interface AssignmentSelfReview {
    id: string;
    task_id?: string;
    assignment_id: string;
    student_id?: string;
    score: number;
    comment: string | null;
    created_at?: string;
    updated_at?: string;
}

export interface AssignmentTask {
    task_id: string;
    title: string;
    description: string | null;
    status: 'published' | 'peer_review' | 'closed' | string;
    peer_review_count: number;
    created_by?: string;
    target_count?: number;
    submitted_count?: number;
    missing_count?: number;
    self_review_count?: number;
    peer_review_total?: number;
    peer_review_completed?: number;
    teacher_reviewed_count?: number;
    peer_review_started_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface AssignmentTaskListItem {
    task: AssignmentTask;
    assignment: Assignment | null;
    self_review: AssignmentSelfReview | null;
    peer_review_total: number;
    peer_review_completed: number;
}

export interface StudentPeerReview {
    id: string;
    task_id: string;
    anonymous_label: string;
    content: string | null;
    file_url: string | null;
    score: number | null;
    comment: string | null;
    status: 'assigned' | 'submitted' | string;
    assigned_at: string;
    submitted_at: string | null;
}

export interface ReceivedPeerReview {
    id: string;
    anonymous_label: string;
    score: number | null;
    comment: string | null;
    submitted_at: string | null;
}

export interface AssignmentTaskDetail {
    task: AssignmentTask;
    assignment: Assignment | null;
    self_review: AssignmentSelfReview | null;
    peer_reviews: StudentPeerReview[];
    received_peer_reviews: ReceivedPeerReview[];
}

export interface TeacherPeerReview {
    id: string;
    task_id: string;
    assignment_id: string;
    reviewer_id: string;
    reviewer_name: string;
    reviewer_email: string;
    reviewee_id: string;
    reviewee_name: string;
    reviewee_email: string;
    score: number | null;
    comment: string | null;
    status: 'assigned' | 'submitted' | string;
    assigned_at: string;
    submitted_at: string | null;
}

export interface TeacherAssignmentTaskTarget {
    student_id: string;
    student_name: string;
    student_email: string;
    assigned_at: string;
    assignment: Assignment | null;
    self_review: AssignmentSelfReview | null;
    peer_reviews_received: TeacherPeerReview[];
    peer_reviews_assigned: TeacherPeerReview[];
}

export interface TeacherAssignmentTaskDetail {
    task: AssignmentTask;
    target_student_ids: string[];
    targets: TeacherAssignmentTaskTarget[];
}

// ── LLM Provider ──

export interface LLMProvider {
    name: string;
    display_name: string;
    model: string;
}

// ── 思维导图 ──

export type MindMapNodeType = 'concept' | 'argument' | 'evidence' | 'question' | 'suggestion';

export interface MindMapNodeData {
    label: string;
    nodeType: MindMapNodeType;
    [key: string]: unknown;
}

export interface MindMapNode {
    id: string;
    label: string;
    type: MindMapNodeType;
    position?: { x: number; y: number };
    data?: MindMapNodeData;
}

export interface MindMapEdge {
    id: string;
    source: string;
    target: string;
    label: string;
}

export interface MindMapData {
    id: string;
    session_id: string;
    nodes: MindMapNode[];
    edges: MindMapEdge[];
    version: number;
}

export type LearningSpaceStepKey =
    | 'self_think'
    | 'ai_question'
    | 'verify'
    | 'challenge'
    | 'integrate';

export interface LearningSpaceQuestion {
    id: string;
    stage_name: string;
    title: string;
    description: string | null;
    enabled_steps: LearningSpaceStepKey[];
    ai_round_limit: number;
    min_words_step1: number;
    min_words_step3: number;
    min_words_step5: number;
    allow_ai_acceleration: boolean;
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface LearningSpaceSessionSummary {
    id: string;
    current_step: LearningSpaceStepKey;
    current_step_index: number;
    status: 'in_progress' | 'completed';
    used_acceleration: boolean;
    updated_at: string;
    completed_at: string | null;
}

export interface LearningSpaceSession extends LearningSpaceSessionSummary {
    question_id: string;
    student_id: string;
    group_id: string | null;
    summary: string | null;
    created_at: string;
    last_activity_at: string;
}

export interface LearningSpaceEntry {
    id: string;
    session_id: string;
    step_key: LearningSpaceStepKey;
    content: string;
    version: number;
    created_at: string;
    updated_at: string;
}

export interface LearningSpaceMessage {
    id: string;
    session_id: string;
    step_key: LearningSpaceStepKey;
    role: 'user' | 'assistant';
    content: string;
    round_index: number;
    created_at: string;
}

export interface LearningSpaceRevision {
    id: string;
    entry_id: string;
    old_content: string;
    new_content: string;
    edited_by: string;
    edited_at: string;
}

export interface LearningSpaceAccelerationCheck {
    id: string;
    session_id: string;
    step_key: LearningSpaceStepKey;
    allowed: boolean;
    reason: string;
    suggested_next_step: LearningSpaceStepKey | null;
    adopted: boolean;
    created_at: string;
}

export interface LearningSpaceStepCompletion {
    step_key: LearningSpaceStepKey;
    label: string;
    type: 'text' | 'ai';
    done: boolean;
    word_count: number;
    min_words: number;
    ai_rounds_used: number;
    ai_round_limit: number;
    quality_flags: string[];
}

export interface LearningSpaceSessionPayload {
    question: LearningSpaceQuestion;
    session: LearningSpaceSession;
    entries: LearningSpaceEntry[];
    messages: LearningSpaceMessage[];
    acceleration_checks: LearningSpaceAccelerationCheck[];
    revisions: LearningSpaceRevision[];
    step_completion?: LearningSpaceStepCompletion[];
}

export interface LearningSpaceStudentQuestionItem {
    question: LearningSpaceQuestion;
    session: LearningSpaceSessionSummary | null;
}
