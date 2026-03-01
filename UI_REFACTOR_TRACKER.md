# UI Refactor Tracker (shadcn/ui + Radix + Motion)

## Phase Status

- [x] Phase 0: Foundation and safety rails
- [x] Phase 1: Token and typography migration
- [x] Phase 2: Primitive extraction and replacement (shared components)
- [x] Phase 3: Icons/symbol system (shared shells + auth + upload)
- [x] Phase 4: Global shell and navigation
- [x] Phase 5: Low/medium-risk pages
- [x] Phase 6: Dashboard and class listing pages
- [x] Phase 7: Class workspace and assignment surfaces
- [x] Phase 8: High-complexity editors
- [x] Phase 9: Cleanup and docs finalization

## Finalized Foundation

- `web/components.json`
- `web/src/lib/utils.ts`
- `web/src/components/providers/motion-provider.tsx`
- `web/src/lib/motion/presets.ts`
- `web/src/components/icons/index.tsx`
- `web/src/components/ui/*` primitives

## High-Complexity Editors Completed

- `web/src/app/classes/[classId]/blueprint/BlueprintEditor.tsx`
- `web/src/app/classes/[classId]/activities/quiz/[activityId]/edit/QuizDraftEditor.tsx`
- `web/src/app/classes/[classId]/activities/flashcards/[activityId]/edit/FlashcardsDraftEditor.tsx`
- `web/src/app/classes/[classId]/assignments/[assignmentId]/review/page.tsx`

## Blueprint Route Surfaces Completed

- `web/src/app/classes/[classId]/blueprint/page.tsx`
- `web/src/app/classes/[classId]/blueprint/overview/page.tsx`
- `web/src/app/classes/[classId]/blueprint/published/page.tsx`

## Guardrails and Quality

- Added inline SVG guardrail test:
  - `web/src/lib/no-inline-svg-guardrails.test.ts`
- Existing contrast/style guardrails retained:
  - `web/src/lib/style-contrast-guardrails.test.ts`

## Route Groups

- [x] `(auth)`
- [x] `home/help/settings`
- [x] `teacher/*` and `student/*`
- [x] `classes/[classId]/*`
- [x] `classes/[classId]/blueprint/*`
- [x] `assignments/*`
- [x] `activities/*`
