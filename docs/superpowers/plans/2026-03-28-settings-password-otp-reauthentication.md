# Settings Password OTP Reauthentication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct `updateUser` password change in Settings with a two-step OTP reauthentication flow: verify current password → receive email OTP → enter OTP + new password → password changes.

**Architecture:** The Settings page (Server Component) uses URL search params (`step=otp`) to switch between Step 1 (current password) and Step 2 (OTP + new password). Two server actions (`verifyAndSendOtp`, `changePasswordWithOtp`) handle each step. A new `OtpInput` client component wraps the `input-otp` package. A branded email template is created for the Supabase Reauthentication slot.

**Tech Stack:** Next.js App Router (Server Component + Server Actions), `input-otp`, `PasswordInput` (existing), `validatePasswordPolicy` (existing), Vitest

**Spec:** `docs/superpowers/specs/2026-03-28-settings-password-otp-reauthentication.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `web/src/components/ui/otp-input.tsx` | `"use client"` wrapper around `input-otp`, 6-slot alphanumeric input styled to design system |
| **Create** | `web/src/components/ui/otp-input.test.tsx` | Unit tests for OtpInput rendering and hidden input |
| **Create** | `supabase/templates/reauthentication.html` | Branded OTP email template for Supabase Reauthentication slot |
| **Modify** | `web/src/app/settings/actions.ts` | Replace `changePassword` with `verifyAndSendOtp` + `changePasswordWithOtp` |
| **Modify** | `web/src/app/settings/actions.test.ts` | Rewrite tests for both new actions |
| **Modify** | `web/src/app/settings/page.tsx` | Step-driven rendering: Step 1 (PasswordInput) / Step 2 (OtpInput + PasswordInput × 2) |

---

## Task 1: Install `input-otp` Dependency

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1.1 — Install the package**

```bash
cd web && pnpm add input-otp
```

- [ ] **Step 1.2 — Verify installation**

```bash
cd web && pnpm list input-otp
```

Expected: `input-otp` appears in the dependency list.

- [ ] **Step 1.3 — Commit**

```bash
git add web/package.json web/pnpm-lock.yaml
git commit -m "chore: add input-otp dependency for OTP reauthentication"
```

---

## Task 2: Create `OtpInput` Component (TDD)

**Files:**
- Create: `web/src/components/ui/otp-input.tsx`
- Create: `web/src/components/ui/otp-input.test.tsx`

### Step 2.1 — Write the test file

Create `web/src/components/ui/otp-input.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { OtpInput } from "@/components/ui/otp-input";

describe("OtpInput", () => {
  it("renders 6 slot containers", () => {
    const { container } = render(<OtpInput name="otp" />);
    const slots = container.querySelectorAll("[data-slot='otp-slot']");
    expect(slots.length).toBe(6);
  });

  it("passes the name prop to the underlying input", () => {
    render(<OtpInput name="verification_code" />);
    const input = document.querySelector("input[name='verification_code']");
    expect(input).not.toBeNull();
  });

  it("applies the disabled state", () => {
    render(<OtpInput name="otp" disabled />);
    const input = document.querySelector("input[data-input-otp]") as HTMLInputElement;
    expect(input?.disabled).toBe(true);
  });
});
```

### Step 2.2 — Run tests to verify they fail

```bash
pnpm vitest run web/src/components/ui/otp-input.test.tsx
```

Expected: FAIL — module `@/components/ui/otp-input` not found.

### Step 2.3 — Implement the `OtpInput` component

Create `web/src/components/ui/otp-input.tsx`:

```typescript
"use client";

import { OTPInput, type SlotProps } from "input-otp";
import { cn } from "@/lib/utils";

type OtpInputProps = {
  name: string;
  disabled?: boolean;
  className?: string;
};

function Slot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div
      data-slot="otp-slot"
      className={cn(
        "relative flex h-12 w-11 items-center justify-center rounded-xl border-2 text-lg font-semibold font-mono transition-all",
        isActive
          ? "border-primary ring-2 ring-ring ring-offset-2"
          : "border-default",
      )}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-pulse bg-foreground" />
        </div>
      )}
    </div>
  );
}

function OtpInput({ name, disabled, className }: OtpInputProps) {
  return (
    <OTPInput
      name={name}
      maxLength={6}
      inputMode="text"
      disabled={disabled}
      pushPasswordManagerStrategy="none"
      containerClassName={cn("flex items-center gap-2", className)}
      render={({ slots }) => (
        <>
          {slots.map((slot, idx) => (
            <Slot key={idx} {...slot} />
          ))}
        </>
      )}
    />
  );
}

export { OtpInput };
```

### Step 2.4 — Run tests to verify they pass

```bash
pnpm vitest run web/src/components/ui/otp-input.test.tsx
```

Expected: 3 tests PASS.

### Step 2.5 — Commit

```bash
git add web/src/components/ui/otp-input.tsx web/src/components/ui/otp-input.test.tsx
git commit -m "feat(ui): add OtpInput component wrapping input-otp"
```

---

## Task 3: Create Reauthentication Email Template

**Files:**
- Create: `supabase/templates/reauthentication.html`

### Step 3.1 — Create the branded email template

Create `supabase/templates/reauthentication.html`. This matches the `recovery.html` layout but displays the `{{ .Token }}` OTP code instead of a link:

```html
<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Your verification code — STEM Learning Platform</title>
  </head>
  <body
    style="
      margin: 0;
      padding: 0;
      background-color: #f4eee6;
      color: #141413;
      font-family: 'Open Sans', Arial, sans-serif;
    "
  >
    <div
      style="
        display: none;
        max-height: 0;
        overflow: hidden;
        opacity: 0;
        mso-hide: all;
      "
    >
      Your STEM Learning Platform verification code.
    </div>

    <table
      role="presentation"
      width="100%"
      cellspacing="0"
      cellpadding="0"
      border="0"
      style="width: 100%; border-collapse: collapse; background-color: #f4eee6"
    >
      <tr>
        <td align="center" style="padding: 36px 18px">
          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            border="0"
            style="max-width: 600px; border-collapse: collapse"
          >
            <tr>
              <td
                style="
                  border-radius: 28px;
                  background-color: #fffaf6;
                  border: 1px solid #e8ddd2;
                  overflow: hidden;
                  box-shadow: 0 18px 40px rgba(20, 20, 19, 0.08);
                "
              >
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  border="0"
                  style="border-collapse: collapse"
                >
                  <tr>
                    <td
                      style="
                        padding: 18px 28px;
                        background-color: #c06a4f;
                        color: #fff8f3;
                        font-family: Poppins, 'Trebuchet MS', Arial, sans-serif;
                        font-size: 13px;
                        line-height: 18px;
                        letter-spacing: 0.18em;
                        text-transform: uppercase;
                        font-weight: 700;
                      "
                    >
                      STEM Learning Platform
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 34px 28px 18px 28px; background-color: #fffaf6">
                      <table
                        role="presentation"
                        width="100%"
                        cellspacing="0"
                        cellpadding="0"
                        border="0"
                        style="border-collapse: collapse"
                      >
                        <tr>
                          <td
                            style="
                              font-family: Poppins, 'Trebuchet MS', Arial, sans-serif;
                              font-size: 32px;
                              line-height: 38px;
                              font-weight: 600;
                              color: #141413;
                              padding: 0 0 14px 0;
                            "
                          >
                            Verification code
                          </td>
                        </tr>
                        <tr>
                          <td
                            style="
                              font-size: 16px;
                              line-height: 26px;
                              color: #4a4740;
                              padding: 0 0 24px 0;
                            "
                          >
                            Use the code below to confirm your password change on the STEM Learning Platform. If you didn't request this, you can safely ignore this email.
                          </td>
                        </tr>
                        <tr>
                          <td align="center" style="padding: 0 0 8px 0">
                            <div
                              style="
                                display: inline-block;
                                padding: 16px 32px;
                                border-radius: 16px;
                                background-color: #fdf1ec;
                                border: 2px solid #e8ddd2;
                                font-family: 'Courier New', Courier, monospace;
                                font-size: 36px;
                                line-height: 36px;
                                font-weight: 700;
                                letter-spacing: 0.3em;
                                color: #8b4631;
                              "
                            >
                              {{ .Token }}
                            </div>
                          </td>
                        </tr>
                        <tr>
                          <td
                            align="center"
                            style="
                              padding: 0 0 28px 0;
                              font-size: 13px;
                              line-height: 22px;
                              color: #6e695f;
                            "
                          >
                            This code expires in 24 hours.
                          </td>
                        </tr>
                        <tr>
                          <td
                            style="
                              border-top: 1px solid #ece2d8;
                              padding: 22px 0 0 0;
                            "
                          >
                            <table
                              role="presentation"
                              width="100%"
                              cellspacing="0"
                              cellpadding="0"
                              border="0"
                              style="border-collapse: collapse"
                            >
                              <tr>
                                <td
                                  align="center"
                                  style="
                                    padding: 0 0 10px 0;
                                    font-family: Poppins, 'Trebuchet MS', Arial, sans-serif;
                                    font-size: 10px;
                                    line-height: 14px;
                                    letter-spacing: 0.1em;
                                    text-transform: uppercase;
                                    color: #7c786f;
                                  "
                                >
                                  Powered by
                                </td>
                              </tr>
                              <tr>
                                <td align="center">
                                  <table
                                    role="presentation"
                                    cellspacing="0"
                                    cellpadding="0"
                                    border="0"
                                    style="border-collapse: collapse; margin: 0 auto"
                                  >
                                    <tr>
                                      <td align="center" valign="middle" style="padding: 0 10px 0 0">
                                        <img
                                          src="{{ .SiteURL }}/email/supabase-wordmark-light.png"
                                          alt="Supabase"
                                          width="78"
                                          style="display: block; width: 78px; height: auto; border: 0"
                                        />
                                      </td>
                                      <td align="center" valign="middle" style="padding: 0 10px">
                                        <img
                                          src="{{ .SiteURL }}/email/vercel-logotype-light.png"
                                          alt="Vercel"
                                          width="68"
                                          style="display: block; width: 68px; height: auto; border: 0"
                                        />
                                      </td>
                                      <td align="center" valign="middle" style="padding: 0 0 0 10px">
                                        <img
                                          src="{{ .SiteURL }}/email/polyu-logo.png"
                                          alt="The Hong Kong Polytechnic University"
                                          width="22"
                                          style="display: block; width: 22px; height: auto; border: 0"
                                        />
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td
                style="
                  padding: 16px 8px 0 8px;
                  font-size: 12px;
                  line-height: 18px;
                  color: #7c786f;
                  text-align: center;
                "
              >
                This code was requested for {{ .Email }}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

### Step 3.2 — Commit

```bash
git add supabase/templates/reauthentication.html
git commit -m "feat(email): add branded reauthentication OTP email template"
```

### Step 3.3 — Apply template in Supabase Dashboard

**Manual step:** Copy the contents of `supabase/templates/reauthentication.html` into the Supabase Dashboard → Authentication → Email Templates → Reauthentication. Preview the email to verify it renders correctly.

---

## Task 4: Rewrite Server Actions (TDD)

**Files:**
- Modify: `web/src/app/settings/actions.ts`
- Modify: `web/src/app/settings/actions.test.ts`

### Step 4.1 — Rewrite the test file

Replace the full contents of `web/src/app/settings/actions.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT") as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

const supabaseAuth = {
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  reauthenticate: vi.fn(),
  updateUser: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: supabaseAuth,
  }),
}));

function settingsPath(
  status: "success" | "error",
  message?: string,
  step?: string,
) {
  const search = new URLSearchParams({ section: "password", status });
  if (message) {
    search.set("message", message);
  }
  if (step) {
    search.set("step", step);
  }
  return `/settings?${search.toString()}`;
}

async function expectRedirect(
  action: () => Promise<void> | void,
  path: string,
) {
  try {
    await Promise.resolve().then(action);
    throw new Error("Expected redirect");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      expect(String((error as { digest?: string }).digest)).toContain(
        `;${path};`,
      );
      return;
    }
    throw error;
  }
}

describe("verifyAndSendOtp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing current password", async () => {
    const { verifyAndSendOtp } = await import("@/app/settings/actions");
    const formData = new FormData();

    await expectRedirect(
      () => verifyAndSendOtp(formData),
      settingsPath("error", "Enter your current password."),
    );
    expect(supabaseAuth.getUser).not.toHaveBeenCalled();
  });

  it("redirects to login when user is not authenticated", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const { verifyAndSendOtp } = await import("@/app/settings/actions");
    const formData = new FormData();
    formData.set("current_password", "Oldpass1");

    await expectRedirect(() => verifyAndSendOtp(formData), "/login");
  });

  it("rejects incorrect current password", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({
      data: { user: { email: "teacher@example.com" } },
    });
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({
      error: { message: "Invalid credentials" },
    });

    const { verifyAndSendOtp } = await import("@/app/settings/actions");
    const formData = new FormData();
    formData.set("current_password", "WrongPass1");

    await expectRedirect(
      () => verifyAndSendOtp(formData),
      settingsPath("error", "Current password is incorrect."),
    );
    expect(supabaseAuth.reauthenticate).not.toHaveBeenCalled();
  });

  it("surfaces reauthenticate errors", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({
      data: { user: { email: "teacher@example.com" } },
    });
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({ error: null });
    supabaseAuth.reauthenticate.mockResolvedValueOnce({
      error: { message: "Email rate limit exceeded." },
    });

    const { verifyAndSendOtp } = await import("@/app/settings/actions");
    const formData = new FormData();
    formData.set("current_password", "Oldpass1");

    await expectRedirect(
      () => verifyAndSendOtp(formData),
      settingsPath("error", "Email rate limit exceeded."),
    );
  });

  it("sends OTP after current password verified", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({
      data: { user: { email: "teacher@example.com" } },
    });
    supabaseAuth.signInWithPassword.mockResolvedValueOnce({ error: null });
    supabaseAuth.reauthenticate.mockResolvedValueOnce({ error: null });

    const { verifyAndSendOtp } = await import("@/app/settings/actions");
    const formData = new FormData();
    formData.set("current_password", "Oldpass1");

    await expectRedirect(
      () => verifyAndSendOtp(formData),
      settingsPath(
        "success",
        "Verification code sent to your email.",
        "otp",
      ),
    );
    expect(supabaseAuth.signInWithPassword).toHaveBeenCalledWith({
      email: "teacher@example.com",
      password: "Oldpass1",
    });
    expect(supabaseAuth.reauthenticate).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalled();
  });
});

describe("changePasswordWithOtp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing OTP", async () => {
    const { changePasswordWithOtp } = await import(
      "@/app/settings/actions"
    );
    const formData = new FormData();
    formData.set("new_password", "Newpass1");
    formData.set("confirm_password", "Newpass1");

    await expectRedirect(
      () => changePasswordWithOtp(formData),
      settingsPath(
        "error",
        "Enter the 6-digit verification code.",
        "otp",
      ),
    );
    expect(supabaseAuth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects weak new password", async () => {
    const { changePasswordWithOtp } = await import(
      "@/app/settings/actions"
    );
    const formData = new FormData();
    formData.set("otp", "ABC123");
    formData.set("new_password", "short");
    formData.set("confirm_password", "short");

    await expectRedirect(
      () => changePasswordWithOtp(formData),
      /status=error/,
    );
    expect(supabaseAuth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation", async () => {
    const { changePasswordWithOtp } = await import(
      "@/app/settings/actions"
    );
    const formData = new FormData();
    formData.set("otp", "ABC123");
    formData.set("new_password", "Newpass1");
    formData.set("confirm_password", "Mismatch1");

    await expectRedirect(
      () => changePasswordWithOtp(formData),
      settingsPath(
        "error",
        "New password confirmation does not match.",
        "otp",
      ),
    );
    expect(supabaseAuth.updateUser).not.toHaveBeenCalled();
  });

  it("redirects to login when not authenticated", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({ data: { user: null } });

    const { changePasswordWithOtp } = await import(
      "@/app/settings/actions"
    );
    const formData = new FormData();
    formData.set("otp", "ABC123");
    formData.set("new_password", "Newpass1");
    formData.set("confirm_password", "Newpass1");

    await expectRedirect(() => changePasswordWithOtp(formData), "/login");
  });

  it("surfaces updateUser errors (invalid nonce)", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({
      data: { user: { email: "teacher@example.com" } },
    });
    supabaseAuth.updateUser.mockResolvedValueOnce({
      error: { message: "Invalid nonce." },
    });

    const { changePasswordWithOtp } = await import(
      "@/app/settings/actions"
    );
    const formData = new FormData();
    formData.set("otp", "WRONG1");
    formData.set("new_password", "Newpass1");
    formData.set("confirm_password", "Newpass1");

    await expectRedirect(
      () => changePasswordWithOtp(formData),
      settingsPath("error", "Invalid nonce.", "otp"),
    );
  });

  it("changes password with valid OTP", async () => {
    supabaseAuth.getUser.mockResolvedValueOnce({
      data: { user: { email: "teacher@example.com" } },
    });
    supabaseAuth.updateUser.mockResolvedValueOnce({ error: null });

    const { changePasswordWithOtp } = await import(
      "@/app/settings/actions"
    );
    const formData = new FormData();
    formData.set("otp", "ABC123");
    formData.set("new_password", "Newpass1");
    formData.set("confirm_password", "Newpass1");

    await expectRedirect(
      () => changePasswordWithOtp(formData),
      settingsPath("success", "Password changed successfully."),
    );
    expect(supabaseAuth.updateUser).toHaveBeenCalledWith({
      password: "Newpass1",
      nonce: "ABC123",
    });
  });
});
```

### Step 4.2 — Run tests to verify they fail

```bash
pnpm vitest run web/src/app/settings/actions.test.ts
```

Expected: multiple tests FAIL — `verifyAndSendOtp` and `changePasswordWithOtp` are not exported from the module.

### Step 4.3 — Rewrite the server actions

Replace the full contents of `web/src/app/settings/actions.ts`:

```typescript
"use server";

import { redirect } from "next/navigation";
import { validatePasswordPolicy } from "@/lib/auth/password-policy";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 60;

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function redirectSettings(
  section: "profile" | "password",
  status: "success" | "error",
  message?: string,
  step?: string,
) {
  const search = new URLSearchParams({
    section,
    status,
  });
  if (message) {
    search.set("message", message);
  }
  if (step) {
    search.set("step", step);
  }
  redirect(`/settings?${search.toString()}`);
}

export async function updateDisplayName(formData: FormData) {
  const displayName = getFormValue(formData, "display_name");

  if (displayName.length < DISPLAY_NAME_MIN) {
    redirectSettings("profile", "error", "Display name must be at least 2 characters.");
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    redirectSettings("profile", "error", "Display name must be 60 characters or less.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);

  if (error) {
    redirectSettings("profile", "error", error.message);
  }

  redirectSettings("profile", "success", "Display name updated.");
}

export async function verifyAndSendOtp(formData: FormData) {
  const currentPassword = getFormValue(formData, "current_password");

  if (!currentPassword) {
    redirectSettings("password", "error", "Enter your current password.");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    redirect("/login");
  }

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) {
    redirectSettings("password", "error", "Current password is incorrect.");
  }

  const { error: reauthError } = await supabase.auth.reauthenticate();
  if (reauthError) {
    redirectSettings("password", "error", reauthError.message);
  }

  redirectSettings("password", "success", "Verification code sent to your email.", "otp");
}

export async function changePasswordWithOtp(formData: FormData) {
  const otp = getFormValue(formData, "otp");
  const newPassword = getFormValue(formData, "new_password");
  const confirmPassword = getFormValue(formData, "confirm_password");

  if (!otp || otp.length < 6) {
    redirectSettings("password", "error", "Enter the 6-digit verification code.", "otp");
  }

  const passwordValidation = validatePasswordPolicy(newPassword);
  if (!passwordValidation.ok) {
    redirectSettings("password", "error", passwordValidation.message, "otp");
  }

  if (newPassword !== confirmPassword) {
    redirectSettings("password", "error", "New password confirmation does not match.", "otp");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
    nonce: otp,
  });
  if (error) {
    redirectSettings("password", "error", error.message, "otp");
  }

  redirectSettings("password", "success", "Password changed successfully.");
}
```

### Step 4.4 — Run tests to verify they pass

```bash
pnpm vitest run web/src/app/settings/actions.test.ts
```

Expected: 11 tests PASS.

### Step 4.5 — Commit

```bash
git add web/src/app/settings/actions.ts web/src/app/settings/actions.test.ts
git commit -m "feat(settings): replace direct password change with OTP reauthentication flow"
```

---

## Task 5: Update Settings Page UI

**Files:**
- Modify: `web/src/app/settings/page.tsx`

### Step 5.1 — Update the imports

In `web/src/app/settings/page.tsx`, make these import changes:

**Replace:**
```typescript
import { changePassword, updateDisplayName } from "@/app/settings/actions";
```
**With:**
```typescript
import { changePasswordWithOtp, updateDisplayName, verifyAndSendOtp } from "@/app/settings/actions";
```

**Replace:**
```typescript
import { Input } from "@/components/ui/input";
```
**With:**
```typescript
import { OtpInput } from "@/components/ui/otp-input";
```

**Add:**
```typescript
import { PasswordInput } from "@/components/ui/password-input";
```

**Replace:**
```typescript
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_TITLE,
} from "@/lib/auth/password-policy";
```
**With:**
```typescript
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_TITLE,
} from "@/lib/auth/password-policy";
```

> Note: the password policy imports are **kept** — they're needed for Step 2's new password fields.

### Step 5.2 — Add `step` to search params parsing

After the existing line:
```typescript
const section = resolvedSearchParams?.section;
```

Update the block to also read `step`:

```typescript
const section = resolvedSearchParams?.section;
const step = resolvedSearchParams?.step;
const status = resolvedSearchParams?.status;
```

### Step 5.3 — Update `SettingsSearchParams` type

Replace:
```typescript
type SettingsSearchParams = {
  section?: string;
  status?: string;
  message?: string;
};
```

With:
```typescript
type SettingsSearchParams = {
  section?: string;
  step?: string;
  status?: string;
  message?: string;
};
```

### Step 5.4 — Replace the Change Password card

Find the `<Card>` for "Change Password" (currently lines 123–180 of `settings/page.tsx`). Replace from `<Card className="p-6">` containing "Change Password" through its closing `</Card>` with:

```tsx
<Card className="p-6">
  <h2 className="text-lg font-semibold text-ui-primary">Change Password</h2>
  <p className="mt-2 text-sm text-ui-muted">
    {step === "otp"
      ? "Enter the verification code from your email and set a new password."
      : "Verify your identity to change your password. A code will be sent to your email."}
  </p>

  {passwordMessage ? (
    passwordMessage.status === "success" ? (
      <Alert variant="success" className="mt-4">
        {passwordMessage.message || "Password update completed."}
      </Alert>
    ) : (
      <TransientFeedbackAlert
        variant="error"
        message={passwordMessage.message || "Password update failed."}
        className="mt-4"
      />
    )
  ) : null}

  {step === "otp" ? (
    <form className="mt-5 space-y-4" action={changePasswordWithOtp}>
      <div className="space-y-2">
        <Label htmlFor="otp">Verification code</Label>
        <OtpInput name="otp" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new_password">New password</Label>
        <PasswordInput
          id="new_password"
          name="new_password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          pattern={PASSWORD_POLICY_PATTERN}
          title={PASSWORD_POLICY_TITLE}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm_password">Confirm new password</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          pattern={PASSWORD_POLICY_PATTERN}
          title={PASSWORD_POLICY_TITLE}
        />
      </div>
      <p className="text-xs text-ui-muted">{PASSWORD_POLICY_HINT}</p>
      <div className="flex items-center gap-3">
        <PendingSubmitButton
          label="Change password"
          pendingLabel="Changing..."
          variant="warm"
        />
        <a
          href="/settings?section=password"
          className="text-sm text-ui-muted underline underline-offset-2 hover:text-ui-primary"
        >
          Cancel
        </a>
      </div>
    </form>
  ) : (
    <form className="mt-5 space-y-4" action={verifyAndSendOtp}>
      <div className="space-y-2">
        <Label htmlFor="current_password">Current password</Label>
        <PasswordInput
          id="current_password"
          name="current_password"
          required
        />
      </div>
      <PendingSubmitButton
        label="Verify & send code"
        pendingLabel="Sending..."
        variant="warm"
      />
    </form>
  )}
</Card>
```

### Step 5.5 — Remove the unused `Input` import

The `Input` component is no longer used on the Settings page (display name uses `Input` — wait, let me check). Actually, the display name form on line 104 still uses `<Input>` for the display name field. **Keep the `Input` import.**

Correction to Step 5.1: **do not remove** the `Input` import. Instead, **add** the `OtpInput` and `PasswordInput` imports alongside it:

```typescript
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
```

### Step 5.6 — Run the full test suite

```bash
pnpm test
```

Expected: all tests PASS.

### Step 5.7 — Verify the page compiles

```bash
cd web && pnpm build 2>&1 | grep -E "error|Error|warning" | head -20
```

Expected: no TypeScript errors in `settings/page.tsx`.

### Step 5.8 — Commit

```bash
git add web/src/app/settings/page.tsx
git commit -m "refactor(settings): two-step password change UI with OTP input and reveal toggles"
```

---

## Self-Review

**Spec coverage:**
- ✅ Password reveal toggle → `PasswordInput` on current password (Step 1) and new/confirm password (Step 2)
- ✅ OTP reauthentication → `verifyAndSendOtp` calls `reauthenticate()`, `changePasswordWithOtp` passes nonce to `updateUser`
- ✅ `secure_password_change` stays `false` → no changes to `supabase/config.toml`
- ✅ Branded email template → `reauthentication.html` matches `recovery.html` style, shows `{{ .Token }}`
- ✅ Six-box OTP input → `OtpInput` wraps `input-otp` with design system styling
- ✅ Cancel button → `<a href="/settings?section=password">` resets to Step 1
- ✅ URL-driven step switching → page reads `step` from search params
- ✅ Error handling → all error cases covered in tests and actions
- ✅ Forgot-password flow unchanged → `completePasswordRecovery` not touched

**Placeholder scan:** None — all code blocks are complete.

**Type consistency:**
- `verifyAndSendOtp` / `changePasswordWithOtp` — same names in actions, tests, and page imports ✓
- `redirectSettings` gains optional `step` param — used consistently in both actions ✓
- `OtpInput` — same name in component file, test file, and page import ✓
- `settingsPath` test helper gains optional `step` param — matches `redirectSettings` ✓
- `supabaseAuth.reauthenticate` mock — matches the Supabase JS client method signature (no params) ✓
- `supabaseAuth.updateUser({ password, nonce })` — matches Supabase JS `updateUser` with nonce param ✓
