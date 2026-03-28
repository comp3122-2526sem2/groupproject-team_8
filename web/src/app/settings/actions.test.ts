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
  path: string | RegExp,
) {
  try {
    await Promise.resolve().then(action);
    throw new Error("Expected redirect");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) {
      const digest = String((error as { digest?: string }).digest);
      if (path instanceof RegExp) {
        expect(digest).toMatch(path);
      } else {
        expect(digest).toContain(`;${path};`);
      }
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
