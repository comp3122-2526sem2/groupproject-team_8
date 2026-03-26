# Guest Mode Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align guest sandbox cleanup with the approved cleanup design so middleware remains the authoritative expiry gate and Supabase-native cleanup performs bounded hygiene work without relying on Vercel cron.

**Architecture:** Keep `web/middleware.ts` as the source of truth for guest session validity. Update the SQL cleanup function to process a bounded batch of expired/discarded sandboxes per run, and add a Supabase-native execution path that can invoke cleanup on a schedule or on-demand without affecting correctness.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres/RLS/RPC, Vitest, SQL migrations.

---

## File structure

### Existing files to modify

| File | Change |
|------|--------|
| `supabase/migrations/0015_guest_mode_schema.sql` | Replace unbounded cleanup function with bounded, idempotent cleanup API and remove assumptions that cleanup cadence must be tied to Vercel cron. |
| `web/middleware.ts` | Keep request-time expiry authoritative; update only if needed to stay aligned with the cleanup design and current invariants. |
| `web/src/lib/guest/sandbox.ts` | Add helpers for on-demand hygiene invocation only if needed; do not move correctness out of middleware. |
| `web/src/app/actions.ts` | Add a narrow server action only if needed for manual/admin/on-demand cleanup invocation; do not make Vercel cron required. |
| `web/src/lib/auth/session.test.ts` or existing guest tests | Extend tests only if middleware/session-related behavior changes. |

### New files to create

| File | Purpose |
|------|---------|
| `web/src/lib/guest/cleanup.test.ts` | Frontend/server-side tests for any new cleanup helper behavior if a helper is added. |

---

### Task 1: Make SQL cleanup bounded and idempotent

**Files:**
- Modify: `supabase/migrations/0015_guest_mode_schema.sql`

- [ ] **Step 1: Write the failing SQL verification case as a migration test note**

Add this verification block as a comment near the cleanup function section so the implementer knows the required contract:

```sql
-- Cleanup contract verification target:
-- 1. Function accepts a batch size argument.
-- 2. Function processes at most that many expired/discarded sandboxes.
-- 3. Re-running cleanup after partial success is safe.
-- 4. Middleware remains responsible for rejecting expired sessions.
```

- [ ] **Step 2: Replace the cleanup function signature with a bounded version**

Change the function declaration from an unbounded signature to a bounded one:

```sql
create or replace function public.cleanup_expired_guest_sandboxes(
  p_batch_size integer default 25
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_count integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_batch_size, 25), 100));
begin
  for v_row in
    select gs.id, gs.user_id
    from public.guest_sandboxes gs
    where gs.status in ('active', 'expired', 'discarded')
      and (
        gs.status in ('expired', 'discarded')
        or gs.expires_at <= now()
        or gs.last_seen_at <= now() - interval '1 hour'
      )
    order by gs.expires_at asc nulls first, gs.last_seen_at asc, gs.created_at asc
    limit v_limit
  loop
    update public.guest_sandboxes
       set status = 'expired',
           updated_at = now()
     where id = v_row.id
       and status = 'active';

    delete from public.classes where sandbox_id = v_row.id;
    delete from auth.users where id = v_row.user_id and coalesce(is_anonymous, false);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
```

- [ ] **Step 3: Add a migration-safe verification query comment for bounded behavior**

Append this verification note after the function body:

```sql
-- Expected manual verification:
-- select public.cleanup_expired_guest_sandboxes(1);
-- Should return at most 1 and leave additional expired sandboxes for subsequent runs.
```

- [ ] **Step 4: Run targeted SQL verification mentally against current schema references**

Confirm in the file that the bounded cleanup logic still only depends on:
- `guest_sandboxes.id`
- `guest_sandboxes.user_id`
- `guest_sandboxes.status`
- `guest_sandboxes.expires_at`
- `guest_sandboxes.last_seen_at`
- `classes.sandbox_id`
- `auth.users.is_anonymous`

Expected: all referenced columns already exist in the migration.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0015_guest_mode_schema.sql
git commit -m "fix: bound guest sandbox cleanup batches"
```

---

### Task 2: Remove Vercel-cron dependency from the cleanup design path

**Files:**
- Modify: `supabase/migrations/0015_guest_mode_schema.sql`
- Modify: `docs/superpowers/plans/2026-03-26-guest-mode-implementation.md`

- [ ] **Step 1: Remove or rewrite any cleanup scheduling block that assumes generic frequent cron**

If the migration contains a scheduling section that encodes a specific frequent cron assumption, replace it with an explanatory comment:

```sql
-- Cleanup scheduling is deployment-specific.
-- Middleware enforces expiry correctness on every request.
-- Background cleanup should be triggered by Supabase-native scheduling or another
-- bounded hygiene mechanism, not by assuming frequent Vercel cron availability.
```

- [ ] **Step 2: Update the implementation plan rollout note to reflect the approved design**

In `docs/superpowers/plans/2026-03-26-guest-mode-implementation.md`, replace the rollout note:

```md
- Set up `pg_cron` job to call `cleanup_expired_guest_sandboxes()` every 15 minutes
```

with:

```md
- Keep middleware as the authoritative expiry check for guest sessions.
- Trigger `cleanup_expired_guest_sandboxes(<batch_size>)` using Supabase-native scheduling or another bounded hygiene mechanism.
- Do not rely on frequent Vercel cron execution for guest lifecycle correctness.
```

- [ ] **Step 3: Verify the wording matches the approved cleanup design spec**

Re-read:
- `docs/superpowers/specs/2026-03-26-guest-mode-cleanup-design.md`
- `docs/superpowers/plans/2026-03-26-guest-mode-implementation.md`

Expected: both describe request-time expiry as authoritative and scheduled cleanup as hygiene.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0015_guest_mode_schema.sql docs/superpowers/plans/2026-03-26-guest-mode-implementation.md
git commit -m "docs: align guest cleanup with request-driven expiry design"
```

---

### Task 3: Add optional on-demand cleanup invocation hook (only if needed)

**Files:**
- Modify: `web/src/app/actions.ts`
- Create: `web/src/lib/guest/cleanup.test.ts`

This task is only needed if you want a narrow manual/server-triggered cleanup entrypoint for operations or testing. Skip it if the chosen deployment path is purely Supabase-native scheduling and no app-level invocation is needed.

- [ ] **Step 1: Write the failing test for an on-demand cleanup helper**

Create `web/src/lib/guest/cleanup.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "@/lib/supabase/server";

async function runCleanup(batchSize: number) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("cleanup_expired_guest_sandboxes", {
    p_batch_size: batchSize,
  });
  if (error) throw error;
  return data;
}

describe("runCleanup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the requested batch size to the cleanup rpc", async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: 3, error: null }),
    } as never);

    await expect(runCleanup(25)).resolves.toBe(3);
    expect((await createServerSupabaseClient()).rpc).toHaveBeenCalledWith(
      "cleanup_expired_guest_sandboxes",
      { p_batch_size: 25 },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails or is disconnected from production code**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm exec vitest run src/lib/guest/cleanup.test.ts
```

Expected: FAIL initially because the helper does not yet exist as production code.

- [ ] **Step 3: Add the minimal helper in `web/src/app/actions.ts` only if app-level invocation is needed**

Add:

```ts
export async function runGuestCleanup(batchSize = 25): Promise<{ ok: boolean; cleaned?: number; error?: string }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("cleanup_expired_guest_sandboxes", {
    p_batch_size: batchSize,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, cleaned: typeof data === "number" ? data : 0 };
}
```

Do not add routing, automation, or public UI around this helper unless separately requested.

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm exec vitest run src/lib/guest/cleanup.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/actions.ts web/src/lib/guest/cleanup.test.ts
git commit -m "feat: add bounded guest cleanup invocation helper"
```

---

### Task 4: Verify lifecycle correctness still holds

**Files:**
- Modify: `web/middleware.ts` only if required by test failures
- Verify existing guest files

- [ ] **Step 1: Run guest lifecycle-related frontend tests**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm exec vitest run src/lib/auth/session.test.ts src/lib/activities/access.test.ts src/lib/guest/sandbox.test.ts src/lib/guest/rate-limit.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the web build**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm build
```

Expected: PASS.

- [ ] **Step 3: If middleware needs adjustment, make the smallest fix only**

Allowed changes:
- preserve request-time expiry enforcement
- preserve sign-out + redirect behavior
- do not move correctness into background cleanup

- [ ] **Step 4: Re-run verification after any middleware change**

Run the same commands from Steps 1 and 2.

Expected: PASS.

- [ ] **Step 5: Commit any lifecycle verification fix**

```bash
git add web/middleware.ts web/src/lib/auth/session.test.ts web/src/lib/activities/access.test.ts web/src/lib/guest/sandbox.test.ts web/src/lib/guest/rate-limit.test.ts
git commit -m "test: verify request-driven guest expiry lifecycle"
```

---

### Task 5: Full review of remaining guest-mode work

**Files:**
- No source files required unless verification reveals new issues.

- [ ] **Step 1: Run full frontend verification**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm exec vitest run
```

Expected: PASS.

- [ ] **Step 2: Run backend verification**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_*.py'
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
cd /Users/billyfa/COMP3122_ISD_Project/web && pnpm build
```

Expected: PASS.

- [ ] **Step 4: Reconcile remaining plan gaps**

Read:
- `docs/superpowers/plans/2026-03-26-guest-mode-implementation.md`
- `docs/superpowers/specs/2026-03-26-guest-mode-cleanup-design.md`

Confirm that the only remaining gaps are genuinely outside this cleanup slice.

- [ ] **Step 5: Commit any fixes from verification**

```bash
git add -A
git commit -m "test: verify guest cleanup redesign"
```
