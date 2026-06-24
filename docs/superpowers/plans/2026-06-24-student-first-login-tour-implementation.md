# Student First-Login Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a student-only first-login tour that auto-opens once per user/version, can be replayed from the sidebar user menu, and guides the user through five existing student features with highlighted targets and explanatory cards.

**Architecture:** The implementation adds a small persisted tour store, a separate step-definition module, and a dedicated overlay component, then wires them into the existing student layout through stable `data-tour-target` hooks. The first version stays frontend-only and keeps channel switching logic in `StudentView` rather than introducing a generalized product-tour framework.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, existing student layout components

---

### Task 1: Tour State and Step Definitions

**Files:**
- Create: `frontend/src/store/useStudentTourStore.ts`
- Create: `frontend/src/store/useStudentTourStore.test.ts`
- Create: `frontend/src/components/StudentTour/studentTourSteps.ts`
- Create: `frontend/src/components/StudentTour/studentTourSteps.test.ts`

- [ ] **Step 1: Write the failing store tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudentTourStore } from './useStudentTourStore';

describe('useStudentTourStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useStudentTourStore.getState().resetForTest();
  });

  it('auto-starts only when no persisted progress exists for the same user/version', () => {
    const started = useStudentTourStore.getState().startAutoTour('user-1');
    expect(started).toBe(true);

    useStudentTourStore.getState().skipTour();
    const restarted = useStudentTourStore.getState().startAutoTour('user-1');
    expect(restarted).toBe(false);
  });

  it('starts manual replay from the first step even after dismissal', () => {
    useStudentTourStore.getState().startAutoTour('user-1');
    useStudentTourStore.getState().nextStep();
    useStudentTourStore.getState().skipTour();

    useStudentTourStore.getState().startManualTour('user-1');
    expect(useStudentTourStore.getState().currentStepIndex).toBe(0);
    expect(useStudentTourStore.getState().isOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run store tests to verify RED**

Run: `npm test -- frontend/src/store/useStudentTourStore.test.ts`
Expected: FAIL because `useStudentTourStore` does not exist yet

- [ ] **Step 3: Write the failing step-definition tests**

```ts
import { describe, expect, it } from 'vitest';
import { studentTourSteps } from './studentTourSteps';

describe('studentTourSteps', () => {
  it('defines the five expected student tour steps in order', () => {
    expect(studentTourSteps.map((step) => step.id)).toEqual([
      'ai',
      'group',
      'learning-space',
      'assignment',
      'materials',
    ]);
  });

  it('uses unique target keys for every step', () => {
    const keys = studentTourSteps.map((step) => step.targetKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 4: Run step-definition tests to verify RED**

Run: `npm test -- frontend/src/components/StudentTour/studentTourSteps.test.ts`
Expected: FAIL because `studentTourSteps` does not exist yet

- [ ] **Step 5: Write the minimal store and steps implementation**

```ts
// useStudentTourStore.ts
import { create } from 'zustand';

const TOUR_VERSION = 'v1';

interface StudentTourProgress {
  version: string;
  hasSeen: boolean;
  completedAt?: string;
  dismissedAt?: string;
  lastStepId?: string;
}

interface StudentTourState {
  userId: string | null;
  isOpen: boolean;
  currentStepIndex: number;
  autoStarted: boolean;
  startAutoTour: (userId: string) => boolean;
  startManualTour: (userId: string) => void;
  nextStep: (stepIds: string[]) => void;
  prevStep: () => void;
  finishTour: (stepIds: string[]) => void;
  skipTour: () => void;
  resetForTest: () => void;
}
```

```ts
// studentTourSteps.ts
export const studentTourSteps = [
  { id: 'ai', targetKey: 'sidebar-ai', title: 'AI 导师', body: '...', placement: 'right' },
  { id: 'group', targetKey: 'sidebar-group', title: '小组讨论', body: '...', placement: 'right' },
  { id: 'learning-space', targetKey: 'sidebar-learning-space', title: '学习空间设计', body: '...', placement: 'right' },
  { id: 'assignment', targetKey: 'sidebar-assignment', title: '作业提交', body: '...', placement: 'right' },
  { id: 'materials', targetKey: 'sidebar-materials', title: '资料与检索', body: '...', placement: 'right' },
] as const;
```

- [ ] **Step 6: Run tests to verify GREEN**

Run: `npm test -- frontend/src/store/useStudentTourStore.test.ts frontend/src/components/StudentTour/studentTourSteps.test.ts`
Expected: PASS

### Task 2: Overlay Component and Target Resolution

**Files:**
- Create: `frontend/src/components/StudentTour/StudentTourOverlay.tsx`
- Create: `frontend/src/components/StudentTour/StudentTourOverlay.test.tsx`

- [ ] **Step 1: Write the failing overlay tests**

```tsx
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentTourOverlay } from './StudentTourOverlay';

it('renders the current step card and action buttons', () => {
  // render overlay into jsdom, assert title/body/Next/Skip
});

it('falls back to a centered card when no target element is provided', () => {
  // render with null target and assert fallback copy
});
```

- [ ] **Step 2: Run overlay tests to verify RED**

Run: `npm test -- frontend/src/components/StudentTour/StudentTourOverlay.test.tsx`
Expected: FAIL because the overlay component does not exist yet

- [ ] **Step 3: Write the minimal overlay implementation**

```tsx
export function StudentTourOverlay(props: {
  isOpen: boolean;
  stepTitle: string;
  stepBody: string;
  targetRect: DOMRect | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  isFirstStep: boolean;
  isLastStep: boolean;
}) {
  if (!props.isOpen) return null;
  // render dark backdrop, target outline when targetRect exists,
  // otherwise render centered fallback card
}
```

- [ ] **Step 4: Run overlay tests to verify GREEN**

Run: `npm test -- frontend/src/components/StudentTour/StudentTourOverlay.test.tsx`
Expected: PASS

### Task 3: Student UI Integration and Replay Entry

**Files:**
- Modify: `frontend/src/components/StudentView/Sidebar.tsx`
- Modify: `frontend/src/components/StudentView/StudentView.tsx`

- [ ] **Step 1: Add stable tour targets and replay entry**

Add `data-tour-target` attributes to the student channel buttons and add a new user-menu item:

```tsx
<button data-tour-target="sidebar-ai" ...>AI 导师</button>
<button data-tour-target="sidebar-group" ...>小组讨论</button>
<button data-tour-target="sidebar-learning-space" ...>学习空间设计</button>
<button data-tour-target="sidebar-assignment" ...>作业提交</button>
<button data-tour-target="sidebar-materials" ...>资料</button>
```

```tsx
<button onClick={onOpenTour}>功能导览</button>
```

- [ ] **Step 2: Integrate the store and overlay into `StudentView`**

Wire the student view to:

- auto-start for first-time student entry
- reopen manually from sidebar
- switch channels before each step
- open the sidebar on mobile before target lookup
- compute `targetRect` from `document.querySelector('[data-tour-target=\"...\"]')`

- [ ] **Step 3: Run focused frontend checks**

Run: `npm test -- frontend/src/store/useStudentTourStore.test.ts frontend/src/components/StudentTour/studentTourSteps.test.ts frontend/src/components/StudentTour/StudentTourOverlay.test.tsx`
Expected: PASS

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

### Task 4: Manual Verification Sweep

**Files:**
- No additional files required

- [ ] **Step 1: Validate first-run and replay assumptions in code**

Check that:

- auto-start only runs for `student`
- manual replay always starts at step 1
- skip/finish persist user-scoped local state

- [ ] **Step 2: Review diff scope**

Run: `git diff -- frontend/src/components/StudentView/Sidebar.tsx frontend/src/components/StudentView/StudentView.tsx frontend/src/components/StudentTour frontend/src/store/useStudentTourStore.ts frontend/src/store/useStudentTourStore.test.ts`
Expected: only student-tour-related files and minimal integration changes
