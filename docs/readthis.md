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

## 5. 本轮稳定性与性能优化（2026-05-21）

已完成：

- `/teacher/analytics` 已迁到 `backend/app/services/analytics_service.py` 的 `build_teacher_analytics`，按 PostgreSQL grouping 规则显式聚合，并保留原响应字段。
- `backend/app/db/json_utils.py` 新增跨 PostgreSQL / SQLite 的 `jq()` 与 `jq_truthy()`，避免测试环境和线上 JSONB 查询行为分叉。
- `chat`、`mindmap`、`jobs`、`ConnectionManager` 内的后台任务已接入可追踪任务集合；FastAPI shutdown 会取消并等待后台任务，WebSocket heartbeat 也会在断连时等待退出。
- pytest integration/full suite “已 passed 但进程不退出”已修复：测试库改为文件型 SQLite + `NullPool`，避免 `aiosqlite` worker thread 残留。
- 前端已做路由级懒加载：登录页、学生端、教师端按需加载；教师端重 tab 和学生端重面板也按需加载。
- `frontend/vite.config.ts` 已补齐本地 proxy：`/learning-space-design`、`/jobs`、`/notifications`、`/mindmaps`、`/yjs` 等路径与线上 Nginx 对齐。
- Vite `manualChunks` 已按 React、Markdown、React Flow/Yjs、Recharts、文档预览、zip、图标等拆分，不通过隐藏 warning 解决大包问题。

本轮验证结果：

```text
python -m compileall app                                                     PASS
python -m pytest tests/unit -q                                               26 passed
python -m pytest tests/integration/test_api_teacher.py tests/integration/test_api_learning_space_design.py -q
                                                                              18 passed
python -m pytest tests -q                                                     63 passed
cmd /c npm run typecheck                                                     PASS
cmd /c npm run build                                                         PASS
```

前端 build 关键产物：入口 `index` JS 约 56.6 kB，`react-vendor` 约 230.7 kB，`flow` 约 178.7 kB，`charts` 约 385.6 kB，`doc-preview` 约 404.5 kB；当前无 circular chunk warning，无 500 kB 以上 chunk warning。

服务器部署状态：

- GitHub `origin/test` 已更新到 `8e4ebf2`。
- 后端按低影响流程发布：先标记 rollback 镜像、解包 backend、构建新镜像，最后重启 `backend ai-worker grading-worker`。
- 前端按无白屏流程发布：先上传并解压新 `assets`，保留旧 hash 资源，最后备份并替换 `index.html`。
- 线上验收：`GET /healthz` 返回 `200`，首页返回 `200`，`/assets/index-DhLa-_fT.js` 返回 `200`，`/learning-space-design/meta` 返回 `200`。
- 容器状态：`backend`、`ai-worker`、`grading-worker`、`postgres`、`redis`、`y-websocket` 均为 running；最近后端/worker 日志无启动异常。
- 本轮补丁还修复了 `grading-worker` 空队列时把 Redis `BRPOP` idle timeout 误打成 ERROR 的问题，改为独立阻塞 Redis 连接。

---

## 6. 当前已知风险 / 待办

### P1：线上 analytics 性能观察

`/teacher/analytics` 已修 grouping 风险并有回归测试；本轮继续补了百分比数值护栏：`ai_ratio`、`scaffold_dependency.rate` 会限制在 `0-100`，前端 KPI 和图表也会对异常百分比做兜底。线上 PostgreSQL 数据量继续增长后，下一步应考虑按 session/day/student 做轻量统计表或缓存。

### P1：低影响部署脚本

`deploy.ps1` 已改为低影响发布流程：

- 前端：本地 build -> 上传并解压新 `assets` -> 备份旧 `index.html` -> 最后替换新 `index.html`，不删除旧 hash 资源。
- 后端：上传 backend 包 -> tag rollback 镜像 -> 解包 -> build backend 镜像 -> Alembic current/upgrade -> 重启 `backend ai-worker grading-worker`。
- 参数：`-FrontendOnly`、`-BackendOnly`、`-SkipBuild`、`-NoMigrate`、`-SmokeOnly`。
- smoke check：首页、新入口 JS、`/healthz`、`/learning-space-design/meta`、容器状态、最近日志。

常用命令：

```powershell
.\deploy.ps1 -SmokeOnly
.\deploy.ps1 -FrontendOnly
.\deploy.ps1 -BackendOnly -NoMigrate
.\deploy.ps1
```

### P1：后台任务治理继续收束

WebSocket、jobs、manager 的后台任务已可追踪。后续可以继续把 AI worker 内部并发、重试、超时和 metrics 做成统一任务执行器，方便排查线上慢任务。

### P2：工作区清理

当前仓库仍有大量未跟踪本地文件，包括 debug 脚本、临时部署脚本、查询文件、日志抓取脚本等。提交时继续只显式加入源码、配置、测试和必要文档，不要 `git add .`。

---

## 7. 推荐下一步优化顺序

1. 为 `/teacher/analytics` 增加接口耗时日志或 metrics，按真实线上数据判断是否需要缓存/预聚合。
2. 将部署脚本的 smoke check 接入日常发布 checklist，持续观察静态资源 404 和 worker 日志。
3. 给后台任务执行器补统一超时、任务名、失败计数和 shutdown 超时保护。
4. 继续拆学生端聊天链路：Markdown 渲染、DeepSearch、文档预览按会话行为进一步延后加载。
5. 清理未跟踪临时文件，只保留必要部署脚本和文档入口。

---

## 8. 新窗口接手提示

```md
当前主项目在 `D:\Program\ai-project\EDtech\cothink`，Git 分支是 `test`，远程是 `origin https://github.com/ycxhhsh/ai-chat.git`。学习空间设计、作业任务/自评/匿名互评、AI 对话 working memory、Markdown 渲染、设计草图提示弹窗、教师/学生端体验改造已经进入当前功能集。本轮稳定性优化已完成 `/teacher/analytics` PostgreSQL grouping 修复、JSON 查询跨数据库兼容、后台任务可追踪 shutdown、pytest passed 后不退出修复、前端路由/重面板懒加载、Vite proxy 与 manualChunks 优化、AI 介入率/KPI 百分比护栏，以及低影响 `deploy.ps1`。当前验证目标：compileall、unit、指定 integration、全量 tests、frontend typecheck/build、`deploy.ps1 -SmokeOnly`。下一步重点是观察线上 analytics 耗时，并把 smoke check 纳入固定发布流程。
```
