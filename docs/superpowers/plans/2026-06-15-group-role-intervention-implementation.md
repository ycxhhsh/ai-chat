# Group Role Intervention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first teaching-intervention version of collaboration roles: automatic balanced assignment, teacher override, and student objections.

**Architecture:** Store the current collaboration role on `group_members` and store role objections in a small new table. Add a focused role service so the assignment rule is tested independently and reused by student and teacher APIs. Surface role state in the existing student group discussion and teacher group manager instead of adding a new module.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, pytest/httpx, React, TypeScript, Zustand-facing API helpers.

---

### Task 1: Backend Role Service and Persistence

**Files:**
- Create: `backend/app/services/group_roles.py`
- Modify: `backend/app/models/group.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/add_group_collaboration_roles.py`
- Test: `backend/tests/unit/test_group_roles.py`

- [ ] **Step 1: Write failing unit tests**

```python
from app.services.group_roles import COLLABORATION_ROLES, choose_balanced_role


def test_choose_balanced_role_prefers_unused_roles():
    role = choose_balanced_role(["推进者", "提问者"])
    assert role in {"解释者", "质疑者", "总结者"}


def test_choose_balanced_role_balances_repeated_roles():
    role = choose_balanced_role(["推进者", "提问者", "解释者", "质疑者", "总结者", "推进者"])
    assert role in {"提问者", "解释者", "质疑者", "总结者"}


def test_collaboration_roles_have_student_prompt_text():
    assert set(COLLABORATION_ROLES) == {"推进者", "提问者", "解释者", "质疑者", "总结者"}
    assert all(COLLABORATION_ROLES[name]["prompt"] for name in COLLABORATION_ROLES)
```

- [ ] **Step 2: Run red test**

Run: `python -m pytest tests/unit/test_group_roles.py -q` from `backend`
Expected: fail because `app.services.group_roles` does not exist.

- [ ] **Step 3: Implement role service and model fields**

Add `COLLABORATION_ROLES`, `choose_balanced_role(existing_roles)`, and `assign_role_to_member(member, existing_roles, assigned_by)`. Add `collaboration_role`, `role_assigned_by`, and `role_assigned_at` to `GroupMember`. Add `GroupRoleObjection` with status fields.

- [ ] **Step 4: Run green unit test**

Run: `python -m pytest tests/unit/test_group_roles.py -q` from `backend`
Expected: all tests pass.

### Task 2: Student Role and Objection APIs

**Files:**
- Modify: `backend/app/routers/groups.py`
- Test: `backend/tests/integration/test_group_roles_api.py`

- [ ] **Step 1: Write failing API tests**

```python
async def test_group_creation_assigns_role_and_student_can_read_it(async_client):
    # register student, create group, GET /groups/{group_id}/role
    # assert role, description, prompt, assigned_by are returned


async def test_join_group_balances_new_member_role(async_client):
    # owner creates group, second student joins
    # assert the second role differs from the first when roles remain unused


async def test_student_can_submit_one_pending_role_objection(async_client):
    # create group, POST /groups/{group_id}/role-objections
    # assert status pending, duplicate pending objection returns 409
```

- [ ] **Step 2: Run red API test**

Run: `python -m pytest tests/integration/test_group_roles_api.py -q` from `backend`
Expected: fail because the endpoints do not exist.

- [ ] **Step 3: Implement minimal APIs**

Add `GET /groups/{group_id}/role` and `POST /groups/{group_id}/role-objections`. Ensure create/join group assigns missing roles through the service.

- [ ] **Step 4: Run green API test**

Run: `python -m pytest tests/integration/test_group_roles_api.py -q` from `backend`
Expected: all tests pass.

### Task 3: Teacher Role Management APIs

**Files:**
- Modify: `backend/app/routers/teacher/routes.py`
- Test: `backend/tests/integration/test_group_roles_api.py`

- [ ] **Step 1: Write failing teacher API tests**

```python
async def test_teacher_group_list_includes_collaboration_roles(async_client):
    # create group as student, list /teacher/groups
    # assert members include collaboration_role, role_assigned_by, pending_role_objection


async def test_teacher_can_update_member_collaboration_role(async_client):
    # PATCH /teacher/groups/{group_id}/members/{user_id}/collaboration-role
    # assert role changed and assigned_by is teacher


async def test_teacher_can_resolve_role_objection(async_client):
    # student submits objection, teacher resolves with a replacement role
    # assert objection status resolved and member role updated
```

- [ ] **Step 2: Run red tests**

Run: `python -m pytest tests/integration/test_group_roles_api.py -q` from `backend`
Expected: teacher assertions fail until endpoints and response fields are implemented.

- [ ] **Step 3: Implement teacher APIs**

Extend `/teacher/groups`, add role patch endpoint, objection list endpoint, resolve endpoint, and group rebalance endpoint.

- [ ] **Step 4: Run green tests**

Run: `python -m pytest tests/integration/test_group_roles_api.py -q` from `backend`
Expected: all tests pass.

### Task 4: Frontend Role UI

**Files:**
- Modify: `frontend/src/api/index.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/StudentView/StudentView.tsx`
- Modify: `frontend/src/components/TeacherView/GroupManager.tsx`

- [ ] **Step 1: Typecheck red after adding API usage**

Run: `cmd /c npm run typecheck` from `frontend`
Expected: fail until new API helpers and types exist.

- [ ] **Step 2: Implement API helpers and UI**

Add typed helpers for student role read/objection and teacher role actions. Show role prompt in student group discussion. Add collaboration-role select and objection indicators in teacher group manager.

- [ ] **Step 3: Run frontend verification**

Run: `cmd /c npm run typecheck` from `frontend`
Expected: pass.

### Task 5: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Backend targeted tests**

Run: `python -m pytest tests/unit/test_group_roles.py tests/integration/test_group_roles_api.py -q` from `backend`
Expected: all tests pass.

- [ ] **Step 2: Frontend build-level check**

Run: `cmd /c npm run build` from `frontend`
Expected: build exits 0.

- [ ] **Step 3: Review diff**

Run: `git status --short` and `git diff --stat`
Expected: changed files are limited to the group-role feature plus the implementation plan.
