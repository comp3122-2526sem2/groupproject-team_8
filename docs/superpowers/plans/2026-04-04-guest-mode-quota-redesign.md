# Guest Mode Quota Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire per-IP entry rate limiting, replace it with fair global session caps (60 active / 20 new per hour), extend session TTLs, raise feature quotas, and replace DB-polling AI concurrency with an `asyncio.Semaphore` that queues requests for up to 60 seconds.

**Architecture:** A new `guest_session_quota` Postgres table (single global row) tracks active sessions, creation rate, and in-flight AI requests — replacing two retired tables (`guest_ai_quota_state`, `guest_entry_rate_limits`). Session entry checks a new `acquire_guest_session_service` RPC (no IP involved). AI concurrency is gated by a Python `asyncio.Semaphore(20)`; the DB counter is kept for orphan cleanup only.

**Tech Stack:** Supabase (PostgreSQL migration), Next.js 16 server actions (TypeScript), FastAPI Python backend (asyncio), Vitest (frontend unit tests), Python unittest.

**Spec:** `docs/superpowers/specs/2026-04-04-guest-mode-quota-redesign.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/0023_guest_quota_redesign.sql` | **Create** | Drop retired tables/RPCs, add `guest_session_quota`, new entry/release RPCs, update all downstream functions |
| `web/src/lib/guest/config.ts` | **Modify** | Update TTL constants, remove `GUEST_SESSIONS_PER_HOUR` |
| `web/src/lib/guest/errors.ts` | **Modify** | Add two new error codes and their UI copy |
| `web/src/lib/guest/entry-rate-limit.ts` | **Delete** | Entire file retired |
| `web/src/lib/guest/sandbox.ts` | **Modify** | Replace IP rate-limit call with `acquire_guest_session_service` RPC |
| `web/src/app/guest/enter/route.ts` | **Modify** | Remove IP extraction import and call |
| `web/src/app/actions.ts` | **Modify** | Remove `ipAddress` param from `startGuestSession` |
| `backend/app/config.py` | **Modify** | Update quota defaults |
| `backend/app/guest_rate_limit.py` | **Modify** | Add semaphore, `GuestConcurrencyTimeoutError`, async acquire/release |
| `backend/app/main.py` | **Modify** | Import `GuestConcurrencyTimeoutError`, change concurrency error handling |
| `backend/tests/helpers.py` | **Modify** | Update `make_settings` with new quota defaults |
| `backend/tests/test_guest_rate_limit.py` | **Modify** | Update limit assertions, fix concurrency test |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0023_guest_quota_redesign.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/0023_guest_quota_redesign.sql
--
-- Guest quota redesign:
--   - Drop guest_entry_rate_limits table and consume_guest_entry_rate_limit_service RPC
--   - Drop guest_ai_quota_state table (replaced by guest_session_quota)
--   - Add guest_session_quota table (active sessions + creation rate + AI concurrency)
--   - Add acquire_guest_session_service RPC (global session caps, no IP tracking)
--   - Add release_guest_session_slot_service RPC (frontend calls on provision failure)
--   - Update acquire_guest_ai_slot_service to reference guest_session_quota
--   - Update release_guest_ai_slot_service to reference guest_session_quota
--   - Update discard_guest_sandbox to decrement active_sessions
--   - Update cleanup_expired_guest_sandboxes: 8-hour inactivity + active_sessions decrement
--   - Update release_guest_sandbox_quota to reference guest_session_quota

-- ─── 1. Drop retired entry rate-limit objects ────────────────────────────────

drop function if exists public.consume_guest_entry_rate_limit_service(text, integer, integer);
drop table if exists public.guest_entry_rate_limits;

-- ─── 2. Create guest_session_quota (replaces guest_ai_quota_state) ───────────

create table public.guest_session_quota (
  scope                      text        primary key default 'global',
  active_sessions            integer     not null default 0 check (active_sessions >= 0),
  creation_count             integer     not null default 0 check (creation_count >= 0),
  creation_window_started_at timestamptz not null default now(),
  active_requests            integer     not null default 0 check (active_requests >= 0),
  updated_at                 timestamptz not null default now()
);

-- Migrate existing active_requests value from guest_ai_quota_state if present
insert into public.guest_session_quota (scope, active_requests, updated_at)
select 'global', coalesce(active_requests, 0), now()
from   public.guest_ai_quota_state
where  scope = 'global'
on conflict (scope) do nothing;

-- Ensure the row exists even if old table was empty
insert into public.guest_session_quota (scope)
values ('global')
on conflict (scope) do nothing;

drop table if exists public.guest_ai_quota_state;

-- ─── 3. acquire_guest_session_service ────────────────────────────────────────
--   Atomically checks and increments both active_sessions and creation_count.
--   Returns {"ok": true} on success, or {"ok": false, "reason": "cap_active"|"cap_creation"}.

create or replace function public.acquire_guest_session_service(
  p_active_cap     integer default 60,
  p_creation_cap   integer default 20,
  p_window_seconds integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_quota public.guest_session_quota%rowtype;
  v_now   timestamptz := now();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('guest_session_quota'));

  select * into v_quota
  from   public.guest_session_quota
  where  scope = 'global'
  for    update;

  -- Reset hourly creation window if expired
  if extract(epoch from (v_now - v_quota.creation_window_started_at)) > p_window_seconds then
    v_quota.creation_count             := 0;
    v_quota.creation_window_started_at := v_now;
  end if;

  if v_quota.active_sessions >= p_active_cap then
    return jsonb_build_object('ok', false, 'reason', 'cap_active');
  end if;

  if v_quota.creation_count >= p_creation_cap then
    return jsonb_build_object('ok', false, 'reason', 'cap_creation');
  end if;

  update public.guest_session_quota
  set active_sessions            = v_quota.active_sessions + 1,
      creation_count             = v_quota.creation_count + 1,
      creation_window_started_at = v_quota.creation_window_started_at,
      updated_at                 = v_now
  where scope = 'global';

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.acquire_guest_session_service(integer, integer, integer) to service_role;

-- ─── 4. release_guest_session_slot_service ───────────────────────────────────
--   Decrements active_sessions by 1 (floor 0).
--   Called from sandbox.ts in failure path when provision fails after quota was acquired.

create or replace function public.release_guest_session_slot_service()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_session_quota
  set active_sessions = greatest(active_sessions - 1, 0),
      updated_at      = now()
  where scope = 'global';
end;
$$;

grant execute on function public.release_guest_session_slot_service() to service_role;

-- ─── 5. acquire_guest_ai_slot_service (monitoring only; semaphore is the gate) ──
--   No longer checks the global cap before incrementing — the Python asyncio.Semaphore
--   is the real gate. The DB counter is kept for orphan cleanup accuracy only.

create or replace function public.acquire_guest_ai_slot_service(
  p_sandbox_id uuid,
  p_limit      integer default 20  -- kept for signature compat, not used as gate
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_acquired boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_sandboxes
     set active_ai_requests = active_ai_requests + 1,
         last_seen_at       = now(),
         updated_at         = now()
   where id     = p_sandbox_id
     and status = 'active'
  returning true into v_acquired;

  if not coalesce(v_acquired, false) then
    return false;
  end if;

  update public.guest_session_quota
     set active_requests = active_requests + 1,
         updated_at      = now()
   where scope = 'global';

  return true;
end;
$$;

grant execute on function public.acquire_guest_ai_slot_service(uuid, integer) to service_role;

-- ─── 6. release_guest_ai_slot_service (references guest_session_quota) ───────

create or replace function public.release_guest_ai_slot_service(
  p_sandbox_id uuid
)
returns public.guest_sandboxes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row      public.guest_sandboxes;
  v_released integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  update public.guest_sandboxes
     set active_ai_requests = greatest(active_ai_requests - 1, 0),
         last_seen_at       = now(),
         updated_at         = now()
   where id                 = p_sandbox_id
     and active_ai_requests > 0
  returning * into v_row;

  if v_row.id is null then
    return null;
  end if;

  v_released := 1;

  update public.guest_session_quota
     set active_requests = greatest(active_requests - v_released, 0),
         updated_at      = now()
   where scope = 'global';

  return v_row;
end;
$$;

grant execute on function public.release_guest_ai_slot_service(uuid) to service_role;

-- ─── 7. discard_guest_sandbox (also decrements active_sessions) ──────────────

create or replace function public.discard_guest_sandbox(
  p_sandbox_id uuid
)
returns public.guest_sandboxes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.guest_sandboxes;
  v_row      public.guest_sandboxes;
  v_released integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_existing
  from   public.guest_sandboxes gs
  where  gs.id      = p_sandbox_id
    and  gs.user_id = auth.uid()
    and  gs.status  = 'active'
  for update;

  if not found then
    raise exception 'Guest sandbox not found.' using errcode = 'P0002';
  end if;

  v_released := greatest(coalesce(v_existing.active_ai_requests, 0), 0);

  -- Release any in-flight AI slots from global counter
  if v_released > 0 then
    update public.guest_session_quota
       set active_requests = greatest(active_requests - v_released, 0),
           updated_at      = now()
     where scope = 'global';
  end if;

  -- Decrement the active session count
  update public.guest_session_quota
     set active_sessions = greatest(active_sessions - 1, 0),
         updated_at      = now()
   where scope = 'global';

  delete from public.classes where sandbox_id = p_sandbox_id;

  update public.guest_sandboxes
     set status             = 'discarded',
         active_ai_requests = 0,
         last_seen_at       = now(),
         updated_at         = now()
   where id = p_sandbox_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.discard_guest_sandbox(uuid) to authenticated;

-- ─── 8. cleanup_expired_guest_sandboxes: 8-hour inactivity + session count ───

create or replace function public.cleanup_expired_guest_sandboxes(
  p_batch_size integer default 25
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row          record;
  v_count        integer := 0;
  v_limit        integer := greatest(1, least(coalesce(p_batch_size, 25), 100));
  v_rows_affected integer := 0;
  v_did_work     boolean;
  v_released     integer := 0;
begin
  -- Ensure quota row exists before any updates
  insert into public.guest_session_quota (scope)
  values ('global')
  on conflict (scope) do nothing;

  for v_row in
    select gs.id,
           gs.user_id,
           gs.status                                           as current_status,
           greatest(coalesce(gs.active_ai_requests, 0), 0)   as active_ai_requests
    from   public.guest_sandboxes gs
    where  gs.status in ('expired', 'discarded')
       or  (
             gs.status = 'active'
             and (
               gs.expires_at  <= now()
               or gs.last_seen_at <= now() - interval '8 hours'  -- was 1 hour
             )
           )
    order by gs.expires_at asc nulls first, gs.last_seen_at asc, gs.created_at asc
    limit v_limit
    for update skip locked
  loop
    v_did_work := false;
    v_released := greatest(coalesce(v_row.active_ai_requests, 0), 0);

    -- Release in-flight AI slots
    if v_released > 0 then
      update public.guest_session_quota
         set active_requests = greatest(active_requests - v_released, 0),
             updated_at      = now()
       where scope = 'global';
    end if;

    -- Decrement active session count only for non-discarded sandboxes.
    -- Sandboxes with status='discarded' already had their slot decremented
    -- by discard_guest_sandbox — decrementing again would undercount.
    if v_row.current_status != 'discarded' then
      update public.guest_session_quota
         set active_sessions = greatest(active_sessions - 1, 0),
             updated_at      = now()
       where scope = 'global';
    end if;

    delete from public.classes where sandbox_id = v_row.id;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then v_did_work := true; end if;

    delete from auth.users where id = v_row.user_id and coalesce(is_anonymous, false);
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then v_did_work := true; end if;

    delete from public.guest_sandboxes where id = v_row.id;
    get diagnostics v_rows_affected = row_count;
    if v_rows_affected > 0 then v_did_work := true; end if;

    if v_did_work then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.cleanup_expired_guest_sandboxes(integer) to service_role;

-- ─── 9. release_guest_sandbox_quota (references guest_session_quota) ─────────

create or replace function public.release_guest_sandbox_quota(
  p_sandbox_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required.' using errcode = '42501';
  end if;

  select greatest(coalesce(active_ai_requests, 0), 0)
    into v_count
    from public.guest_sandboxes
   where id = p_sandbox_id;

  if v_count > 0 then
    update public.guest_session_quota
       set active_requests = greatest(active_requests - v_count, 0),
           updated_at      = now()
     where scope = 'global';
  end if;
end;
$$;

grant execute on function public.release_guest_sandbox_quota(uuid) to service_role;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the `mcp__supabase__execute_sql` tool to apply the migration. Run the entire SQL file content from Step 1 as the `sql` parameter.

Expected: no error; confirm with `SELECT scope, active_sessions, creation_count, active_requests FROM guest_session_quota;` — should return one row with `scope='global'` and `active_sessions=0`.

- [ ] **Step 3: Verify retired tables are gone**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('guest_ai_quota_state', 'guest_entry_rate_limits');
```

Expected: 0 rows.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/0023_guest_quota_redesign.sql
git commit -m "feat(guest): add 0023 migration — global session quota, retire per-IP rate limit"
```

---

## Task 2: Frontend — config.ts and errors.ts

**Files:**
- Modify: `web/src/lib/guest/config.ts`
- Modify: `web/src/lib/guest/errors.ts`

- [ ] **Step 1: Update TTL constants in config.ts**

Replace the entire file content:

```ts
export const GUEST_SESSION_MAX_AGE_MS = 32 * 60 * 60 * 1000;
export const GUEST_SESSION_INACTIVITY_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export function isGuestModeEnabled() {
  const raw = process.env.NEXT_PUBLIC_GUEST_MODE_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
```

(`GUEST_SESSIONS_PER_HOUR` and `GUEST_SESSION_RATE_LIMIT_WINDOW_MS` are removed — no longer used.)

- [ ] **Step 2: Add new error codes in errors.ts**

Replace the `GuestProvisionFailureCode` type and `GuestEntryErrorQuery` type, then add two new `getGuestLandingFeedback` cases. Full file:

```ts
import { getGuestSessionExpiredMessage } from "@/lib/guest/session-expiry";

export type GuestProvisionFailureCode =
  | "guest-unavailable"
  | "too-many-guest-sessions"
  | "too-many-active-sessions"
  | "too-many-new-sessions"
  | "guest-auth-unavailable"
  | "guest-session-conflict"
  | "guest-sandbox-provision-failed"
  | "guest-session-check-failed";

export type GuestEntryErrorQuery =
  | "guest-unavailable"
  | "too-many-guest-sessions"
  | "too-many-active-sessions"
  | "too-many-new-sessions"
  | "guest-session-check-failed";

export type GuestLandingFeedback = {
  variant: "error" | "warning";
  title: string;
  message: string;
};

export function toGuestEntryErrorQuery(code: GuestProvisionFailureCode): GuestEntryErrorQuery {
  if (
    code === "too-many-guest-sessions" ||
    code === "too-many-active-sessions" ||
    code === "too-many-new-sessions" ||
    code === "guest-session-check-failed"
  ) {
    return code;
  }
  return "guest-unavailable";
}

export function getGuestLandingFeedback(input: {
  error?: string | null;
  guest?: string | null;
}): GuestLandingFeedback | null {
  if (input.guest === "expired") {
    return {
      variant: "warning",
      title: "Guest session expired",
      message: getGuestSessionExpiredMessage(),
    };
  }

  switch (input.error) {
    case "too-many-active-sessions":
      return {
        variant: "warning",
        title: "Guest demo is at capacity",
        message:
          "The guest demo has reached the active session limit. Please try again in a few minutes.",
      };
    case "too-many-new-sessions":
      return {
        variant: "warning",
        title: "Too many new sessions",
        message:
          "Too many demo sessions have been started this hour. Please try again shortly.",
      };
    case "too-many-guest-sessions":
      return {
        variant: "warning",
        title: "Guest mode is busy",
        message:
          "Guest mode has reached the current session limit. Please wait a bit before trying again.",
      };
    case "guest-session-check-failed":
      return {
        variant: "warning",
        title: "Guest session could not be verified",
        message: "We couldn't verify your guest session. Please start a new guest session.",
      };
    case "guest-unavailable":
      return {
        variant: "error",
        title: "Guest mode is temporarily unavailable",
        message:
          "We couldn't open the guest classroom right now. Create an account or try again shortly.",
      };
    default:
      return null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/guest/config.ts web/src/lib/guest/errors.ts
git commit -m "feat(guest): extend TTLs to 32h/8h, add too-many-active/new-sessions error codes"
```

---

## Task 3: Frontend — route.ts, actions.ts, and delete entry-rate-limit.ts

**Files:**
- Modify: `web/src/app/guest/enter/route.ts`
- Modify: `web/src/app/actions.ts`
- Delete: `web/src/lib/guest/entry-rate-limit.ts`

- [ ] **Step 1: Update route.ts — remove IP extraction**

Replace the file:

```ts
import { NextResponse } from "next/server";
import { startGuestSession } from "@/app/actions";
import { toGuestEntryErrorQuery } from "@/lib/guest/errors";

async function handleGuestEntry(request: Request) {
  const result = await startGuestSession();
  if (!result.ok) {
    const error = toGuestEntryErrorQuery(result.code ?? "guest-unavailable");
    return NextResponse.redirect(new URL(`/?error=${error}`, request.url));
  }
  if (!result.redirectTo) {
    return NextResponse.redirect(new URL("/?error=guest-unavailable", request.url));
  }
  return NextResponse.redirect(new URL(result.redirectTo, request.url));
}

export async function POST(request: Request) {
  return handleGuestEntry(request);
}

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/", request.url));
}
```

- [ ] **Step 2: Update startGuestSession in actions.ts**

Replace the `startGuestSession` function (lines 520–584). The function no longer takes `input` with `ipAddress`. It still returns the same shape.

Find and replace the function:

```ts
/**
 * Provisions a new guest (anonymous) session and returns the redirect URL for
 * the guest's sandboxed class.
 *
 * Called from the `/guest/enter` route handler after the homepage guest-entry
 * form submits. Returns a result object rather than redirecting so the route
 * can translate structured failures into stable landing-page feedback.
 *
 * @returns  `{ ok: true, redirectTo }` on success, or
 *           `{ ok: false, code, error }` with a structured failure code.
 */
export async function startGuestSession(): Promise<{
  ok: boolean;
  redirectTo?: string;
  code?: GuestProvisionFailureCode;
  error?: string;
}> {
  if (!isGuestModeEnabled()) {
    return {
      ok: false,
      code: "guest-unavailable",
      error: "Guest mode is not enabled.",
    };
  }

  const result = await provisionGuestSandboxWithOptions();
  if (!result.ok) {
    const env =
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV ??
      "unknown";
    const payload = {
      code: result.code,
      reason: result.reason ?? "unspecified",
      message: result.error,
      env,
    };

    if (
      result.code === "too-many-guest-sessions" ||
      result.code === "too-many-active-sessions" ||
      result.code === "too-many-new-sessions"
    ) {
      console.warn("Guest session start blocked by session quota", payload);
    } else {
      console.error("Guest session start failed", payload);
    }

    return { ok: false, code: result.code, error: result.error };
  }

  return {
    ok: true,
    redirectTo: `/classes/${result.classId}`,
  };
}
```

- [ ] **Step 3: Delete entry-rate-limit.ts**

```bash
git rm web/src/lib/guest/entry-rate-limit.ts
```

- [ ] **Step 4: Commit**

```bash
git add web/src/app/guest/enter/route.ts web/src/app/actions.ts
git commit -m "feat(guest): remove IP tracking from guest entry — retire entry-rate-limit.ts"
```

---

## Task 4: Frontend — sandbox.ts: replace rate-limit with global session quota RPC

**Files:**
- Modify: `web/src/lib/guest/sandbox.ts`

- [ ] **Step 1: Remove the old rate-limit import**

In `sandbox.ts` line 8, remove:
```ts
import { consumeGuestEntryRateLimit } from "@/lib/guest/entry-rate-limit";
```

Add import for admin client if not already imported (it's already present at line 11: `import { createAdminSupabaseClient } from "@/lib/supabase/admin";`).

- [ ] **Step 2: Update provisionGuestSandboxWithOptions signature**

Replace:
```ts
export async function provisionGuestSandboxWithOptions(options?: {
  ipAddress?: string | null;
}): Promise<GuestSandboxResult> {
```

With:
```ts
export async function provisionGuestSandboxWithOptions(): Promise<GuestSandboxResult> {
```

- [ ] **Step 3: Replace the rate-limit block with global quota check**

Remove the entire block at lines 311–334 (the `if (options?.ipAddress)` block):
```ts
  // --- Rate-limit check (new anonymous session path only) ---

  if (options?.ipAddress) {
    let allowed: boolean;
    try {
      allowed = await consumeGuestEntryRateLimit(options.ipAddress);
    } catch {
      return {
        ok: false,
        code: "guest-unavailable",
        error: "guest-unavailable",
        reason: "entry-rate-limit-check",
      };
    }

    if (!allowed) {
      return {
        ok: false,
        code: "too-many-guest-sessions",
        error: "too-many-guest-sessions",
        reason: "entry-rate-limit-exceeded",
      };
    }
  }
```

Replace with:
```ts
  // --- Global session quota check (new session path only) ---
  // Atomically checks active-session cap (60) and hourly creation rate (20/h).
  // If acquired, the slot must be released if a later step fails (shouldReleaseSessionQuota tracks this).

  let shouldReleaseSessionQuota = false;
  const adminSupabase = createAdminSupabaseClient();
  const { data: quotaResult, error: quotaError } = await adminSupabase.rpc(
    "acquire_guest_session_service",
    {},
  );

  if (quotaError) {
    return {
      ok: false,
      code: "guest-unavailable",
      error: "guest-unavailable",
      reason: "session-quota-check",
    };
  }

  const quota = quotaResult as { ok: boolean; reason?: string } | null;
  if (!quota?.ok) {
    if (quota?.reason === "cap_creation") {
      return {
        ok: false,
        code: "too-many-new-sessions",
        error: "too-many-new-sessions",
        reason: "creation-rate-cap",
      };
    }
    return {
      ok: false,
      code: "too-many-active-sessions",
      error: "too-many-active-sessions",
      reason: "active-session-cap",
    };
  }
  shouldReleaseSessionQuota = true;
```

- [ ] **Step 4: Add quota slot release helper function**

Add this private helper above `provisionGuestSandbox` (before line 159):

```ts
/**
 * Releases a previously acquired global session quota slot.
 *
 * Called in the provision failure path when `acquire_guest_session_service`
 * succeeded but a later step (anonymous auth or sandbox insert/clone) failed.
 * Prevents leaking an active-session slot count if provisioning rolls back.
 */
async function releaseGuestSessionSlot(): Promise<void> {
  const adminSupabase = createAdminSupabaseClient();
  await adminSupabase.rpc("release_guest_session_slot_service", {});
}
```

- [ ] **Step 5: Add slot release to both failure paths after quota acquisition**

In the "Create anonymous Auth user" block (after the new quota check), update the failure path:

Find:
```ts
  if (!guestUserId) {
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
    if (authError || !authData.user) {
      return {
        ok: false,
        code: "guest-auth-unavailable",
        error: authError?.message ?? "Failed to create an anonymous guest session.",
        reason: "anonymous-auth",
      };
    }
```

Replace with:
```ts
  if (!guestUserId) {
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
    if (authError || !authData.user) {
      if (shouldReleaseSessionQuota) {
        await releaseGuestSessionSlot();
      }
      return {
        ok: false,
        code: "guest-auth-unavailable",
        error: authError?.message ?? "Failed to create an anonymous guest session.",
        reason: "anonymous-auth",
      };
    }
```

Find the second anonymous-auth missing-user guard:
```ts
  if (!guestUserId) {
    return {
      ok: false,
      code: "guest-auth-unavailable",
      error: "Failed to create an anonymous guest session.",
      reason: "anonymous-auth-missing-user",
    };
  }
```

Replace with:
```ts
  if (!guestUserId) {
    if (shouldReleaseSessionQuota) {
      await releaseGuestSessionSlot();
    }
    return {
      ok: false,
      code: "guest-auth-unavailable",
      error: "Failed to create an anonymous guest session.",
      reason: "anonymous-auth-missing-user",
    };
  }
```

Find the sandbox insert failure path:
```ts
  if (sandboxError) {
    if (shouldSignOutOnFailure) {
      // We created the anonymous user moments ago; undo it to avoid an orphan.
      await supabase.auth.signOut();
    }
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: `Failed to create a guest sandbox: ${sandboxError.message}`,
      reason: "sandbox-insert",
    };
  }
```

Replace with:
```ts
  if (sandboxError) {
    if (shouldSignOutOnFailure) {
      await supabase.auth.signOut();
    }
    if (shouldReleaseSessionQuota) {
      await releaseGuestSessionSlot();
    }
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: `Failed to create a guest sandbox: ${sandboxError.message}`,
      reason: "sandbox-insert",
    };
  }
```

Find the clone failure path:
```ts
  if (cloneError || typeof classId !== "string" || !classId) {
    // Mark the sandbox as discarded so it is excluded from future active queries.
    await supabase.from("guest_sandboxes").update({ status: "discarded" }).eq("id", sandboxId);
    if (shouldSignOutOnFailure) {
      await supabase.auth.signOut();
    }
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: cloneError?.message ?? "Failed to provision the guest classroom.",
      reason: "sandbox-clone",
    };
  }
```

Replace with:
```ts
  if (cloneError || typeof classId !== "string" || !classId) {
    await supabase.from("guest_sandboxes").update({ status: "discarded" }).eq("id", sandboxId);
    if (shouldSignOutOnFailure) {
      await supabase.auth.signOut();
    }
    // discard_guest_sandbox RPC will decrement active_sessions; but since we
    // set status='discarded' directly (not via RPC), release the slot manually.
    if (shouldReleaseSessionQuota) {
      await releaseGuestSessionSlot();
    }
    return {
      ok: false,
      code: "guest-sandbox-provision-failed",
      error: cloneError?.message ?? "Failed to provision the guest classroom.",
      reason: "sandbox-clone",
    };
  }
```

- [ ] **Step 6: TypeScript compile check**

```bash
cd /Users/billyfa/COMP3122_ISD_Project && pnpm --dir web tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `entry-rate-limit`, `ipAddress`, or the new types.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/guest/sandbox.ts
git commit -m "feat(guest): replace per-IP rate limit with global session quota RPC in sandbox.ts"
```

---

## Task 5: Backend — config.py quota defaults

**Files:**
- Modify: `backend/app/config.py`

- [ ] **Step 1: Update the five quota defaults and the concurrency limit**

In `get_settings()`, replace:
```python
        guest_max_concurrent_ai_requests=_get_int("GUEST_MAX_CONCURRENT_AI_REQUESTS", 10),
        guest_chat_limit=_get_int("GUEST_CHAT_LIMIT", 50),
        guest_quiz_limit=_get_int("GUEST_QUIZ_LIMIT", 5),
        guest_flashcards_limit=_get_int("GUEST_FLASHCARDS_LIMIT", 10),
        guest_blueprint_limit=_get_int("GUEST_BLUEPRINT_LIMIT", 3),
        guest_embedding_limit=_get_int("GUEST_EMBEDDING_LIMIT", 5),
```

With:
```python
        guest_max_concurrent_ai_requests=_get_int("GUEST_MAX_CONCURRENT_AI_REQUESTS", 20),
        guest_chat_limit=_get_int("GUEST_CHAT_LIMIT", 50),
        guest_quiz_limit=_get_int("GUEST_QUIZ_LIMIT", 10),
        guest_flashcards_limit=_get_int("GUEST_FLASHCARDS_LIMIT", 10),
        guest_blueprint_limit=_get_int("GUEST_BLUEPRINT_LIMIT", 5),
        guest_embedding_limit=_get_int("GUEST_EMBEDDING_LIMIT", 15),
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/config.py
git commit -m "feat(guest): update quota defaults — 20 concurrent, quiz×2, blueprint+2, embedding×3"
```

---

## Task 6: Backend — guest_rate_limit.py: asyncio semaphore

**Files:**
- Modify: `backend/app/guest_rate_limit.py`

- [ ] **Step 1: Write failing tests for new behavior first**

Open `backend/tests/test_guest_rate_limit.py` and add three new test methods to `GuestRateLimitFunctionTests`:

```python
    def test_acquire_guest_ai_slot_is_coroutine(self) -> None:
        """acquire_guest_ai_slot must be an async function (coroutine)."""
        import asyncio
        import inspect
        from app.guest_rate_limit import acquire_guest_ai_slot
        self.assertTrue(inspect.iscoroutinefunction(acquire_guest_ai_slot))

    def test_release_guest_ai_slot_is_coroutine(self) -> None:
        """release_guest_ai_slot must be an async function (coroutine)."""
        import inspect
        from app.guest_rate_limit import release_guest_ai_slot
        self.assertTrue(inspect.iscoroutinefunction(release_guest_ai_slot))

    def test_guest_concurrency_timeout_error_is_importable(self) -> None:
        """GuestConcurrencyTimeoutError must be exported from guest_rate_limit."""
        from app.guest_rate_limit import GuestConcurrencyTimeoutError
        self.assertTrue(issubclass(GuestConcurrencyTimeoutError, Exception))
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest backend/tests/test_guest_rate_limit.py -v 2>&1 | tail -20
```

Expected: `GuestConcurrencyTimeoutError` import error (new tests fail, existing pass).

- [ ] **Step 3: Rewrite guest_rate_limit.py with semaphore**

Replace the `acquire_guest_ai_slot` and `release_guest_ai_slot` functions and add the semaphore infrastructure. The rest of the file (`_FEATURE_COLUMNS`, `_feature_limit`, `guest_usage_column`, `check_guest_ai_access`, `increment_guest_ai_usage`, `_service_rpc`, `_safe_json`, `_extract_error_message`, `_coerce_non_negative_int`) is unchanged.

Add at the top of the file after the existing imports:

```python
import asyncio
import logging

logger = logging.getLogger(__name__)
```

Add immediately after the imports and before `_FEATURE_COLUMNS`:

```python
class GuestConcurrencyTimeoutError(Exception):
    """Raised when a guest AI slot cannot be acquired within the queue timeout.

    The asyncio.Semaphore holds up to GUEST_MAX_CONCURRENT_AI_REQUESTS concurrent
    AI requests across all active guest sessions. When all slots are occupied, new
    requests wait up to 60 seconds. If no slot opens in time, this exception is
    raised and the caller should return HTTP 503.
    """


# Module-level semaphore singleton. Created lazily on first acquire() call so
# it is bound to the running event loop. Re-created if the limit changes
# (e.g., between test runs with different settings).
_ai_semaphore: asyncio.Semaphore | None = None
_ai_semaphore_limit: int = 0


def _get_ai_semaphore(limit: int) -> asyncio.Semaphore:
    """Return (creating if necessary) the module-level AI concurrency semaphore.

    The semaphore is a singleton for the process lifetime. If ``limit`` changes
    (e.g. different settings passed between tests), the semaphore is recreated.
    """
    global _ai_semaphore, _ai_semaphore_limit
    if _ai_semaphore is None or _ai_semaphore_limit != limit:
        _ai_semaphore = asyncio.Semaphore(limit)
        _ai_semaphore_limit = limit
    return _ai_semaphore
```

Replace the current `acquire_guest_ai_slot` function:

```python
async def acquire_guest_ai_slot(settings: Settings, sandbox_id: str) -> bool:
    """Wait for a guest AI concurrency slot, then register it in the DB.

    The ``asyncio.Semaphore`` is the primary gate. When all slots are occupied,
    the coroutine suspends in the event loop and resumes when a slot is freed —
    no polling.  After 60 seconds without a free slot,
    ``GuestConcurrencyTimeoutError`` is raised.

    The DB counter update is monitoring-only: it tracks in-flight requests for
    orphan cleanup. Errors are logged and swallowed so a DB hiccup never blocks
    an AI request that already acquired the semaphore.

    Args:
        settings: Application settings (provides concurrency limit).
        sandbox_id: UUID of the guest sandbox row to increment.

    Returns:
        ``True`` always (the function either returns or raises).

    Raises:
        GuestConcurrencyTimeoutError: When no slot opens within 60 seconds.
    """
    semaphore = _get_ai_semaphore(settings.guest_max_concurrent_ai_requests)
    try:
        await asyncio.wait_for(asyncio.shield(semaphore.acquire()), timeout=60.0)
    except asyncio.TimeoutError as exc:
        raise GuestConcurrencyTimeoutError() from exc

    # DB counter: monitoring only — errors must not propagate.
    try:
        await _service_rpc(
            settings,
            "acquire_guest_ai_slot_service",
            {"p_sandbox_id": sandbox_id, "p_limit": settings.guest_max_concurrent_ai_requests},
            "Failed to acquire guest concurrency slot.",
        )
    except Exception:
        logger.warning(
            "guest_rate_limit: DB slot counter increment failed (semaphore held)",
            exc_info=True,
        )

    return True
```

Replace the current `release_guest_ai_slot` function:

```python
async def release_guest_ai_slot(settings: Settings, sandbox_id: str) -> None:
    """Release a guest AI concurrency slot.

    Releases the ``asyncio.Semaphore`` first (unblocking any waiting coroutines
    immediately), then updates the DB counter.  Always call in a ``finally``
    block and only if ``acquire_guest_ai_slot`` returned successfully.

    Args:
        settings: Application settings (provides Supabase credentials).
        sandbox_id: UUID of the guest sandbox row to decrement.
    """
    semaphore = _get_ai_semaphore(settings.guest_max_concurrent_ai_requests)
    semaphore.release()

    # DB counter: monitoring only — errors must not propagate.
    try:
        await _service_rpc(
            settings,
            "release_guest_ai_slot_service",
            {"p_sandbox_id": sandbox_id},
            "Failed to release guest concurrency slot.",
        )
    except Exception:
        logger.warning(
            "guest_rate_limit: DB slot counter decrement failed",
            exc_info=True,
        )
```

- [ ] **Step 4: Run the new tests to confirm they pass**

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest backend/tests/test_guest_rate_limit.py -v 2>&1 | tail -20
```

Expected: all three new tests PASS. Existing tests may fail (concurrency test needs updating — that is Task 8).

- [ ] **Step 5: Commit**

```bash
git add backend/app/guest_rate_limit.py
git commit -m "feat(guest): replace DB-polling concurrency with asyncio.Semaphore + 60s timeout"
```

---

## Task 7: Backend — main.py: handle GuestConcurrencyTimeoutError

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Import GuestConcurrencyTimeoutError**

In `main.py`, find the import from `app.guest_rate_limit`:

```python
from app.guest_rate_limit import (
    acquire_guest_ai_slot,
    check_guest_ai_access,
    increment_guest_ai_usage,
    release_guest_ai_slot,
)
```

Replace with:

```python
from app.guest_rate_limit import (
    GuestConcurrencyTimeoutError,
    acquire_guest_ai_slot,
    check_guest_ai_access,
    increment_guest_ai_usage,
    release_guest_ai_slot,
)
```

- [ ] **Step 2: Update _enforce_guest_ai_guards to handle timeout**

Find the `try/except/if not acquired` block in `_enforce_guest_ai_guards` (around line 462):

```python
    try:
        acquired = await acquire_guest_ai_slot(settings, sandbox_id)
    except RuntimeError:
        return None, _error_response(
            request,
            status_code=502,
            message="Guest AI quota enforcement is unavailable right now.",
            code="guest_rate_limit_unavailable",
        )

    if not acquired:
        return None, _error_response(
            request,
            status_code=429,
            message=f"Guest concurrent {feature} limit reached.",
            code="guest_concurrent_limit",
        )
```

Replace with:

```python
    try:
        await acquire_guest_ai_slot(settings, sandbox_id)
    except GuestConcurrencyTimeoutError:
        return None, _error_response(
            request,
            status_code=503,
            message="Guest AI requests are busy. Please try again in a moment.",
            code="guest_concurrent_limit",
        )
    except RuntimeError:
        return None, _error_response(
            request,
            status_code=502,
            message="Guest AI quota enforcement is unavailable right now.",
            code="guest_rate_limit_unavailable",
        )
```

(`if not acquired:` is removed — `acquire_guest_ai_slot` now always returns `True` or raises.)

- [ ] **Step 3: Run the full Python test suite**

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_*.py' 2>&1 | tail -30
```

Expected: most tests pass; the concurrency test (`test_guest_chat_rejects_when_concurrency_limit_is_exhausted`) will still fail — fixed in Task 8.

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(guest): handle GuestConcurrencyTimeoutError — return 503 instead of 429"
```

---

## Task 8: Tests — update helpers.py and test_guest_rate_limit.py

**Files:**
- Modify: `backend/tests/helpers.py`
- Modify: `backend/tests/test_guest_rate_limit.py`

- [ ] **Step 1: Update helpers.py make_settings defaults**

In `helpers.py`, replace the base settings values:

```python
        guest_max_concurrent_ai_requests=10,
        guest_chat_limit=50,
        guest_quiz_limit=5,
        guest_flashcards_limit=10,
        guest_blueprint_limit=3,
        guest_embedding_limit=5,
```

With:

```python
        guest_max_concurrent_ai_requests=20,
        guest_chat_limit=50,
        guest_quiz_limit=10,
        guest_flashcards_limit=10,
        guest_blueprint_limit=5,
        guest_embedding_limit=15,
```

- [ ] **Step 2: Update quota boundary assertions in test_guest_rate_limit.py**

`test_per_feature_limits_match_guest_mode_spec` hardcodes the old limits. Update it:

Replace:
```python
    def test_per_feature_limits_match_guest_mode_spec(self) -> None:
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(chat_messages_used=49), "chat"),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(chat_messages_used=50), "chat"),
            (False, "Guest chat limit reached."),
        )

        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(quiz_generations_used=4), "quiz"),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(quiz_generations_used=5), "quiz"),
            (False, "Guest quiz limit reached."),
        )

        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(flashcard_generations_used=9),
                "flashcards",
            ),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(flashcard_generations_used=10),
                "flashcards",
            ),
            (False, "Guest flashcards limit reached."),
        )

        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(blueprint_regenerations_used=2),
                "blueprint",
            ),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(blueprint_regenerations_used=3),
                "blueprint",
            ),
            (False, "Guest blueprint limit reached."),
        )
```

With:
```python
    def test_per_feature_limits_match_guest_mode_spec(self) -> None:
        # chat: limit 50 (unchanged)
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(chat_messages_used=49), "chat"),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(chat_messages_used=50), "chat"),
            (False, "Guest chat limit reached."),
        )

        # quiz: limit 10 (was 5)
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(quiz_generations_used=9), "quiz"),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(self.settings, _guest_sandbox_row(quiz_generations_used=10), "quiz"),
            (False, "Guest quiz limit reached."),
        )

        # flashcards: limit 10 (unchanged)
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(flashcard_generations_used=9),
                "flashcards",
            ),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(flashcard_generations_used=10),
                "flashcards",
            ),
            (False, "Guest flashcards limit reached."),
        )

        # blueprint: limit 5 (was 3)
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(blueprint_regenerations_used=4),
                "blueprint",
            ),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(blueprint_regenerations_used=5),
                "blueprint",
            ),
            (False, "Guest blueprint limit reached."),
        )
```

- [ ] **Step 3: Update embedding quota test**

Replace `test_embedding_uses_guest_quota_limit`:

```python
    def test_embedding_uses_guest_quota_limit(self) -> None:
        # embedding: limit 15 (was 5)
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(embedding_operations_used=14),
                "embedding",
            ),
            (True, None),
        )
        self.assertEqual(
            check_guest_ai_access(
                self.settings,
                _guest_sandbox_row(embedding_operations_used=15),
                "embedding",
            ),
            (False, "Guest embedding limit reached."),
        )
```

- [ ] **Step 4: Fix the concurrency limit test to use GuestConcurrencyTimeoutError**

Replace `test_guest_chat_rejects_when_concurrency_limit_is_exhausted`:

```python
    def test_guest_chat_rejects_when_concurrency_limit_is_exhausted(self) -> None:
        from app.guest_rate_limit import GuestConcurrencyTimeoutError

        async def _raise_timeout(*_args: object, **_kwargs: object) -> bool:
            raise GuestConcurrencyTimeoutError()

        with (
            patch("app.main.get_settings", return_value=self.settings),
            patch("app.main._resolve_actor_user", return_value=(self._guest_actor(), None)),
            patch(
                "app.main._load_guest_sandbox_for_actor",
                return_value=(_guest_sandbox_row(), False),
            ),
            patch("app.main.check_guest_ai_access", return_value=(True, None)),
            patch("app.main.acquire_guest_ai_slot", new=AsyncMock(side_effect=GuestConcurrencyTimeoutError())),
        ):
            response = self.client.post(
                "/v1/chat/generate",
                headers=self._guest_headers(),
                json=self._chat_payload(),
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "guest_concurrent_limit")
```

- [ ] **Step 5: Run the full Python test suite**

```bash
cd /Users/billyfa/COMP3122_ISD_Project && python3 -m unittest discover -s backend/tests -p 'test_*.py' -v 2>&1 | tail -40
```

Expected: all tests pass (including the three new ones from Task 6 Step 1).

- [ ] **Step 6: Commit**

```bash
git add backend/tests/helpers.py backend/tests/test_guest_rate_limit.py
git commit -m "test(guest): update quota limits and concurrency test for redesigned rate limiting"
```

---

## Task 9: Push to both remotes

- [ ] **Step 1: Push to origin and org**

```bash
git push origin HEAD
git push org HEAD
```

Expected: both succeed.

---

## Verification Checklist

After all tasks:

1. **DB schema** — `SELECT * FROM guest_session_quota;` returns one row with `scope='global'`.
2. **Retired tables** — `guest_entry_rate_limits` and `guest_ai_quota_state` do not exist.
3. **Active cap** — Set `UPDATE guest_session_quota SET active_sessions=60;` then attempt `/guest/enter` → should return `?error=too-many-active-sessions`.
4. **Creation rate cap** — Set `UPDATE guest_session_quota SET creation_count=20, creation_window_started_at=now();` then attempt entry → `?error=too-many-new-sessions`.
5. **No IP tracking** — Confirm `entry-rate-limit.ts` is gone. Grep for `getGuestEntryIp` → no matches. Grep for `ipAddress` in `actions.ts` → no matches.
6. **TTL** — Guest sandbox `expires_at` is `32 hours` from creation. `isGuestSandboxExpired` uses 8-hour inactivity threshold.
7. **Feature quotas** — `quiz_generations_used=9` is allowed, `=10` is rejected. `blueprint_regenerations_used=4` allowed, `=5` rejected. `embedding_operations_used=14` allowed, `=15` rejected.
8. **Concurrency queuing** — `acquire_guest_ai_slot` is an async coroutine. Raising `GuestConcurrencyTimeoutError` causes a 503 (not 429) from the chat/quiz/embeddings routes.
9. **Python tests** — `python3 -m unittest discover -s backend/tests -p 'test_*.py'` — all pass.
