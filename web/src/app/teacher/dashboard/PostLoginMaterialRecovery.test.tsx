import { describe, expect, it, vi } from "vitest";
import {
  POST_LOGIN_CLEANUP_PARAM,
  triggerPostLoginMaterialRecovery,
} from "@/app/teacher/dashboard/PostLoginMaterialRecovery";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("triggerPostLoginMaterialRecovery", () => {
  it("marks the token done only after a successful recovery request", async () => {
    const replace = vi.fn();
    const sendRecoveryRequest = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
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
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith("post-login-material-recovery:token-1", "done");
    expect(sendRecoveryRequest).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/teacher/dashboard?view=recent");
  });

  it("does not fire a second recovery request for the same token after success", async () => {
    const replace = vi.fn();
    const sendRecoveryRequest = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getItem: vi.fn().mockReturnValue("done"),
      setItem: vi.fn(),
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

  it("does not fire a duplicate recovery request while the first one is still in flight", async () => {
    const replace = vi.fn();
    const deferred = createDeferred<void>();
    const sendRecoveryRequest = vi.fn().mockReturnValue(deferred.promise);
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };

    const firstAttempt = triggerPostLoginMaterialRecovery({
      pathname: "/teacher/dashboard",
      searchParams: new URLSearchParams(`${POST_LOGIN_CLEANUP_PARAM}=token-2b`),
      replace,
      sendRecoveryRequest,
      storage,
    });

    await Promise.resolve();

    await triggerPostLoginMaterialRecovery({
      pathname: "/teacher/dashboard",
      searchParams: new URLSearchParams(`${POST_LOGIN_CLEANUP_PARAM}=token-2b`),
      replace,
      sendRecoveryRequest,
      storage,
    });

    expect(sendRecoveryRequest).toHaveBeenCalledTimes(1);
    expect(storage.setItem).not.toHaveBeenCalled();

    deferred.resolve();
    await firstAttempt;
    expect(storage.setItem).toHaveBeenCalledWith("post-login-material-recovery:token-2b", "done");
  });

  it("leaves the token retryable on failure so later renders can try again", async () => {
    const replace = vi.fn();
    const sendRecoveryRequest = vi.fn().mockRejectedValue(new Error("temporary failure"));
    const onError = vi.fn();
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };

    await triggerPostLoginMaterialRecovery({
      pathname: "/teacher/dashboard",
      searchParams: new URLSearchParams(`${POST_LOGIN_CLEANUP_PARAM}=token-3`),
      replace,
      sendRecoveryRequest,
      storage,
      onError,
    });

    expect(storage.setItem).not.toHaveBeenCalled();
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
