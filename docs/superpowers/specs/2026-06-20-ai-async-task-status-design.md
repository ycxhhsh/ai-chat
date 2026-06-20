# AI 异步任务状态模型设计

日期：2026-06-20

## 背景

CoThink 学生端已经有多条 AI 相关异步链路：普通 AI 聊天、开启联网搜索的 AI 回复、设计草图生成，以及学习空间设计里的 AI 提问。这些链路当前分别由 `useChatStore`、`useWebSocket`、局部 loading 状态、toast 和 HTTP 请求处理。

学生视角的问题是：不同功能的等待、失败和重试体验不一致。开发和运维视角的问题是：AI 相关任务缺少统一的状态语言，后续不利于做任务追踪、失败统计和可观测面板。

本设计采用渐进式方案：第一版优先改善学生端体验，同时让任务模型保留后续可观测性字段。第一版不把所有任务后端 Job 化，也不覆盖作业上传、作业提交、自评互评、学习空间报告总结生成等非即时 AI 链路。

## 目标

1. 统一学生端 AI 相关任务的等待、失败、重试体验。
2. 第一版覆盖 AI 聊天、AI 聊天中的 DeepSearch 阶段、设计草图生成、学习空间 AI 提问。
3. 保留 `taskId`、`type`、`status`、`startedAt`、`updatedAt`、`finishedAt`、`errorMessage` 等字段，为后续观测能力打基础。
4. 保持改动克制，尽量映射现有 WebSocket 事件和 HTTP 请求，不重写已有稳定链路。

## 非目标

1. 不在第一版实现完整任务中心或任务历史。
2. 不把 DeepSearch 独立成任务；它只是 `ai_chat` 的进度阶段。
3. 不纳入学习空间报告总结生成。
4. 不纳入作业附件上传、作业提交、自评互评、普通保存等 HTTP 表单链路。
5. 不要求第一版支持后端持久化重试。

## 任务类型

第一版只保留三类任务：

```ts
type AsyncTaskType =
  | 'ai_chat'
  | 'drawing'
  | 'learning_space_ai';
```

DeepSearch 不作为独立 `deep_search` 任务。用户开启联网搜索后，仍然创建 `ai_chat` 任务，只通过 `progressText` 标识“正在联网检索”“已找到资料，正在整合资料”等阶段。

## 任务状态

```ts
type AsyncTaskStatus =
  | 'queued'
  | 'running'
  | 'streaming'
  | 'succeeded'
  | 'failed';
```

状态生命周期：

```text
queued -> running -> streaming -> succeeded
queued -> running -> failed
running -> failed
streaming -> failed
```

第一版不引入 `waiting_external`。设计草图生成虽然会调用第三方服务，但学生端先统一展示为“正在生成设计草图”。

## 数据模型

```ts
interface AsyncTask {
  taskId: string;
  type: AsyncTaskType;
  title: string;
  status: AsyncTaskStatus;
  progressText?: string;
  errorMessage?: string;
  retryable: boolean;
  retryPayload?: unknown;
  source: 'websocket' | 'http';
  relatedId?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
}
```

字段约定：

- `taskId`：优先复用现有 `request_id` / `task_id`；没有时由前端生成。
- `type`：用于决定文案、图标、重试方式。
- `title`：用于右上角任务浮层，例如“AI 正在回复”“正在生成设计草图”。
- `progressText`：用于展示当前阶段，不作为状态机分支。
- `retryPayload`：第一版只保存在前端内存中，用于重新调用原发送函数。
- `source`：区分 WebSocket 链路和 HTTP 链路，方便后续接入后端观测。
- `relatedId`：可存 `conversationId`、`sessionId`、`learningSpaceSessionId` 等上下文。

## 前端架构

新增一个统一 store，例如 `frontend/src/store/useAsyncTaskStore.ts`。

它提供这些能力：

- 创建任务：`startTask(task)`
- 更新状态：`updateTask(taskId, patch)`
- 标记成功：`completeTask(taskId)`
- 标记失败：`failTask(taskId, errorMessage)`
- 关闭任务：`dismissTask(taskId)`
- 重试任务：由调用方提供 retry handler，store 只保留任务与 payload。

现有 store 和组件不整体重写，只在关键节点同步任务状态。

## 事件映射

### AI 聊天

触发点：

- 学生发送 AI 消息时创建 `ai_chat` 任务。
- 如果 metadata 中有 `enable_search=true`，初始 `progressText` 为“正在联网检索”；否则为“正在生成回复”。

WebSocket 映射：

- `AI_TYPING true`：任务进入 `streaming`，文案为“正在生成回复”。
- `AI_STREAM_CHUNK`：保持 `streaming`。
- `WEB_SEARCH_RESULT`：更新 `progressText` 为“已找到资料，正在整合资料”。
- 最终 AI 消息到达或 `AI_REPLY_DONE` 映射完成：任务进入 `succeeded`，短暂展示后自动移除。
- `ERROR` 且带 `task_id`：任务进入 `failed`，显示失败原因和重试入口。

### 设计草图生成

触发点：

- 点击生成草图按钮，或聊天输入识别到绘图意图时创建 `drawing` 任务。

WebSocket 映射：

- 创建任务后进入 `running`，文案为“正在生成设计草图”。
- `DRAWING_DONE`：任务进入 `succeeded`。
- `ERROR` 且 `code` 为绘图相关错误，或能通过 `task_id` 匹配绘图任务：任务进入 `failed`。

### 学习空间 AI

触发点：

- 学习空间当前步骤中发送 AI 问题时创建 `learning_space_ai` 任务。

HTTP 映射：

- 请求开始：`running`，文案为“AI 正在回应本步骤”。
- 请求成功返回 user/assistant message：`succeeded`。
- 请求失败：`failed`，保留学生刚才的问题，提供重试入口。

## 展示设计

第一版采用“页面内联反馈 + 右上角小型任务浮层”。

页面内联反馈：

- AI 聊天：保留现有流式气泡，但统一状态文案。
- DeepSearch：在 AI 聊天任务中显示“正在联网检索”到“已找到资料，正在整合资料”的过渡。
- 绘图：在聊天区或绘图弹窗附近显示“正在生成设计草图”，失败后给“重试生成”。
- 学习空间 AI：在当前学习步骤面板内显示“AI 正在回应本步骤”，失败后保留刚才的问题并给重试。

右上角任务浮层：

- 不替代通知铃铛，不保存历史。
- 默认显示一个小按钮，如“AI 任务 2”或 spinner。
- 点击后列出最多 5 个 `running`、`streaming`、`failed` 任务。
- 成功任务短暂展示后自动消失。
- 失败任务保留“重试”和“关闭”。

## 重试策略

第一版采用前端重试，后续再为长任务升级后端重试。

- AI 聊天：重发原 `content`、`metadata`、`conversationId`。
- DeepSearch：重发原消息，并保留 `enable_search=true`。
- 绘图：重发原 prompt、sessionId、apiProvider。
- 学习空间 AI：重发 sessionId、stepKey、content、provider。

刷新页面后，第一版不保证仍能重试，因为 `retryPayload` 只保存在前端内存中。后续如果要做后端重试，优先升级绘图任务，因为它最像真正长任务，也最容易受第三方服务影响。

## 错误处理

错误文案遵循三层：

1. 学生可读原因：例如“AI 回复超时”“设计草图生成失败”“网络连接中断”。
2. 当前影响：例如“刚才的问题没有得到回复”“草图没有生成”。
3. 可执行动作：例如“重试”“关闭”“稍后再试”。

第一版不把所有错误码标准化，但需要在任务对象中保留 `errorMessage`。后续可以扩展 `errorCode` 和 `debugInfo`。

## 验收标准

1. AI 回复中断时，学生能看到失败原因和重试入口。
2. 开启联网搜索时，状态能从“正在联网检索”过渡到“已找到资料，正在整合资料”。
3. 绘图失败时，可以用同一 prompt 重试。
4. 学习空间 AI 失败后，学生刚才的问题不丢，并能重试。
5. 右上角任务浮层只显示运行中、流式中和失败任务；成功任务不会长期堆积。
6. 现有聊天流式输出、绘图结果插入、学习空间 AI 对话结果展示不发生行为回退。

## 后续扩展

1. 为绘图和 DeepSearch 增加后端任务记录与后端重试。
2. 把 `AsyncTask` 状态写入 `/jobs` 或新的观测接口。
3. 在教师端或运维视图展示任务耗时、失败率、provider 分布。
4. 再评估是否纳入学习空间报告总结、作业上传和作业提交。
