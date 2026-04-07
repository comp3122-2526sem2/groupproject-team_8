import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthContextMock, rpcMock } = vi.hoisted(() => ({
  getAuthContextMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthContext: getAuthContextMock,
}));

function makeAuthContext(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "teacher-1", email: "teacher@example.com" },
    guestSessionError: null,
    guestSessionExpired: false,
    isGuest: false,
    profile: {
      id: "teacher-1",
      account_type: "teacher",
      display_name: "Teacher One",
    },
    supabase: {
      rpc: rpcMock,
    },
    ...overrides,
  };
}

describe("POST /api/materials/recover-stuck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the user is not authenticated", async () => {
    getAuthContextMock.mockResolvedValueOnce(makeAuthContext({ user: null }));
    const { POST } = await import("./route");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Unauthorized.");
  });

  it("returns 401 when guest session verification failed", async () => {
    getAuthContextMock.mockResolvedValueOnce(
      makeAuthContext({
        guestSessionError: "We couldn't verify your guest session right now. Please try again.",
      }),
    );
    const { POST } = await import("./route");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toMatch(/verify your guest session/i);
  });

  it("returns 403 for guest callers", async () => {
    getAuthContextMock.mockResolvedValueOnce(
      makeAuthContext({
        isGuest: true,
        profile: null,
      }),
    );
    const { POST } = await import("./route");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Teacher account required.");
  });

  it("returns 403 for non-teacher callers", async () => {
    getAuthContextMock.mockResolvedValueOnce(
      makeAuthContext({
        profile: {
          id: "student-1",
          account_type: "student",
          display_name: "Student One",
        },
      }),
    );
    const { POST } = await import("./route");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Teacher account required.");
  });

  it("returns summarized recovery counts on success", async () => {
    getAuthContextMock.mockResolvedValueOnce(makeAuthContext());
    rpcMock.mockResolvedValueOnce({
      data: {
        scanned_count: 3,
        requeued_count: 2,
        failed_count: 1,
        skipped_count: 4,
      },
      error: null,
    });
    const { POST } = await import("./route");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("recover_stuck_materials_for_current_user", {
      p_stale_after_minutes: 20,
      p_limit: 50,
    });
    expect(payload).toEqual({
      ok: true,
      scannedCount: 3,
      requeuedCount: 2,
      failedCount: 1,
      skippedCount: 4,
    });
  });

  it("forwards RPC failures as 502 responses", async () => {
    getAuthContextMock.mockResolvedValueOnce(makeAuthContext());
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "rpc failed" },
    });
    const { POST } = await import("./route");

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.error).toBe("rpc failed");
  });
});
