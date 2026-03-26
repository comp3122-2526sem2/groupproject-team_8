# Guest Mode Cleanup Design

**Date:** 2026-03-26
**Scope:** Guest sandbox expiry and cleanup under deployment constraints
**Related plan:** `docs/superpowers/plans/2026-03-26-guest-mode-implementation.md`

## Goal

Design a cleanup strategy for guest sandboxes that remains correct under Vercel free-plan limits, where frequent Vercel cron execution is not available.

## Constraint

Vercel free plan effectively cannot be used for frequent guest sandbox cleanup because it allows only one cron job per 24 hours. Supabase free plan has more generous scheduling limits, but scheduled jobs still have bounded runtime.

## Decision

Use **request-time expiry enforcement as the authoritative mechanism** and **Supabase-native scheduled cleanup as best-effort hygiene**.

This means guest sessions become unusable immediately when expired, even if background cleanup is delayed or fails. Background cleanup exists to reclaim storage/auth rows and reduce table growth, not to enforce correctness.

## Architecture

### Layer A — authoritative request-time expiry enforcement

Implemented in `web/middleware.ts`.

Behavior:
- On protected guest requests, load the active sandbox for the current anonymous user.
- Reject if no active sandbox exists.
- Reject if `expires_at` has passed.
- Reject if `last_seen_at` exceeds the inactivity window.
- Sign out the anonymous user and redirect to the homepage when expired.

This layer guarantees that stale tabs and expired guest sessions cannot continue using the sandbox.

### Layer B — asynchronous hygiene cleanup

Implemented using Supabase-native scheduling rather than Vercel cron.

Behavior:
- Periodically select expired or discarded guest sandboxes.
- Process only a bounded batch each run.
- Delete sandbox-scoped data.
- Delete anonymous auth users.
- Leave any remaining work for future runs.

This layer is operational hygiene only. It is not part of correctness.

## Cleanup batching strategy

The cleanup job must be bounded and retry-safe.

Recommended behavior:
- Process sandboxes in deterministic order, oldest first.
- Limit each run to a fixed batch size, e.g. 25–50 sandboxes.
- Exit after the batch completes.
- Rely on subsequent runs to continue draining backlog.

Rationale:
- Fits within limited scheduled runtime.
- Prevents cleanup spikes.
- Keeps cleanup predictable on free-plan infrastructure.

## State model

Guest sandboxes use these states:
- `active`
- `expired`
- `discarded`

Rules:
- Middleware treats `expired` and inactive guest sessions as invalid immediately.
- Cleanup job physically removes rows only for `expired` and `discarded` sandboxes.
- Cleanup must ignore or safely handle already-deleted resources.

## Failure handling

Cleanup must be idempotent.

Requirements:
- Re-running cleanup on the same sandbox must be safe.
- Already-deleted sandbox rows or anonymous users must not make the job fail permanently.
- Partial cleanup must be recoverable by the next scheduled run.

This avoids depending on exactly-once execution.

## Verification strategy

### 1. Correctness without scheduler
- Expired guest session is blocked in middleware.
- Guest user is signed out and redirected.
- Expired sandbox cannot be reused from stale tabs.

### 2. Bounded scheduled cleanup
- Cleanup processes no more than the configured batch size.
- It reports how many sandboxes were cleaned.
- It leaves additional expired rows for future runs.

### 3. Retry safety
- Running cleanup twice should not break on previously deleted guest data.
- Partial cleanup should be safely recoverable.

## Implementation guidance

1. Keep middleware expiry enforcement as the primary validity check.
2. Prefer Supabase-native scheduling for cleanup execution.
3. Do not rely on Vercel cron for guest lifecycle correctness.
4. Ensure cleanup functions are bounded, ordered, and idempotent.

## Plan impact

This supersedes the original assumption that guest cleanup should run every 15 minutes via generic cron.

Updated interpretation:
- Middleware guarantees guest expiry correctness.
- Supabase-native scheduled cleanup handles bounded hygiene cleanup.
- Vercel cron is not used as the primary guest cleanup mechanism.
