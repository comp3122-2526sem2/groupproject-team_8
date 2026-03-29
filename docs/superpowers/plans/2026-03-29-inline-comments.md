# Inline Code Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add A+B+C inline comments (JSDoc/docstrings, section headers, "why" notes) to the 15 highest-complexity files across three layers, delivered as three PRs.

**Architecture:** Three independent subagents run in parallel git worktrees — one per layer (`chore/comments-lib`, `chore/comments-app`, `chore/comments-backend`). Each subagent reads every file in its layer before writing any comments, applies the full A+B+C standard, verifies no logic changed via `git diff`, commits, pushes to both remotes, and opens a PR targeting `main`.

**Tech Stack:** TypeScript (JSDoc `/** */`), Python (Google-style docstrings), Next.js App Router, FastAPI

---

## Comment Standards Reference

Apply all three types to every file. Never add comments to self-evident lines.

### TypeScript

**C — JSDoc on every exported function/type:**
```ts
/**
 * Brief description of what this does.
 *
 * Longer explanation if needed — why this exists, non-obvious behaviour,
 * invariants the caller must preserve.
 *
 * @param name   What this parameter means (not just its type)
 * @returns      What the return value represents
 */
```

**B — Section headers inside long function bodies:**
```ts
// --- Validate attempt limits ---
// --- Build scoring payload ---
// --- Persist and return ---
```

**A — Inline "why" on non-obvious lines:**
```ts
// Offset by 1 ms so assistant message always sorts after user message
// when queries order by created_at (same-tick inserts are ambiguous).
assistantTimestamp = new Date(userTimestamp.getTime() + 1);
```

### Python

**C — Google-style docstrings on every function/class:**
```python
def function_name(param: Type) -> ReturnType:
    """One-line summary.

    Longer explanation if needed.

    Args:
        param: What this parameter means.

    Returns:
        What the return value represents.

    Raises:
        SomeError: When this is raised and why.
    """
```

**B — Numbered section headers (extend `analytics.py`'s existing pattern):**
```python
# --- 1. Guard: check generating flag ---
# --- 2. Load blueprint context ---
```

**A — Inline why-comments:**
```python
# trust_env=False: prevents httpx picking up proxy env vars in
# production, which causes silent connection failures. See CLAUDE.md.
client = httpx.Client(trust_env=False)
```

---

## Guard Rails (apply to all tasks)

- **No logic changes.** If a comment reveals a latent bug, note it in the PR body but do not fix it.
- **No self-evident comments.** `const x = 1` or `return result` need no comment.
- **Preserve existing comments.** Expand them if helpful, but never delete them.

---

## Task 1: Layer 1 — Core Libraries (`chore/comments-lib`)

**Files to modify (read each fully before writing any comments):**
- `web/src/lib/guest/sandbox.ts`
- `web/src/lib/chat/compaction.ts`
- `web/src/lib/chat/context.ts`
- `web/src/lib/ai/blueprint.ts`
- `web/src/lib/ai/python-backend.ts`
- `web/src/lib/auth/session.ts`
- `web/src/lib/materials/chunking.ts`
- `web/src/lib/materials/retrieval.ts`
- `web/src/lib/materials/extract-text.ts`
- `web/src/lib/activities/assignments.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull origin main
git checkout -b chore/comments-lib
```

- [ ] **Step 2: Read all 10 files in full before writing anything**

Read each file completely. Build a mental model of what each function does and why before adding a single comment. Pay special attention to:

- `sandbox.ts` — the 7-state provisioning machine (`existingUser`, `existingUserIsAnonymous`, `existingSandbox`, `isGuestSandboxExpired`, `shouldSignOutOnFailure`), why each branch exists, what the `clone_guest_sandbox` RPC call does differently from a fresh provision, why `discardGuestSandbox` must clean storage as well as the DB row.
- `compaction.ts` — the 6 scoring weights (0.8, 1.5, 1.3, 1.1, 0.7, cap 18) and why each was chosen; the incremental term-frequency merge in `mergeSummary`; the dual trigger (token-pressure AND message-count); why `selectChronologicalHighlights` sorts twice.
- `context.ts` — the two-path blueprint loading (canonical `content_json` vs legacy topic+objective rows fallback) and when each path fires; the `canvas_hint` extension point in `buildChatPrompt`.
- `blueprint.ts` — the DFS cycle detection (`visiting`/`visited` sets, `hasCycle` recursion); the two-pass `extractJsonWithFallback`; `repairJson` curly-quote replacement; near-duplicate title normalisation.
- `python-backend.ts` — the `fetchWithTimeout` abort controller with `didTimeout` flag (why we track `didTimeout` separately from the abort signal); `normalizeAttentionItem` struct-vs-string polymorphism; the snake_case↔camelCase mapping layer.
- `session.ts` — the anonymous-user detection heuristic (what makes a user "anonymous"); the inline guest sandbox expiry+signOut side-effect inside `getAuthContext`; the `requireGuestOrVerifiedUser` fallback chain and why both branches exist.
- `chunking.ts` — the `countOverlapWords` backward scan with cumulative char count; the long-word escape hatch (the `if (!current)` branch that exits the overlap loop); the `safeOverlap = min(overlapWords, maxOverlap)` guard and why it's needed.
- `retrieval.ts` — `DEFAULT_MAX_PER_MATERIAL` cap and why it exists; the greedy token-budget loop with early `break`; why the source-header label format must exactly match citation labels in chat responses.
- `extract-text.ts` — the `pagerender` callback that overrides pdf-parse's default; the de-hyphenation regex `-\n(?=\w)` (what hyphenated line-breaks look like in extracted PDF text); JSZip slide ordering; `[\s\S]*?` lazy XML match.
- `assignments.ts` — the `rollbackAssignment` closure pattern; why a manual rollback is used instead of a DB transaction; the sequencing (assignment insert → recipient insert) and what happens if the second insert fails.

- [ ] **Step 3: Add comments to `web/src/lib/guest/sandbox.ts`**

Apply A+B+C:
- JSDoc on every exported function (`provisionGuestSandbox`, `discardGuestSandbox`, `getOrCreateGuestSandbox`, etc.)
- Section headers to delineate each state-machine branch
- Inline "why" notes on: `shouldSignOutOnFailure` flag assignment, `clone_guest_sandbox` RPC call, storage cleanup steps, anonymous-session checks

- [ ] **Step 4: Add comments to `web/src/lib/chat/compaction.ts`**

Apply A+B+C:
- JSDoc on every exported function
- For the scoring function: a comment block explaining each weight (0.8 = recency decay, 1.5 = user-authored boost, etc. — infer intent from the code)
- Inline "why" on: the dual trigger condition, the `cap of 18` constant, the sort-then-re-sort in `selectChronologicalHighlights`, the TF-merge accumulation loop

- [ ] **Step 5: Add comments to `web/src/lib/chat/context.ts`**

Apply A+B+C:
- JSDoc on every exported function
- Section headers in `buildChatPrompt` to label: blueprint loading, system-prompt construction, canvas hint injection
- Inline "why" on the two-path blueprint loading decision (canonical vs legacy fallback)

- [ ] **Step 6: Add comments to `web/src/lib/ai/blueprint.ts`**

Apply A+B+C:
- JSDoc on every exported function
- Section headers in main generation function to label: prompt construction, JSON extraction, validation, cycle detection
- Inline "why" on: `hasCycle` DFS sets, the two-pass extraction strategy, `repairJson` replacements, contiguous sequence check, near-duplicate normalisation

- [ ] **Step 7: Add comments to `web/src/lib/ai/python-backend.ts`**

Apply A+B+C:
- JSDoc on every exported function
- Inline "why" on: the `didTimeout` flag (why not just check `signal.aborted`), each snake_case↔camelCase mapping, the `normalizeAttentionItem` polymorphism branch

- [ ] **Step 8: Add comments to `web/src/lib/auth/session.ts`**

Apply A+B+C:
- JSDoc on every exported function (`getAuthContext`, `requireGuestOrVerifiedUser`, `requireVerifiedUser`, etc.)
- Inline "why" on: the anonymous-user detection condition, the side-effecting signOut inside `getAuthContext`, the fallback chain order in `requireGuestOrVerifiedUser`

- [ ] **Step 9: Add comments to `web/src/lib/materials/chunking.ts`**

Apply A+B+C:
- JSDoc on every exported function
- Inline "why" on: the backward scan direction in `countOverlapWords`, the long-word `if (!current)` escape hatch, the `safeOverlap` guard

- [ ] **Step 10: Add comments to `web/src/lib/materials/retrieval.ts`**

Apply A+B+C:
- JSDoc on every exported function
- Inline "why" on: the per-material cap purpose, the greedy early-break condition, the source-header label format contract

- [ ] **Step 11: Add comments to `web/src/lib/materials/extract-text.ts`**

Apply A+B+C:
- JSDoc on every exported function
- Inline "why" on: `pagerender` override (why the default is insufficient), the de-hyphenation regex, slide ordering logic, the `[\s\S]*?` lazy flag

- [ ] **Step 12: Add comments to `web/src/lib/activities/assignments.ts`**

Apply A+B+C:
- JSDoc on every exported function
- Section headers in `createWholeClassAssignment`: setup, assignment insert, recipient insert, rollback handler
- Inline "why" on: the manual rollback closure pattern, why a DB transaction is not used

- [ ] **Step 13: Verify no logic was changed**

```bash
git diff --stat
```

Review every hunk in the diff. Comments and blank lines only. If any non-comment line changed, revert it.

- [ ] **Step 14: Commit**

```bash
git add web/src/lib/guest/sandbox.ts \
        web/src/lib/chat/compaction.ts \
        web/src/lib/chat/context.ts \
        web/src/lib/ai/blueprint.ts \
        web/src/lib/ai/python-backend.ts \
        web/src/lib/auth/session.ts \
        web/src/lib/materials/chunking.ts \
        web/src/lib/materials/retrieval.ts \
        web/src/lib/materials/extract-text.ts \
        web/src/lib/activities/assignments.ts

git commit -m "$(cat <<'EOF'
chore(comments): add inline documentation to lib/ core modules

Adds JSDoc, section headers, and why-comments to all 10 priority files
in web/src/lib/. No logic changes.

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 15: Push to both remotes**

```bash
git push -u origin chore/comments-lib
git push org chore/comments-lib
```

- [ ] **Step 16: Open PR**

```bash
gh pr create \
  --title "chore: add inline comments to lib/ layer" \
  --base main \
  --body "$(cat <<'EOF'
## Summary

Adds A+B+C inline documentation (JSDoc, section headers, why-comments) to 10 high-complexity files in `web/src/lib/` with near-zero comment coverage.

### Files documented
- `lib/guest/sandbox.ts` — 7-state provisioning machine, `shouldSignOutOnFailure` flag
- `lib/chat/compaction.ts` — scoring weights, TF-merge, dual trigger
- `lib/chat/context.ts` — two-path blueprint loading, `buildChatPrompt`
- `lib/ai/blueprint.ts` — DAG cycle detection, `extractJsonWithFallback`
- `lib/ai/python-backend.ts` — abort controller, snake_case↔camelCase mapping
- `lib/auth/session.ts` — anonymous-user detection, `requireGuestOrVerifiedUser`
- `lib/materials/chunking.ts` — backward overlap scan, long-word escape hatch
- `lib/materials/retrieval.ts` — per-material cap, greedy token-budget loop
- `lib/materials/extract-text.ts` — `pagerender` override, de-hyphenation regex
- `lib/activities/assignments.ts` — rollback closure, transactional semantics

**No logic changes.** Comments only.
EOF
)"
```

---

## Task 2: Layer 2 — Server Actions (`chore/comments-app`)

**Files to modify:**
- `web/src/app/actions.ts`
- `web/src/app/classes/[classId]/quiz/actions.ts`
- `web/src/app/classes/[classId]/chat/actions.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull origin main
git checkout -b chore/comments-app
```

- [ ] **Step 2: Read all 3 files in full before writing anything**

Pay special attention to:

- `app/actions.ts` — the `buildResendStateParams` function and its dual `verify`/`sent` field encoding (why two fields?); `isEmailAlreadyRegisteredError` and which error codes it must union; the guest→real-account sequence (why discard sandbox AND sign out before creating the real account — what redirect loop does this prevent?). The existing comment at the `signOut` call is a starting point.
- `quiz/actions.ts` — the attempt-limit enforcement path (what happens when a student hits the limit); the code-23505 duplicate-submission handler (what race condition does this guard?); `trimStaleQuestions` and why it deletes by `order_index` rather than by ID; the `savingPolicy`/`revealPolicy` hardcoded values and what they control; the `bestScore` computation (is it max, most recent, or something else?).
- `chat/actions.ts` — the `submitChatAssignment` upsert-vs-insert logic (when does it upsert vs insert?); `reviewChatSubmission` permission check sequence; `sendAssignmentMessage` transcript parsing (what format is the transcript in?).

- [ ] **Step 3: Add comments to `web/src/app/actions.ts`**

Apply A+B+C:
- JSDoc on every exported server action
- Section headers in `signUp`: guest session cleanup, sign-out, account creation, redirect
- Inline "why" on: `buildResendStateParams` field encoding, `isEmailAlreadyRegisteredError` code list, the guest sandbox discard before sign-out
- Preserve and optionally expand the existing comment near the `signOut` call

- [ ] **Step 4: Add comments to `web/src/app/classes/[classId]/quiz/actions.ts`**

Apply A+B+C:
- JSDoc on every exported server action
- Section headers inside `submitQuizAttempt`: auth, attempt-limit check, answer validation, scoring, persistence
- Section headers inside `generateQuizQuestions`: blueprint loading, topic scoping, AI call, validation, persistence
- Inline "why" on: attempt-limit enforcement, code-23505 handler (the race condition it prevents), `trimStaleQuestions` delete-by-order_index rationale, `savingPolicy`/`revealPolicy` semantics, `bestScore` aggregation logic
- Preserve and optionally expand the existing `23505` and `// Optional topic scoping` comments

- [ ] **Step 5: Add comments to `web/src/app/classes/[classId]/chat/actions.ts`**

Apply A+B+C:
- JSDoc on every exported server action
- Section headers inside `sendAssignmentMessage`: auth, thread resolution, message append, AI call, transcript update
- Section headers inside `submitChatAssignment`: auth, upsert logic, status update
- Inline "why" on: the upsert-vs-insert decision, permission check ordering, transcript parsing format

- [ ] **Step 6: Verify no logic was changed**

```bash
git diff --stat
```

Review every hunk. Comments and blank lines only.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/actions.ts \
        "web/src/app/classes/[classId]/quiz/actions.ts" \
        "web/src/app/classes/[classId]/chat/actions.ts"

git commit -m "$(cat <<'EOF'
chore(comments): add inline documentation to app/ server actions

Adds JSDoc, section headers, and why-comments to the 3 highest-complexity
server action files. No logic changes.

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Push to both remotes**

```bash
git push -u origin chore/comments-app
git push org chore/comments-app
```

- [ ] **Step 9: Open PR**

```bash
gh pr create \
  --title "chore: add inline comments to app/ server actions layer" \
  --base main \
  --body "$(cat <<'EOF'
## Summary

Adds A+B+C inline documentation (JSDoc, section headers, why-comments) to 3 high-complexity server action files in `web/src/app/`.

### Files documented
- `app/actions.ts` — `buildResendStateParams` encoding, multi-code error union, guest→real-account sequence
- `app/classes/[classId]/quiz/actions.ts` — attempt limits, 23505 race condition, `trimStaleQuestions`, score computation
- `app/classes/[classId]/chat/actions.ts` — upsert-vs-insert logic, permission checks, transcript parsing

**No logic changes.** Comments only.
EOF
)"
```

---

## Task 3: Layer 3 — Python Backend (`chore/comments-backend`)

**Files to modify:**
- `backend/app/chat.py`
- `backend/app/analytics.py`
- `backend/app/providers.py`

- [ ] **Step 1: Create branch**

```bash
git checkout main
git pull origin main
git checkout -b chore/comments-backend
```

- [ ] **Step 2: Read all 3 files in full before writing anything**

Pay special attention to:

- `chat.py` — the LangGraph vs `direct_v1` fallback (what triggers each path?); the `_LANGGRAPH_CHECKPOINTER`/`_LANGGRAPH_STORE` module-level singletons (why module-level? what's the lifecycle?); `resolve_thread_id` deterministic hash (why SHA-256 truncated to 16 chars?); the `extract_json_object_candidates` hand-rolled FSM (what are the states?); the dual `usage_metadata`/`response_metadata` normalisation (why two paths for the same data?).
- `analytics.py` — the `_mark_teaching_brief_generating` CAS pattern (what race does it prevent? what happens if two requests arrive simultaneously?); the `is_stale`/`force_refresh`/`generating` state machine in `get_class_teaching_brief` (draw the state transitions in a comment block); `INSIGHTS_CACHE_TTL_SECONDS` vs `_is_same_utc_day` dual freshness (why two different freshness strategies?); Bloom cross-join scoring (what does a "Bloom level" represent here?); best-score denominator (what is it a denominator of?). Preserve and extend the existing numbered step headers — do not replace them, add to them.
- `providers.py` — the deadline-based `_remaining_timeout_ms` (how is the deadline set, how is remaining calculated?); the provider priority override algorithm (what does "override" mean — user-configured or environment-driven?); `_normalize_chat_content` list-of-blocks handling (what formats are normalised?); Gemini `batchEmbedContents` vs OpenAI `embeddings` shape differences.

- [ ] **Step 3: Add comments to `backend/app/chat.py`**

Apply A+B+C:
- Google-style docstrings on every function and class
- Section headers in the main chat handler: route guard, thread resolution, context loading, AI dispatch, response normalisation
- Inline "why" on: LangGraph vs direct_v1 decision point, module-level singleton rationale, `resolve_thread_id` hash choice, FSM state transitions in `extract_json_object_candidates`, dual metadata normalisation paths

- [ ] **Step 4: Add comments to `backend/app/analytics.py`**

Apply A+B+C:
- Google-style docstrings on all functions that lack them (existing one-liners can be expanded)
- Extend (do not replace) the existing `# --- N. Step ---` headers — add sub-headers where a step is itself complex
- Add a state-transition comment block above `get_class_teaching_brief` explaining the `is_stale`/`force_refresh`/`generating` machine:

```python
# State machine for teaching brief freshness:
#
#   generating=True  →  return 202 (another request is building it)
#   force_refresh    →  bypass cache, rebuild unconditionally
#   is_stale         →  rebuild (TTL expired or day boundary crossed)
#   else             →  return cached snapshot
```

- Inline "why" on: the CAS race guard in `_mark_teaching_brief_generating`, dual freshness strategy rationale, Bloom cross-join query shape, best-score denominator meaning

- [ ] **Step 5: Add comments to `backend/app/providers.py`**

Apply A+B+C:
- Google-style docstrings on every function and class
- Section headers in the main provider dispatch function: deadline setup, provider resolution, model call, response normalisation
- Inline "why" on: `_remaining_timeout_ms` calculation, provider priority override logic, `_normalize_chat_content` format list, Gemini-specific field names (`batchEmbedContents`, `candidatesTokenCount`)

- [ ] **Step 6: Verify no logic was changed**

```bash
git diff --stat
```

Review every hunk. Comments, docstrings, and blank lines only.

- [ ] **Step 7: Commit**

```bash
git add backend/app/chat.py \
        backend/app/analytics.py \
        backend/app/providers.py

git commit -m "$(cat <<'EOF'
chore(comments): add inline documentation to backend/ Python service

Adds Google-style docstrings, section headers, and why-comments to the
3 highest-complexity Python files. No logic changes.

Co-Authored-By: Claude Sonnet 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Push to both remotes**

```bash
git push -u origin chore/comments-backend
git push org chore/comments-backend
```

- [ ] **Step 9: Open PR**

```bash
gh pr create \
  --title "chore: add inline comments to backend/ Python service layer" \
  --base main \
  --body "$(cat <<'EOF'
## Summary

Adds A+B+C inline documentation (Google-style docstrings, section headers, why-comments) to 3 high-complexity Python files in `backend/app/`.

### Files documented
- `chat.py` — LangGraph vs direct fallback, `resolve_thread_id` hash, hand-rolled FSM, dual metadata normalisation
- `analytics.py` — CAS race guard, `is_stale`/`force_refresh`/`generating` state machine, Bloom scoring, dual freshness strategies
- `providers.py` — deadline timeout, provider priority algorithm, `_normalize_chat_content`, Gemini API shape differences

**No logic changes.** Comments only.
EOF
)"
```

---

## Merge Order

The three PRs are independent and can be merged in any order. Suggested order: lib/ → app/ → backend/ (largest to smallest change set, easiest review warm-up).
