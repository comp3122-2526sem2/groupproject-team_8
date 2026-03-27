import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startGuestSessionMock, consumeGuestEntryRateLimitMock, getGuestEntryIpMock } = vi.hoisted(() => ({
  startGuestSessionMock: vi.fn(),
  consumeGuestEntryRateLimitMock: vi.fn(),
  getGuestEntryIpMock: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
  startGuestSession: startGuestSessionMock,
}));

vi.mock("@/lib/guest/entry-rate-limit", () => ({
  consumeGuestEntryRateLimit: consumeGuestEntryRateLimitMock,
  getGuestEntryIp: getGuestEntryIpMock,
}));

async function loadRoute() {
  vi.resetModules();
  return await import("./route");
}

function makeRequest(ip = "203.0.113.10") {
  return new Request("https://example.com/guest/enter", {
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

describe("GET /guest/enter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T00:00:00.000Z"));
    getGuestEntryIpMock.mockReturnValue("203.0.113.10");
    consumeGuestEntryRateLimitMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a guest session when the IP is below the hourly limit", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: true,
      redirectTo: "/classes/class-1",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest());

    expect(startGuestSessionMock).toHaveBeenCalledTimes(1);
    expect(consumeGuestEntryRateLimitMock).toHaveBeenCalledWith("203.0.113.10");
    expect(response.headers.get("location")).toBe("https://example.com/classes/class-1");
  });

  it("blocks when the hourly IP limit is exceeded", async () => {
    consumeGuestEntryRateLimitMock.mockResolvedValue(false);
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.12"));

    expect(startGuestSessionMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://example.com/?error=too-many-guest-sessions",
    );
  });

  it("redirects to guest unavailable when shared rate-limit state is unavailable", async () => {
    consumeGuestEntryRateLimitMock.mockRejectedValue(new Error("db unavailable"));
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.12"));

    expect(startGuestSessionMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://example.com/?error=guest-unavailable");
  });

  it("redirects to guest unavailable when sandbox provisioning fails", async () => {
    startGuestSessionMock.mockResolvedValue({
      ok: false,
      error: "Guest mode is unavailable.",
    });
    const { GET } = await loadRoute();

    const response = await GET(makeRequest("203.0.113.13"));

    expect(response.headers.get("location")).toBe("https://example.com/?error=guest-unavailable");
  });
});
