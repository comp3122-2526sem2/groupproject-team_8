# UI Refactor Catch-up (shadcn/ui + Radix + Motion)

Date: 2026-03-01
Branch: `feat/ui-ux-improvements`

## Goal
Refactor the full frontend to a unified shadcn/Radix/Motion stack while preserving the existing warm, Anthropic-inspired, education-oriented design language and current behavior.

## Original Plan (Condensed)

1. Foundation: install dependencies, add `components.json`, create shared UI primitives, motion provider, icon registry.
2. Theme + typography: map existing warm tokens to semantic CSS variables; use native serif editorial stack.
3. Shared shells/widgets: migrate sidebar/header/buttons/upload and class workspace shell.
4. Route migration by domain:
- auth + home/onboarding/help/settings
- teacher/student dashboards and class listings
- class workspace + assignments
- high-complexity editors last (`BlueprintEditor`, quiz/flashcard draft editors, assignment review)
5. Cleanup: remove legacy `btn-*`, `chip-*`, `input-shell`; keep compatibility where required.
6. Quality gates: `pnpm lint`, `pnpm test`, `pnpm build`.

## Current Progress

### Completed
- Installed and wired dependencies for:
  - shadcn-style primitives (CVA, clsx, tailwind-merge)
  - Radix primitives
  - Motion (`motion/react`)
  - Lucide icons
- Added:
  - `web/components.json`
  - `web/src/lib/utils.ts`
  - `web/src/components/ui/*`
  - `web/src/components/providers/motion-provider.tsx`
  - `web/src/lib/motion/presets.ts`
  - `web/src/components/icons/index.tsx`
- Global wiring completed in `web/src/app/layout.tsx` and `web/src/app/globals.css`.
- Migrated shared components:
  - `Sidebar`, `AuthHeader`, `PendingSubmitButton`, `FileUploadZone`, `ClassWorkspaceShell`, `TeacherChatMonitorPanel`
- Migrated route surfaces:
  - auth: `login`, `register`, `AuthShell`
  - landing/onboarding/help/settings
  - teacher dashboards/classes
  - student dashboards/classes
  - join/new class
  - class overview partial + class workspace transitions
- Added phase tracker:
  - `UI_REFACTOR_TRACKER.md`
- Updated design docs:
  - `DESIGN.md`, `ROADMAP.md`

### In Progress / Remaining
- Deep class/editor pages still need full componentization and polish:
  - `web/src/app/classes/[classId]/blueprint/BlueprintEditor.tsx`
  - `web/src/app/classes/[classId]/activities/quiz/[activityId]/edit/QuizDraftEditor.tsx`
  - `web/src/app/classes/[classId]/activities/flashcards/[activityId]/edit/FlashcardsDraftEditor.tsx`
  - `web/src/app/classes/[classId]/assignments/[assignmentId]/review/page.tsx`
  - assignment panels and some activity-specific flows
- Blueprint map inline SVG is intentionally retained for semantic diagram rendering.

## Validation Results (Latest)

- `pnpm lint`: pass
- `pnpm test`: pass (`31` files / `173` tests)
- `pnpm build`: pass

Notes:
- Build warning about multiple lockfiles and `outputFileTracingRoot` remains pre-existing workspace behavior.

## Key Decisions Locked

- Rollout strategy: phased by domain.
- Motion profile: balanced modern, reduced-motion respected globally.
- Typography: keep Open Sans + Poppins + Geist Mono; editorial switched to native serif stack.
- Icon strategy: Lucide registry across app; allow custom `BrandMark` and blueprint diagram SVG.

## Next Session Checklist

1. Finish deep editor migrations (blueprint/editor + quiz/flashcards draft editors).
2. Migrate assignment review and remaining assignment panels to shared primitives.
3. Add stricter lint guardrail for inline SVG allowlist (`BrandMark` + blueprint diagram only).
4. Tighten accessibility pass on keyboard/focus for editor-heavy pages.
5. Run full quality gates again and update `UI_REFACTOR_TRACKER.md` to 100%.

