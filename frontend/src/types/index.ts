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
    session_id: string;
    student_id: string;
    content: string | null;
    file_url: string | null;
    ai_review: Record<string, unknown> | null;
    teacher_review: Record<string, unknown> | null;
    status: 'submitted' | 'graded';
    created_at: string;
}

// ── LLM Provider ──

export interface LLMProvider {
    name: string;
    display_name: string;
    model: string;
}

// ── 思维导图 ──

export type MindMapNodeType = 'concept' | 'argument' | 'evidence' | 'question';

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
