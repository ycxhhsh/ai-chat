# Durable AI Reply Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every completed AI reply before best-effort real-time delivery, recover Redis listeners automatically, and synchronize any reply missed during a reconnect gap.

**Architecture:** The AI worker writes the canonical reply to PostgreSQL using the task ID as the stable message ID, then publishes the persisted message through Redis Pub/Sub. FastAPI forwards persisted messages without inserting them again, retains a legacy fallback for rolling deployment, supervises the Redis subscription, and requests an HTTP conversation refresh after recovery. The student client treats the database-backed messages endpoint as the source of truth for that refresh.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy async, redis-py asyncio, pytest/pytest-asyncio, React 19, TypeScript, Zustand, Vitest.

---

## File structure

- Create `backend/app/services/ai_reply_delivery.py`: canonical AI message construction and persistence.
- Create `backend/tests/unit/test_ai_reply_delivery.py`: service and worker ordering regression tests.
- Modify `backend/app/infra/ai_worker.py`: persist before publishing completion.
- Modify `backend/app/infra/redis_client.py`: explicitly disable Pub/Sub socket read timeout.
- Modify `backend/app/websockets/manager.py`: forward persisted replies, support legacy events, supervise/recover subscriptions, request client sync.
- Create `backend/tests/unit/test_websocket_reply_delivery.py`: persisted/legacy event and listener recovery tests.
- Modify `frontend/src/hooks/useWebSocket.ts`: dispatch a browser recovery signal for `AI_SYNC_REQUIRED`.
- Modify `frontend/src/components/StudentView/StudentView.tsx`: reload the active AI conversation on the recovery signal.
- Create `frontend/src/components/StudentView/aiConversationSync.ts`: small reusable database-refresh helper.
- Create `frontend/src/components/StudentView/aiConversationSync.test.ts`: refresh normalization and replacement test.

### Task 1: Canonical durable reply persistence

**Files:**
- Create: `backend/app/services/ai_reply_delivery.py`
- Create: `backend/tests/unit/test_ai_reply_delivery.py`

- [ ] **Step 1: Write the failing message-construction test**

```python
from app.services.ai_reply_delivery import build_ai_message


def test_build_ai_message_uses_task_id_as_stable_message_id():
    message = build_ai_message(
        message_id="task-123",
        session_id="student-1",
        content="durable reply",
        llm_provider="deepseek",
        user_info={"user_id": "student-1"},
        is_private=True,
        conversation_id="conv-1",
    )

    assert message["message_id"] == "task-123"
    assert message["recipient_id"] == "student-1"
    assert message["conversation_id"] == "conv-1"
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `python -m pytest tests/unit/test_ai_reply_delivery.py -v`

Expected: collection fails because `app.services.ai_reply_delivery` does not exist.

- [ ] **Step 3: Implement the minimal service**

```python
def build_ai_message(..., message_id: str) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "message_id": message_id,
        "session_id": session_id,
        "sender": {"id": "ai", "name": "AI 助教", "role": "ai"},
        "content": content,
        "timing": {"absolute_time": now.isoformat(), "relative_minute": 0},
        "metadata_info": {"llm_provider": llm_provider},
        "created_at": now.isoformat(),
        "recipient_id": user_info.get("user_id") if is_private else None,
        "conversation_id": conversation_id,
    }


async def persist_ai_message(message: dict) -> None:
    async with AsyncSessionLocal() as db:
        db.add(Message(...))
        await db.commit()
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `python -m pytest tests/unit/test_ai_reply_delivery.py -v`

Expected: message-construction test passes.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add backend/app/services/ai_reply_delivery.py backend/tests/unit/test_ai_reply_delivery.py
git commit -m "feat: add durable AI reply persistence"
```

### Task 2: Persist in the worker before completion publication

**Files:**
- Modify: `backend/app/infra/ai_worker.py:38-192`
- Modify: `backend/tests/unit/test_ai_reply_delivery.py`

- [ ] **Step 1: Write the failing worker-ordering test**

Use a fake streaming client and fake Redis publisher. Record `"persist"` in the patched `persist_ai_message`, record each published event name in the fake Redis client, execute `execute_ai_task`, then assert:

```python
assert actions.index("persist") < actions.index("publish:AI_REPLY_DONE")
assert done_payload["data"]["message"]["message_id"] == "task-123"
assert done_payload["data"]["persisted"] is True
```

- [ ] **Step 2: Run the worker test and confirm RED**

Run: `python -m pytest tests/unit/test_ai_reply_delivery.py::test_worker_persists_before_publishing_done -v`

Expected: failure because the current worker publishes `AI_REPLY_DONE` without persisting a canonical message.

- [ ] **Step 3: Implement persistence-before-publication**

Immediately after streaming completes:

```python
ai_message = build_ai_message(
    message_id=task_id,
    session_id=session_id,
    content=full_content,
    llm_provider=llm_provider,
    user_info=user_info,
    is_private=is_private,
    conversation_id=conversation_id,
)
await persist_ai_message(ai_message)
await publish_event("AI_REPLY_DONE", {
    "task_id": task_id,
    "session_id": session_id,
    "message": ai_message,
    "persisted": True,
    "user_message": task.get("user_message", ""),
    "llm_provider": llm_provider,
    "user_info": user_info,
    "is_private": is_private,
    "conversation_id": conversation_id,
})
```

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `python -m pytest tests/unit/test_ai_reply_delivery.py -v`

Expected: all tests pass and the recorded order is persistence before publication.

- [ ] **Step 5: Commit Task 2 files**

```bash
git add backend/app/infra/ai_worker.py backend/tests/unit/test_ai_reply_delivery.py
git commit -m "fix: persist AI replies before realtime delivery"
```

### Task 3: Make WebSocket delivery idempotent and self-healing

**Files:**
- Modify: `backend/app/infra/redis_client.py:78-101`
- Modify: `backend/app/websockets/manager.py:212-379`
- Create: `backend/tests/unit/test_websocket_reply_delivery.py`

- [ ] **Step 1: Write failing tests for the three recovery behaviors**

Tests must assert:

```python
assert redis_from_url.call_args.kwargs["socket_timeout"] is None
persist_ai_message.assert_not_awaited()  # persisted event
persist_ai_message.assert_awaited_once()  # legacy event
assert ("AI_SYNC_REQUIRED", {"reason": "redis_listener_recovered"}) in broadcasts
```

The listener test uses a first Pub/Sub object whose `listen()` raises `redis.exceptions.TimeoutError`, a second subscribed object, and cancellation after observing `AI_SYNC_REQUIRED`.

- [ ] **Step 2: Run the tests and confirm RED**

Run: `python -m pytest tests/unit/test_websocket_reply_delivery.py -v`

Expected: failures because `socket_timeout=None`, persisted-event bypass, and reconnect synchronization are absent.

- [ ] **Step 3: Explicitly disable read timeout**

Update the dedicated subscription client:

```python
dedicated = aioredis.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_timeout=None,
)
```

- [ ] **Step 4: Consume the canonical persisted message**

In `_handle_ai_reply_done`, use `data["message"]` when `persisted is True`. For a legacy event, call `build_ai_message` and `await persist_ai_message` exactly once before forwarding. Remove the now-unused manager `_save_ai_message` method.

- [ ] **Step 5: Supervise the Redis listener**

Keep the listener task alive while local connections exist. On an unexpected exception, close the failed subscription, wait one second, resubscribe, then broadcast locally:

```python
await self._broadcast_local(
    session_id,
    json.dumps({
        "event": "AI_SYNC_REQUIRED",
        "data": {"reason": "redis_listener_recovered"},
    }),
)
```

Cancellation and the final local disconnect stop the loop immediately.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `python -m pytest tests/unit/test_websocket_reply_delivery.py -v`

Expected: all tests pass without pending-task warnings.

- [ ] **Step 7: Commit Task 3 files**

```bash
git add backend/app/infra/redis_client.py backend/app/websockets/manager.py backend/tests/unit/test_websocket_reply_delivery.py
git commit -m "fix: recover AI reply websocket delivery"
```

### Task 4: Synchronize missed replies in the student client

**Files:**
- Create: `frontend/src/components/StudentView/aiConversationSync.ts`
- Create: `frontend/src/components/StudentView/aiConversationSync.test.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts:120-470`
- Modify: `frontend/src/components/StudentView/StudentView.tsx:175-200`

- [ ] **Step 1: Write the failing synchronization helper test**

```typescript
it('reloads persisted messages and replaces the current AI conversation', async () => {
    const getMessages = vi.fn().mockResolvedValue([{ message_id: 'ai-1' }]);
    const setMessages = vi.fn();

    await syncAiConversation('conv-1', getMessages, setMessages);

    expect(getMessages).toHaveBeenCalledWith('conv-1');
    expect(setMessages).toHaveBeenCalledWith([
        expect.objectContaining({ message_id: 'ai-1', status: 'sent' }),
    ]);
});
```

- [ ] **Step 2: Run the frontend test and confirm RED**

Run: `npm test -- src/components/StudentView/aiConversationSync.test.ts`

Expected: failure because `syncAiConversation` does not exist.

- [ ] **Step 3: Implement the focused helper**

```typescript
export async function syncAiConversation(
    conversationId: string,
    getMessages: (id: string) => Promise<ChatMessage[]>,
    setMessages: (messages: ChatMessage[]) => void,
) {
    const messages = await getMessages(conversationId);
    setMessages(messages.map((message) => ({ ...message, status: 'sent' as const })));
}
```

- [ ] **Step 4: Wire the recovery signal**

Handle `AI_SYNC_REQUIRED` in `useWebSocket.ts` by dispatching `ai-conversation-sync-required`. In `StudentView.tsx`, reuse `syncAiConversation` for normal conversation loading and add an event listener that reloads `currentConversationId` only while the AI channel is active.

- [ ] **Step 5: Run frontend tests and build**

Run: `npm test -- src/components/StudentView/aiConversationSync.test.ts src/hooks/useWebSocket.test.ts`

Expected: all focused tests pass.

Run: `npm run build`

Expected: TypeScript and Vite build finish with exit code 0.

- [ ] **Step 6: Commit Task 4 files**

```bash
git add frontend/src/components/StudentView/aiConversationSync.ts frontend/src/components/StudentView/aiConversationSync.test.ts frontend/src/hooks/useWebSocket.ts frontend/src/components/StudentView/StudentView.tsx
git commit -m "fix: resync AI replies after delivery recovery"
```

### Task 5: Full verification and production deployment

**Files:**
- Modify: `docs/superpowers/plans/2026-06-24-durable-ai-reply-delivery.md` only to mark completed checkboxes.

- [ ] **Step 1: Run backend regression tests**

Run: `python -m pytest tests/unit/test_ai_reply_delivery.py tests/unit/test_websocket_reply_delivery.py tests/integration/test_ws_events.py -v`

Expected: all selected tests pass.

- [ ] **Step 2: Run the full backend suite**

Run: `python -m pytest tests -q`

Expected: zero failures. If a pre-existing environment failure occurs, record the exact failing test and separately prove all changed-path tests pass.

- [ ] **Step 3: Run frontend verification**

Run: `npm test`

Expected: all Vitest suites pass.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Confirm surgical diff**

Run: `git diff --check HEAD~4..HEAD` and `git status --short`.

Expected: no whitespace errors; only planned files are in the implementation commits, while the user's pre-existing modifications remain untouched.

- [ ] **Step 5: Deploy using the repository deployment workflow**

Run the existing `deploy.ps1` workflow after reviewing its changed-file packaging behavior. Rebuild/restart `backend` and `ai-worker`; deploy the frontend bundle. No Alembic migration is expected because the schema is unchanged.

- [ ] **Step 6: Verify production health and durable behavior**

Check container status and `/healthz`. Then use a fresh test student session, wait longer than the former five-second window, send one AI message, and verify:

1. worker log reports task completion;
2. the AI row exists in `messages` with the same task/message ID;
3. the student UI receives or automatically synchronizes the reply;
4. no `Redis listener error ... Timeout reading` appears for the test session.

- [ ] **Step 7: Commit the completed plan checklist**

```bash
git add docs/superpowers/plans/2026-06-24-durable-ai-reply-delivery.md
git commit -m "docs: record durable AI reply rollout"
```
