import { NextResponse } from "next/server";
import { startGuestSession } from "@/app/actions";
import { consumeGuestEntryRateLimit, getGuestEntryIp } from "@/lib/guest/entry-rate-limit";

export async function GET(request: Request) {
  try {
    const ip = getGuestEntryIp(request);
    const allowed = await consumeGuestEntryRateLimit(ip);
    if (!allowed) {
      return NextResponse.redirect(new URL("/?error=too-many-guest-sessions", request.url));
    }
  } catch {
    return NextResponse.redirect(new URL("/?error=guest-unavailable", request.url));
  }

  const result = await startGuestSession();
  if (!result.ok || !result.redirectTo) {
    return NextResponse.redirect(new URL("/?error=guest-unavailable", request.url));
  }

  return NextResponse.redirect(new URL(result.redirectTo, request.url));
}
