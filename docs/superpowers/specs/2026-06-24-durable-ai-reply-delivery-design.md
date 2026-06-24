# Durable AI Reply Delivery Design

## Problem

AI generation currently finishes in the worker, but reply persistence and client delivery both depend on a per-session Redis Pub/Sub listener in the FastAPI process. If that listener times out or disconnects, the worker's `AI_REPLY_DONE` event is lost. The generated reply is neither stored nor shown, even though the model call succeeded.

## Goal

An AI reply must remain recoverable when Redis Pub/Sub, WebSocket delivery, or the student's browser disconnects temporarily. Real-time delivery should recover automatically without duplicating replies.

## Chosen approach

Use the database as the source of truth and Redis Pub/Sub only as a real-time notification channel:

1. The AI worker constructs the final AI message and commits it to `messages` before publishing a completion event.
2. The completion event carries the persisted message, including its stable `message_id`.
3. The FastAPI Redis listener forwards that message to connected clients but does not persist it again.
4. The Redis subscription explicitly disables read timeouts and automatically re-subscribes after unexpected connection failures.
5. After listener recovery, the server asks connected clients to refresh the active AI conversation from the HTTP messages endpoint. This recovers events published during the reconnect gap.
6. Existing completion events without an embedded persisted message remain supported during deployment transition: the FastAPI process builds and saves the reply using the legacy path.

## Data flow

Normal path:

`CHAT_SEND -> queue -> AI worker -> database commit -> AI_REPLY_DONE -> FastAPI listener -> WebSocket CHAT_MESSAGE`

Recovery path:

`listener failure -> worker still commits reply -> listener re-subscribes -> sync-required event -> client reloads conversation from database`

## Components and changes

### Reply persistence service

Create a focused backend service that builds the canonical AI message and persists it. The worker uses it before publishing. The WebSocket manager uses it only for legacy completion events. A stable message ID makes retries and transition handling idempotent.

### AI worker

Persist the complete response before reporting task completion. A database failure is treated as task failure; a Pub/Sub failure after commit cannot destroy the generated reply.

### WebSocket manager

Consume the persisted message from the event, forward it, and run the existing follow-up work. Reconnect the Redis listener while the session still has local WebSocket connections. On successful recovery, emit a sync-required event.

### Student client

On the sync-required event, reload the currently selected AI conversation through the existing `/ai-conversations/{id}/messages` endpoint. Reuse the current message replacement path so persisted messages do not appear twice.

## Error handling

- Database commit fails: publish the existing AI error event when possible; do not claim task completion.
- Pub/Sub publish fails after commit: log the failure; the reply remains available through HTTP synchronization.
- Redis listener fails: close the broken subscription, retry with bounded backoff while the session remains connected, then request client synchronization.
- Duplicate completion event: the stable primary-key message ID prevents duplicate persistence; the client refresh replaces the conversation message list.
- Client is offline: reopening or selecting the conversation loads the persisted reply through the existing HTTP endpoint.

## Testing

Add regression tests that prove:

1. The Redis subscription explicitly uses no socket read timeout.
2. The worker persists the AI message before publishing `AI_REPLY_DONE`.
3. A persisted completion event is forwarded without a second database insert.
4. A legacy completion event still persists exactly once.
5. The listener retries after a read failure and requests synchronization after recovery.
6. The student client reloads the active conversation on the sync-required event.

Run focused backend and frontend tests first, followed by the full backend test suite and frontend build.

## Scope boundaries

- No Redis Stream, outbox table, or task-history subsystem in this change.
- No changes to prompt content, model selection, conversation UI, or unrelated async tasks.
- No replay of the already-lost model outputs; affected students can resend after deployment.

## Success criteria

- A completed AI reply exists in `messages` even if no Redis subscriber is active.
- Redis listener interruption no longer permanently disables replies for a connected session.
- Missed real-time events become visible automatically after listener recovery or client reconnection.
- One AI generation creates exactly one stored AI message.
