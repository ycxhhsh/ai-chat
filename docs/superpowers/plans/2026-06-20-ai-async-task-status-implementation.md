# AI Async Task Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first version of the student-facing AI async task status model.

**Architecture:** Add a focused Zustand `useAsyncTaskStore` and a small task popover component, then map existing AI chat, DeepSearch phase, drawing, and learning-space AI request events into that store. Keep existing WebSocket, chat stream, drawing, and learning-space behavior intact.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Vite, FastAPI/WebSocket event payloads already in place.

---

### Task 1: Async Task Store

**Files:**
- Create: `frontend/src/store/useAsyncTaskStore.ts`
- Test: `frontend/src/store/useAsyncTaskStore.test.ts`

- [x] **Step 1: Write failing store tests**

Create tests for starting a task, updating progress, completing with auto-dismiss metadata, failing with retry state, and filtering visible tasks.

- [x] **Step 2: Run test to verify it fails**

Run: `cmd /c npm run test -- src/store/useAsyncTaskStore.test.ts`

Expected: FAIL because the store file does not exist.

- [x] **Step 3: Implement minimal store**

Add `AsyncTaskType`, `AsyncTaskStatus`, `AsyncTask`, and actions: `startTask`, `updateTask`, `completeTask`, `failTask`, `dismissTask`, `getVisibleTasks`.

- [x] **Step 4: Run test to verify it passes**

Run: `cmd /c npm run test -- src/store/useAsyncTaskStore.test.ts`

Expected: PASS.

### Task 2: Task Popover UI

**Files:**
- Create: `frontend/src/components/AsyncTaskPopover.tsx`
- Modify: `frontend/src/components/StudentView/StudentView.tsx`

- [x] **Step 1: Write minimal component behavior through store tests where possible**

Use store tests for task visibility and dismissal. Keep UI simple enough for typecheck/build to validate.

- [x] **Step 2: Implement popover**

Create a right-top AI task button. It lists up to five running, streaming, and failed tasks. Failed tasks show retry and close buttons. Successful tasks are not shown after completion.

- [x] **Step 3: Mount popover in student toolbar**

Place it beside `NotificationBell`.

- [x] **Step 4: Verify typecheck**

Run: `cmd /c npm run typecheck`

Expected: PASS.

### Task 3: WebSocket AI Chat and Drawing Mapping

**Files:**
- Modify: `frontend/src/components/StudentView/StudentView.tsx`
- Modify: `frontend/src/hooks/useWebSocket.ts`

- [x] **Step 1: Create AI chat task on send**

When AI channel sends a message, create `ai_chat` with retry payload and progress text. If `enable_search` is true, progress text starts as “正在联网检索”.

- [x] **Step 2: Create drawing task on drawing request**

When drawing is requested, create `drawing` task with retry payload.

- [x] **Step 3: Map WebSocket events**

`AI_TYPING true`, `AI_STREAM_CHUNK`, `WEB_SEARCH_RESULT`, `CHAT_MESSAGE`, `AI_REPLY_DONE`, `DRAWING_DONE`, and `ERROR` update the matching task by `task_id` or current active stream task.

- [x] **Step 4: Verify targeted tests and typecheck**

Run: `cmd /c npm run test -- src/store/useAsyncTaskStore.test.ts`

Run: `cmd /c npm run typecheck`

Expected: PASS.

### Task 4: Learning Space AI Mapping

**Files:**
- Modify: `frontend/src/components/StudentView/LearningSpaceDesignPanel.tsx`

- [x] **Step 1: Create task on learning-space AI request**

When sending an AI question, create `learning_space_ai` with the current session, step, content, and provider.

- [x] **Step 2: Complete or fail task**

On request success, complete the task. On failure, fail it and keep the draft question available for retry.

- [x] **Step 3: Add inline status**

Show a small inline status in the learning-space panel while the AI request task is running or failed.

- [x] **Step 4: Verify typecheck**

Run: `cmd /c npm run typecheck`

Expected: PASS.

### Task 5: Full Verification, Git, Push, Deploy

**Files:**
- All touched files.

- [x] **Step 1: Run verification**

Run: `cmd /c npm run test -- src/store/useAsyncTaskStore.test.ts`

Run: `cmd /c npm run typecheck`

Run: `cmd /c npm run build`

Expected: all PASS.

- [x] **Step 2: Review git diff**

Run: `git status --short` and `git diff --stat`.

Expected: only intended files are staged for commit; unrelated untracked directories are not staged.

- [ ] **Step 3: Commit and push**

Stage the implementation, spec, plan, and daily optimization doc. Commit with `feat: add ai async task status model`. Push the current branch.

- [ ] **Step 4: Deploy**

Run `powershell -ExecutionPolicy Bypass -File 'd:\Program\ai-project\EDtech\cothink\deploy.ps1'`.

Expected: deployment smoke checks pass.
