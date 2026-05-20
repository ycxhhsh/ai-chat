# CoThink AI 交接文档

> 最后更新：2026-05-21
> 服务器：`101.37.214.150`
> 本地项目根目录：`D:\Program\ai-project\EDtech\cothink`
> 服务器目录：`/opt/cothink`
> Git 分支：`test`
> Git 远程：`origin https://github.com/ycxhhsh/ai-chat.git`

---

## 1. 当前整体情况

CoThink AI 是面向协作学习的 AI 教育平台，当前主项目在 `cothink` 仓库内，根目录 `D:\Program\ai-project\EDtech` 主要放交接文档、资料和周边脚本。

当前核心能力：

- 学生端：AI 1v1 导师、小组讨论、课程资料、作业提交、自评互评、思维导图、学习空间设计。
- 教师端：学生管理、小组管理、对话记录、支架管理、学习分析、教材上传、作业批阅、课程管理、学习空间设计。
- 后端：FastAPI REST API、WebSocket、异步 AI 队列、评分 worker、DeepSearch jobs、通知、RAG 知识库、Alembic 迁移。
- 协作与 AI：小组 WebSocket 实时协作、Yjs 思维导图协作、多 LLM / OpenAI 兼容客户端、对话 working memory。

技术栈：

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 7 + Zustand + React Flow + TailwindCSS |
| 后端 | FastAPI + SQLAlchemy async + Alembic |
| 数据 | PostgreSQL 16 / pgvector + Redis |
| AI | DeepSeek / OpenAI-compatible providers |
| 协作 | WebSocket + Yjs |
| 部署 | Docker Compose + Nginx + PowerShell deploy script |

---

## 2. 本轮主要新增与现状

### 学习空间设计

当前已经形成独立业务线，不混入普通 AI 聊天表，也不复用 EDIPT 阶段状态。

- 教师端入口：`TeacherDashboard` 的 `learning_space_design` tab。
- 学生端入口：`StudentView` 的 `learning_space` channel。
- 前端组件：
  - `frontend/src/components/TeacherView/LearningSpaceDesignManager.tsx`
  - `frontend/src/components/StudentView/LearningSpaceDesignPanel.tsx`
  - `frontend/src/components/LearningSpaceDesign/LearningSpaceDesignReport.tsx`
- 后端链路：
  - `backend/app/routers/learning_space_design.py`
  - `backend/app/services/learning_space_design_service.py`
  - `backend/app/services/learning_space_design_summary.py`
  - `backend/app/models/learning_space_design.py`
  - `backend/alembic/versions/add_learning_space_design.py`
- 数据表：
  - `learning_space_questions`
  - `learning_space_sessions`
  - `learning_space_entries`
  - `learning_space_revisions`
  - `learning_space_messages`
  - `learning_space_acceleration_checks`

### 作业任务、自评与匿名互评

作业系统从单次提交扩展为教师发布任务、指定学生、学生提交、自评、教师开启匿名互评的流程。

- 后端模型集中在 `backend/app/models/assignment.py`。
- 教师接口集中在 `/teacher/assignment-tasks`。
- 学生接口集中在 `/assignments/tasks` 与 `/assignments/peer-reviews/{review_id}`。
- 匿名互评分配逻辑：`backend/app/services/peer_review_assignment.py`。
- 对应迁移：`backend/alembic/versions/add_assignment_tasks_peer_review.py`。
- 对应测试：`backend/tests/unit/test_peer_review_assignment.py`。

### AI 1v1 与上下文记忆

AI 对话新增 working memory：

- `ai_conversations` 增加 `working_memory` 和 `msg_count_at_summary`。
- 迁移：`backend/alembic/versions/add_convo_working_memory.py`。
- 摘要更新：`backend/app/services/summary_service.py`。
- 上下文注入：`backend/app/llm/context_builder.py`。
- WebSocket/AI worker 链路已有相关异步触发点。

### 前端体验与工具链

- 聊天内容支持 Markdown 渲染组件：`frontend/src/components/Chat/MarkdownContent.tsx`。
- 学生端新增设计草图提示弹窗：`frontend/src/components/StudentView/DrawingPromptDialog.tsx`。
- 教师端小组/课程等位置加入复制体验辅助：`frontend/src/utils/clipboard.ts`。
- 前端依赖已更新，当前构建产物主 JS chunk 较大，后续建议拆包。

---

## 3. 部署与配置现状

### 当前推荐部署流程

`deploy.ps1` 已是可读 UTF-8，并包含前端构建、dist 上传、后端打包上传、镜像构建、Alembic 迁移、后端/worker 重启、健康检查。

常规流程：

1. 本地前端构建：`cd frontend && npm run build`
2. 上传 `frontend/dist` 到 `/opt/cothink/frontend/dist`
3. 打包并上传 `backend`
4. 服务器构建后端镜像：`docker compose build backend`
5. 执行迁移：`docker compose run --rm backend alembic upgrade head`
6. 重启：`docker compose up -d backend ai-worker grading-worker`
7. 健康检查：`curl http://localhost:8000/healthz`

注意：

- 历史上线上数据库出现过 Alembic 状态漂移：`mindmaps.last_processed_at` 已存在，但版本表停在 `gin_jsonb_001`。
- 当时通过 `alembic stamp add_mindmap_last_processed` 后再 `alembic upgrade head` 修复。
- 以后遇到“列已存在但迁移还要重复加”的情况，先查 `alembic_version` 和真实表结构，不要直接改迁移文件。

### Nginx 与本地代理

线上 Nginx 必须代理这些后端路径：

- `/auth`
- `/groups`
- `/messages`
- `/scaffolds`
- `/assignments`
- `/upload`
- `/analytics`
- `/roster`
- `/llm`
- `/knowledge`
- `/courses`
- `/ai-conversations`
- `/healthz`
- `/teacher`
- `/jobs`
- `/notifications`
- `/mindmaps`
- `/learning-space-design`
- `/ws`
- `/yjs`

当前仓库中相关配置：

- `cothink_nginx.conf`
- `backend/nginx.conf`
- `frontend/vite.config.ts`

待注意：`frontend/vite.config.ts` 的本地 dev proxy 仍需和线上 Nginx 路径保持完全同步，尤其是 `/learning-space-design`、`/jobs`、`/notifications`、`/mindmaps`。

---

## 4. 验证结果

2026-05-21 本地已执行：

- `python -m compileall app`：通过。
- `python -m pytest tests/unit -q`：`26 passed, 3 warnings`。
- `python -m pytest tests/integration/test_api_teacher.py tests/integration/test_api_learning_space_design.py -q`：测试输出 `18 passed, 3 warnings`，但命令进程在 60 秒超时前没有正常退出。
- `python -m pytest tests -q`：测试输出 `63 passed, 3 warnings`，但命令进程在 120 秒超时前没有正常退出。
- `cmd /c npm run typecheck`：通过。
- `cmd /c npm run build`：通过，产物中主 JS 为 `assets/index-DgGmmuk0.js`，约 `1,849.62 kB`，gzip 后约 `542.63 kB`。

前端构建警告：

- `useGroupStore`、`useChatStore`、`useAiConversationStore` 同时被动态和静态导入，导致动态导入不能拆出独立 chunk。
- 主 chunk 超过 Vite 默认 500 kB 提示线，建议后续拆包。

---

## 5. 当前已知风险 / 待办

### P0：教师端学习分析查询需要优先修

`/teacher/analytics` 仍存在 PostgreSQL grouping 风险，旧文档里记录过：

- `scaffold_heatmap` / `scaffold_usage`
- `ai_intervention_rate`
- `discussion_depth`
- `participation_heatmap`

当前代码里部分查询仍按 JSON 表达式聚合，PostgreSQL 下需要确保 `SELECT` 与 `GROUP BY` 表达式一致，或者先做子查询再聚合。这个问题会拖慢教师端加载，即使接口最终可能返回 `200`。

### P0：pytest 通过后进程不退出

后端 unit 测试能快速正常退出，但 integration/full suite 出现“已打印 passed，却没有及时退出”的情况。

优先检查：

- FastAPI lifespan 中 Redis / AI queue / manager shutdown。
- 测试中的 session scope `event_loop` fixture。
- `asyncio.create_task` 创建的后台任务是否被追踪与取消。
- `jobs.py`、websocket handler、mindmap handler、chat handler 中的裸 `asyncio.create_task`。

### P1：本地 dev proxy 与线上 Nginx 对齐

`frontend/vite.config.ts` 目前代理了不少后端路径，但应补齐新模块路径，避免本地开发时出现线上可用、本地 404/SPA fallback 的错觉。

### P1：前端拆包

当前主 JS chunk 偏大。建议按以下方向拆：

- React/vendor 基础包。
- Markdown / mammoth / document preview。
- React Flow / mindmap。
- Recharts / analytics。
- 教师端和学生端主要页面懒加载。

### P2：工作区清理

当前仓库有大量未跟踪本地文件，包括日志、压缩包、debug 脚本、OpenAPI 输出、npm cache。提交时应只显式加入源码、配置、测试和必要文档，不要 `git add .`。

---

## 6. 推荐下一步优化顺序

1. 修 `/teacher/analytics` 的 PostgreSQL grouping 查询，补一个 PostgreSQL 或 SQLite 兼容的回归测试。
2. 修 pytest integration/full suite 通过后不退出的问题，确保 CI 不会卡死。
3. 补齐 `frontend/vite.config.ts` 本地代理路径，并验证学习空间设计、jobs、notifications、mindmaps 本地可访问。
4. 拆分前端大 chunk，让首屏教师端/学生端加载更轻。
5. 整理部署和临时文件策略：保留 `deploy.ps1`，清理 debug 脚本和日志产物，必要时扩展 `.gitignore`。

---

## 7. 新窗口接手提示

```md
当前主项目在 `D:\Program\ai-project\EDtech\cothink`，Git 分支是 `test`，远程是 `origin https://github.com/ycxhhsh/ai-chat.git`。本轮重点已经不只是“学习空间设计”：还包括作业任务/自评/匿名互评、AI 对话 working memory、Markdown 渲染、设计草图提示弹窗、教师/学生端多处体验改造。学习空间设计已有独立 REST、模型、迁移、教师端/学生端 UI 和报告链路。作业互评新增 `assignment_tasks`、`assignment_task_targets`、`assignment_self_reviews`、`assignment_peer_reviews` 等表。当前验证结果：后端 compileall 通过，unit 测试 26 passed；integration/full suite 打印 passed 但进程不会及时退出；前端 typecheck 和 build 通过，但主 JS chunk 偏大。下一步优先修 `/teacher/analytics` PostgreSQL grouping 查询和 pytest 退出问题，然后补齐本地 Vite proxy 与前端拆包。
```
