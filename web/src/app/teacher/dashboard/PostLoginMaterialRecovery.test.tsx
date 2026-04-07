import { describe, expect, it, vi } from "vitest";
import {
  POST_LOGIN_CLEANUP_PARAM,
  triggerPostLoginMaterialRecovery,
} from "@/app/teacher/dashboard/PostLoginMaterialRecovery";

describe("triggerPostLoginMaterialRecovery", () => {
  it("marks the token done only after a successful recovery request", async () => {
    const replace = vi.fn();
    const sendRecoveryRequest = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    await triggerPostLoginMaterialRecovery({
      pathname: "/teacher/dashboard",
      searchParams: new URLSearchParams(
        `${POST_LOGIN_CLEANUP_PARAM}=token-1&view=recent`,
      ),
      replace,
      sendRecoveryRequest,
      storage,
    });

    expect(storage.getItem).toHaveBeenCalledWith("post-login-material-recovery:token-1");
    expect(storage.setItem).toHaveBeenNthCalledWith(1, "post-login-material-recovery:token-1", "pending");
    expect(storage.setItem).toHaveBeenNthCalledWith(2, "post-login-material-recovery:token-1", "done");
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(sendRecoveryRequest).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/teacher/dashboard?view=recent");
  });

  it("does not fire a second recovery request for the same token", async () => {
    const replace = vi.fn();
    const sendRecoveryRequest = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getItem: vi.fn().mockReturnValue("done"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    await triggerPostLoginMaterialRecovery({
      pathname: "/teacher/dashboard",
      searchParams: new URLSearchParams(`${POST_LOGIN_CLEANUP_PARAM}=token-2`),
      replace,
      sendRecoveryRequest,
      storage,
    });

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(sendRecoveryRequest).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("clears the pending token state and leaves the query param on failure so later renders can retry", async () => {
    const replace = vi.fn();
    const sendRecoveryRequest = vi.fn().mockRejectedValue(new Error("temporary failure"));
    const onError = vi.fn();
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    await triggerPostLoginMaterialRecovery({
      pathname: "/teacher/dashboard",
      searchParams: new URLSearchParams(`${POST_LOGIN_CLEANUP_PARAM}=token-3`),
      replace,
      sendRecoveryRequest,
      storage,
      onError,
    });

    expect(storage.setItem).toHaveBeenCalledWith("post-login-material-recovery:token-3", "pending");
    expect(storage.removeItem).toHaveBeenCalledWith("post-login-material-recovery:token-3");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does nothing when the cleanup query param is absent", async () => {
    const replace = vi.fn();
    const sendRecoveryRequest = vi.fn().mockResolvedValue(undefined);

    await triggerPostLoginMaterialRecovery({
      pathname: "/teacher/dashboard",
      searchParams: new URLSearchParams("view=recent"),
      replace,
      sendRecoveryRequest,
      storage: null,
    });

    expect(sendRecoveryRequest).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
