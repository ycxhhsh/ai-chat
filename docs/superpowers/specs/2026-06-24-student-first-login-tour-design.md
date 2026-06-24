# Student First-Login Tour Design

**Date:** 2026-06-24

**Status:** Draft for review

## Goal

Add a student-only onboarding tutorial that automatically appears the first time a newly registered student enters the student workspace, then remains available later from a manual entry point. The tutorial should explain the main student features through a guided, step-by-step tour of the real interface rather than through a separate help page.

## Why This Exists

Current student entry behavior routes authenticated students directly into [`StudentView.tsx`](D:/Program/ai-project/EDtech/cothink/frontend/src/components/StudentView/StudentView.tsx), which still defaults to the `ai` channel. The product already contains multiple learning surfaces, but they are exposed as parallel channels rather than as a guided first-run path. New students can enter the product and immediately face a dense UI without a clear understanding of what each entry point is for.

This tutorial is intended to reduce that initial orientation cost without introducing backend complexity in the first version.

## Scope

### In Scope

- Student-side only
- Frontend-only persistence
- Automatic display for first-time student entry
- Manual replay from a visible student-side entry point
- Step-by-step tour with:
  - dimmed backdrop
  - highlighted real target element
  - explanation card near the target
  - `Next`, `Back`, `Skip`, and `Finish`
- Automatic channel switching when the next step belongs to another student channel
- Mobile-safe behavior for sidebar targets
- Graceful fallback when a target cannot be located

### Out of Scope

- Teacher-side tutorial
- Backend persistence or analytics
- Personalized tutorial branching
- Deep walkthrough of every control inside every panel
- Feature discovery for hidden or teacher-controlled scaffolds
- Playwright/E2E automation in this first pass

## Product Decision

This feature will use the **pure frontend approach**.

The tutorial state is stored locally in the browser and keyed by user id plus a tutorial version string. This keeps the first implementation small and avoids schema changes while still supporting:

- first-run auto-open
- later replay
- future forced re-show through a version bump

Tradeoff accepted:

- The tutorial completion state will not sync across browsers or devices.

## User Experience

### Entry Conditions

The tutorial auto-starts only when all of the following are true:

- the authenticated user is a student
- the current route is the student workspace
- no local tutorial record exists for the current tutorial version and user id

### Replay Entry

After the first run, the user can reopen the tutorial from the student-side avatar menu. The menu entry label should be explicit, for example:

- `功能导览`

### Tour Behavior

Each step highlights a real interface target and shows a short explanation card next to it. The card explains:

- what this feature is
- when the student should use it
- what action the student can expect there

The tutorial is not a fake chatbot. It is a guided overlay with conversational copy.

### Step Flow

Recommended first version:

1. `AI 导师`
2. `小组讨论`
3. `学习空间设计`
4. `作业提交`
5. `资料 / DeepSearch`

These five steps are enough to cover the core student journey without overwhelming the user.

## Copy Direction

Tutorial copy should be:

- short
- direct
- beginner-friendly
- action-oriented

It should avoid:

- long paragraphs
- abstract product marketing language
- explaining implementation details

Example style:

> 这里是 AI 导师。你可以在这里单独向 AI 提问、追问、让它帮你梳理想法。适合先把自己的问题说清楚，再继续深入。

## Architecture

The feature should be implemented as three focused frontend units instead of adding more ad hoc state into the already-large student view.

### 1. Tutorial State Store

Create a small student-tour store responsible for:

- whether the tour is open
- current step id or index
- whether the current run was auto-started or manually opened
- persisted local completion state

Suggested responsibilities:

- `startAutoTour()`
- `startManualTour()`
- `nextStep()`
- `prevStep()`
- `skipTour()`
- `finishTour()`
- `resumeIfNeeded()`

Suggested persisted payload:

```ts
interface StudentTourProgress {
  version: string;
  hasSeen: boolean;
  completedAt?: string;
  dismissedAt?: string;
  lastStepId?: string;
}
```

Suggested storage key:

```ts
const storageKey = `cothink-student-tour:v1:${userId}`;
```

### 2. Tutorial Step Definition File

Keep tour step definitions in one dedicated file. Do not bury step copy and targeting logic inside `StudentView.tsx`.

Each step definition should include:

```ts
interface StudentTourStep {
  id: string;
  title: string;
  body: string;
  targetKey: string;
  placement: 'top' | 'right' | 'bottom' | 'left';
  beforeEnter?: () => Promise<void> | void;
}
```

`beforeEnter` is required because some steps need the UI to switch channels before the target exists in the DOM.

### 3. Tutorial Overlay Component

Create a dedicated overlay component responsible for:

- backdrop
- target highlighting
- card positioning
- button row
- fallback card when target lookup fails

This component should receive:

- current step
- target element
- callbacks for navigation

It should not directly fetch business data.

## Integration Points

### Student View

[`StudentView.tsx`](D:/Program/ai-project/EDtech/cothink/frontend/src/components/StudentView/StudentView.tsx) should host the tutorial because it already controls:

- `activeChannel`
- mobile sidebar open state
- top-toolbar visibility
- student-only layout context

Responsibilities added to `StudentView` should stay narrow:

- expose tour targets
- wire manual open from avatar menu
- auto-start the tour on eligible first entry
- execute per-step channel switching

### Sidebar and Toolbar Targets

Targets should be exposed through stable selectors such as:

- `data-tour-target="sidebar-ai"`
- `data-tour-target="sidebar-group"`
- `data-tour-target="sidebar-learning-space"`
- `data-tour-target="sidebar-assignment"`
- `data-tour-target="toolbar-deepsearch"`

Using dedicated `data-tour-target` attributes is preferred over fragile CSS selectors or text matching.

## Step Definitions

### Step 1: AI 导师

**Target**
- AI channel entry in the sidebar

**Purpose**
- explain one-to-one AI conversation
- mention asking questions, follow-up prompts, deep thinking, and search

**beforeEnter**
- switch active channel to `ai`
- ensure sidebar is visible on mobile

### Step 2: 小组讨论

**Target**
- group channel entry in the sidebar

**Purpose**
- explain team discussion
- mention group collaboration and `@AI`

**beforeEnter**
- switch active channel to `group`
- ensure sidebar is visible on mobile

### Step 3: 学习空间设计

**Target**
- learning-space channel entry in the sidebar

**Purpose**
- explain that this is the most structured learning workflow
- mention step-by-step process rather than free-form chat

**beforeEnter**
- switch active channel to `learning_space`
- ensure sidebar is visible on mobile

### Step 4: 作业提交

**Target**
- assignment channel entry in the sidebar

**Purpose**
- explain submission, self-review, peer review, and feedback

**beforeEnter**
- switch active channel to `assignment`
- ensure sidebar is visible on mobile

### Step 5: 资料 / DeepSearch

**Target**
- either the materials entry in the sidebar or the top DeepSearch button

**Purpose**
- explain where to read materials
- explain that DeepSearch is for heavier search and structured information gathering

**beforeEnter**
- if targeting materials, switch active channel to `materials`
- if targeting DeepSearch, keep toolbar visible

## Navigation Rules

- `Next` advances to the next configured step.
- `Back` returns to the previous step.
- `Skip` closes the tutorial and writes `dismissedAt`.
- `Finish` closes the tutorial and writes `completedAt`.
- Manual replay always starts from step 1.
- Auto-start resume may continue from `lastStepId` after refresh in the same browser.

## Failure Handling

### Missing Target

If a target is not found:

1. run `beforeEnter`
2. wait briefly for layout to update
3. try target resolution again
4. if still missing, show a centered fallback card

Fallback card requirements:

- explain that the current step could not be located
- allow `Next`
- allow `Exit`

The tutorial must never dead-end on a missing element.

### Resize and Reflow

On window resize or mobile orientation change:

- recompute highlight bounds
- recompute card placement

### Mobile Behavior

If the target is inside the sidebar on mobile:

- open the sidebar first
- wait for it to render
- then position the highlight

### Refresh During Tutorial

If the page reloads mid-tour:

- auto-start runs may resume from `lastStepId`
- manual replay may either resume or restart

For version 1, the simpler rule is acceptable:

- auto-start resumes
- manual replay restarts from step 1

## Visual Rules

The overlay should feel intentional but restrained.

- darkened backdrop
- clear spotlight around target
- compact white card
- one strong primary button for `Next`
- subtle secondary actions for `Back` and `Skip`

Do not over-animate. This is orientation, not decoration.

## Files To Add or Modify

### Likely New Files

- `frontend/src/store/useStudentTourStore.ts`
- `frontend/src/components/StudentTour/StudentTourOverlay.tsx`
- `frontend/src/components/StudentTour/studentTourSteps.ts`

### Likely Modified Files

- `frontend/src/components/StudentView/StudentView.tsx`
- `frontend/src/components/StudentView/Sidebar.tsx`

If the avatar menu currently lives elsewhere, that owning component should also be updated, but only if needed to surface the replay entry.

## Testing Strategy

This feature should ship with focused manual acceptance first, not full E2E automation.

Required manual checks:

1. A newly registered student auto-sees step 1 on first entry.
2. Clicking `Next` changes channels and highlights the next intended target.
3. Clicking `Skip` prevents future auto-open for the same browser/user/version.
4. `功能导览` from the avatar menu restarts the tour.
5. Mobile layout can open the sidebar and continue the tour without trapping the user.
6. A missing target falls back gracefully instead of freezing the tutorial.

Optional lightweight test coverage:

- store unit tests for persistence and step transitions
- step-definition validation tests to catch missing target keys or duplicate step ids

## Rollout Notes

This is intentionally a minimal first version.

Do not expand version 1 into:

- teacher onboarding
- analytics instrumentation
- backend-synced completion
- dynamic branching
- generalized product-tour framework

If the tutorial proves useful, the next iteration can choose one of these expansions deliberately instead of prematurely.

## Recommendation

Build version 1 as a small, student-only frontend feature with explicit tour targets, a dedicated overlay, and local persistence keyed by user id and tour version.

This gives the product a real first-run explanation path without blocking on backend work and without turning the feature into a large reusable framework too early.

