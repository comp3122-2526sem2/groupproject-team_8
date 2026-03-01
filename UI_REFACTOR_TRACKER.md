# UI Refactor Tracker (shadcn/ui + Radix + Motion)

## Phase Status

- [x] Phase 0: Foundation and safety rails
- [x] Phase 1: Token and typography migration
- [x] Phase 2: Primitive extraction and replacement (shared components)
- [x] Phase 3: Icons/symbol system (shared shells + auth + upload)
- [x] Phase 4: Global shell and navigation
- [x] Phase 5: Low/medium-risk pages
- [x] Phase 6: Dashboard and class listing pages
- [~] Phase 7: Class workspace and assignment surfaces (partial)
- [ ] Phase 8: High-complexity editors
- [ ] Phase 9: Cleanup and docs finalization

## Added Foundation

- `web/components.json`
- `web/src/lib/utils.ts`
- `web/src/components/providers/motion-provider.tsx`
- `web/src/lib/motion/presets.ts`
- `web/src/components/icons/index.tsx`
- `web/src/components/ui/*` primitives

## Shared Components Migrated

- `web/src/app/components/Sidebar.tsx`
- `web/src/app/components/AuthHeader.tsx`
- `web/src/app/components/PendingSubmitButton.tsx`
- `web/src/app/components/FileUploadZone.tsx`
- `web/src/app/classes/[classId]/_components/ClassWorkspaceShell.tsx`
- `web/src/app/(auth)/AuthShell.tsx`
- `web/src/app/classes/[classId]/chat/TeacherChatMonitorPanel.tsx`

## Route Groups

- [x] `(auth)`
- [x] `home/help/settings`
- [x] `teacher/*` and `student/*`
- [~] `classes/[classId]/*`
- [ ] `classes/[classId]/blueprint/*` (except shared shell integration)
- [ ] `assignments/*`
- [ ] `activities/*`
