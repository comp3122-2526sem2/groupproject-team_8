import { describe, expect, it } from "vitest";
import { getGuestEntryIp } from "./entry-rate-limit";

describe("getGuestEntryIp", () => {
  it("prefers the forwarded client IP headers in order", () => {
    const cfRequest = new Request("https://example.com/guest/enter", {
      headers: {
        "cf-connecting-ip": "198.51.100.1",
        "x-real-ip": "198.51.100.2",
        "x-forwarded-for": "198.51.100.3",
      },
    });
    const realIpRequest = new Request("https://example.com/guest/enter", {
      headers: {
        "x-real-ip": "198.51.100.2",
        "x-forwarded-for": "198.51.100.3",
      },
    });
    const forwardedForRequest = new Request("https://example.com/guest/enter", {
      headers: {
        "x-forwarded-for": "198.51.100.3, 198.51.100.4",
      },
    });

    expect(getGuestEntryIp(cfRequest)).toBe("198.51.100.1");
    expect(getGuestEntryIp(realIpRequest)).toBe("198.51.100.2");
    expect(getGuestEntryIp(forwardedForRequest)).toBe("198.51.100.3");
  });

  it("returns null instead of collapsing missing headers into a shared bucket", () => {
    const request = new Request("https://example.com/guest/enter");

    expect(getGuestEntryIp(request)).toBeNull();
  });
});
