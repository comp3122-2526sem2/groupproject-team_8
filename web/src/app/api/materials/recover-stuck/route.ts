import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";

export const runtime = "nodejs";

const STALE_AFTER_MINUTES = 20;
const RECOVERY_LIMIT = 50;

type RecoverStuckRpcResult = {
  scanned_count?: number;
  requeued_count?: number;
  failed_count?: number;
  skipped_count?: number;
};

function normalizeRecoverStuckRpcResult(
  value: RecoverStuckRpcResult | RecoverStuckRpcResult[] | null,
) {
  const payload = Array.isArray(value) ? (value[0] ?? null) : value;

  return {
    scannedCount: Number(payload?.scanned_count ?? 0),
    requeuedCount: Number(payload?.requeued_count ?? 0),
    failedCount: Number(payload?.failed_count ?? 0),
    skippedCount: Number(payload?.skipped_count ?? 0),
  };
}

export async function POST() {
  const context = await getAuthContext();

  if (!context.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (context.guestSessionError) {
    return NextResponse.json({ error: context.guestSessionError }, { status: 401 });
  }

  if (context.isGuest || context.profile?.account_type !== "teacher") {
    return NextResponse.json({ error: "Teacher account required." }, { status: 403 });
  }

  const { data, error } = await context.supabase.rpc("recover_stuck_materials_for_current_user", {
    p_stale_after_minutes: STALE_AFTER_MINUTES,
    p_limit: RECOVERY_LIMIT,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    ...normalizeRecoverStuckRpcResult((data ?? null) as RecoverStuckRpcResult | RecoverStuckRpcResult[] | null),
  });
}
