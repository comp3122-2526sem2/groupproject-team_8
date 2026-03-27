import "server-only";

import { createHash } from "node:crypto";
import {
  GUEST_SESSIONS_PER_HOUR,
  GUEST_SESSION_RATE_LIMIT_WINDOW_MS,
} from "@/lib/guest/config";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const FALLBACK_IP = "unknown";

export function getGuestEntryIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    FALLBACK_IP
  );
}

function hashGuestEntryIp(ip: string) {
  return createHash("sha256").update(ip || FALLBACK_IP).digest("hex");
}

export async function consumeGuestEntryRateLimit(ip: string) {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc("consume_guest_entry_rate_limit_service", {
    p_ip_hash: hashGuestEntryIp(ip),
    p_limit: GUEST_SESSIONS_PER_HOUR,
    p_window_seconds: Math.max(1, Math.floor(GUEST_SESSION_RATE_LIMIT_WINDOW_MS / 1000)),
  });

  if (error) {
    throw new Error(error.message);
  }

  return data === true;
}
