# Settings Password: OTP Reauthentication Flow

## Goal

Fix the Change Password form in Settings so it (1) shows a reveal toggle on the current-password field, and (2) requires email-based OTP verification before the password changes — using Supabase's `reauthenticate()` + `updateUser({ password, nonce })` flow instead of calling `updateUser` directly.

## Context & Motivation

The current Settings password form calls `updateUser({ password })` directly after verifying the current password. This bypasses any email confirmation, meaning a compromised session can silently change the password. The fix introduces a two-step flow: verify current password → receive OTP via email → enter OTP + new password → password changes.

This is distinct from the "forgot password" recovery flow (`resetPasswordForEmail` → email link → `/reset-password` page), which remains unchanged.

## Architecture

### User Flow

**Step 1** — `/settings?section=password` (default):
- Single field: current password with `PasswordInput` (reveal toggle)
- Button: "Verify & send code"
- Server action `verifyAndSendOtp`: verifies password via `signInWithPassword`, calls `reauthenticate()`, redirects to `?section=password&step=otp`

**Step 2** — `/settings?section=password&step=otp`:
- Success alert: "Verification code sent to your email."
- OTP input: 6 separate boxes (`input-otp` package)
- New password + Confirm password (both with `PasswordInput` reveal toggle)
- Password policy hint text
- Button: "Change password" + "Cancel" link (resets to Step 1)
- Server action `changePasswordWithOtp`: validates inputs, calls `updateUser({ password, nonce })`, redirects with success

### URL-Driven Step Switching

The Settings page (Server Component) reads `step` from search params:
- `step` absent or not `"otp"` → renders Step 1 form
- `step === "otp"` → renders Step 2 form

Both steps render within the same `<Card>`. No client-side state management needed — steps are driven entirely by URL search params and server action redirects.

### Server Actions

Two actions replace the current `changePassword`:

1. **`verifyAndSendOtp(formData)`**
   - Reads `current_password`
   - Validates non-empty
   - `getUser()` → get email
   - `signInWithPassword({ email, password })` → verify identity
   - `reauthenticate()` → sends OTP to email
   - Redirects to `/settings?section=password&step=otp&status=success&message=Verification code sent to your email.`

2. **`changePasswordWithOtp(formData)`**
   - Reads `otp`, `new_password`, `confirm_password`
   - Validates: OTP non-empty (6 chars), password policy, passwords match
   - `updateUser({ password: newPassword, nonce: otp })`
   - Success: redirects to `/settings?section=password&status=success&message=Password changed successfully.`
   - Error: redirects to `/settings?section=password&step=otp&status=error&message=...`

### Supabase Configuration

- `secure_password_change` stays `false` in `supabase/config.toml`
- OTP enforcement is application-level only (our server actions always call `reauthenticate()` + require nonce)
- This avoids breaking the existing forgot-password recovery flow, which calls `updateUser({ password })` without a nonce in `completePasswordRecovery`

### New Components

**`OtpInput`** (`web/src/components/ui/otp-input.tsx`):
- `"use client"` component wrapping the `input-otp` npm package
- 6 slots, alphanumeric, styled to match design system (warm border `#c06a4f` on active, `rounded-xl`, monospace font)
- Renders as a hidden `<input name="otp">` for form submission compatibility with server actions

### New Email Template

**`supabase/templates/reauthentication.html`**:
- Branded template matching `recovery.html` style (warm header bar, rounded card, Supabase/Vercel/PolyU footer)
- Displays `{{ .Token }}` (6-digit OTP) prominently instead of a link/button
- Copy: "Use this code to confirm your password change"
- Applied to Supabase Dashboard → Authentication → Email → Reauthentication

### Error Handling

**Step 1 errors** (redirect back to Step 1):
- Empty current password → "Enter your current password."
- Not authenticated → redirect to `/login`
- Wrong current password → "Current password is incorrect."
- `reauthenticate()` fails → surface Supabase error message

**Step 2 errors** (redirect back to Step 2):
- Empty/incomplete OTP → "Enter the 6-digit verification code."
- Weak new password → password policy error via `validatePasswordPolicy`
- Passwords don't match → "New password confirmation does not match."
- Invalid/expired nonce → surface Supabase error message
- Not authenticated → redirect to `/login`

**Edge cases**:
- Direct navigation to `?step=otp` without Step 1: form renders, but submit fails with invalid nonce error. Cancel returns to Step 1.
- OTP expires (24h default): `updateUser` fails → error message → Cancel and restart.
- Browser back after success: harmless re-display from search params, no double-submit.

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Modify** | `web/src/app/settings/actions.ts` | Replace `changePassword` with `verifyAndSendOtp` + `changePasswordWithOtp` |
| **Modify** | `web/src/app/settings/actions.test.ts` | Rewrite tests for both new actions |
| **Modify** | `web/src/app/settings/page.tsx` | Step-driven rendering, `PasswordInput` on Step 1, OTP + password form on Step 2 |
| **Modify** | `web/package.json` | Add `input-otp` dependency |
| **Create** | `web/src/components/ui/otp-input.tsx` | `"use client"` wrapper around `input-otp` |
| **Create** | `supabase/templates/reauthentication.html` | Branded OTP email template |

**No changes needed:**
- `supabase/config.toml` — `secure_password_change` stays `false`
- `/auth/confirm` route — not involved (OTP entered inline)
- `/reset-password` page — recovery flow stays independent
- `completePasswordRecovery` action — unchanged

## Test Plan

**Unit tests** (`actions.test.ts`):
- `verifyAndSendOtp`: missing password, unauthenticated, wrong password, reauthenticate failure, success (sends OTP + redirects)
- `changePasswordWithOtp`: missing OTP, weak password, mismatch, invalid nonce error, success (password changed + redirects)

**Existing tests** — must continue to pass:
- `password-input.test.tsx`
- All other Vitest tests

**Manual verification**:
- Reauthentication email template renders correctly in Supabase Dashboard preview
- Full flow works end-to-end on deployed preview

## Tech Stack

- Next.js App Router (Server Component + Server Actions)
- `PasswordInput` (existing component)
- `input-otp` (new npm dependency)
- `validatePasswordPolicy` (existing)
- `getAuthRedirectUrl` — **not used** (no email links in this flow)
- Vitest for unit tests
