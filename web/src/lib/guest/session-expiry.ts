import { GUEST_SESSION_INACTIVITY_TIMEOUT_MS } from "@/lib/guest/config";

export type GuestSandboxSessionRow = {
  class_id: string | null;
  expires_at: string | null;
  last_seen_at: string | null;
};

export type GuestSandboxExpiryReason =
  | "missing_class"
  | "invalid_expiry"
  | "invalid_last_seen"
  | "hard_expiry"
  | "inactivity"
  | null;

export function getGuestSandboxExpiryReason(
  sandbox: GuestSandboxSessionRow,
  now = Date.now(),
): GuestSandboxExpiryReason {
  if (!sandbox.class_id) {
    return "missing_class";
  }

  const expiresAtMs = Date.parse(sandbox.expires_at ?? "");
  if (!Number.isFinite(expiresAtMs)) {
    return "invalid_expiry";
  }

  if (expiresAtMs <= now) {
    return "hard_expiry";
  }

  const lastSeenAtMs = Date.parse(sandbox.last_seen_at ?? "");
  if (!Number.isFinite(lastSeenAtMs)) {
    return "invalid_last_seen";
  }

  if (lastSeenAtMs <= now - GUEST_SESSION_INACTIVITY_TIMEOUT_MS) {
    return "inactivity";
  }

  return null;
}

export function isGuestSandboxExpired(
  sandbox: GuestSandboxSessionRow,
  now = Date.now(),
) {
  return getGuestSandboxExpiryReason(sandbox, now) !== null;
}

export function getGuestSessionExpiredMessage() {
  return "Your guest session has expired. Start a new guest session to continue.";
}
