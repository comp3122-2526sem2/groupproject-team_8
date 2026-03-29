import { redirect } from "next/navigation";
import {
  getGuestSessionExpiredMessage,
  isGuestSandboxExpired,
} from "@/lib/guest/session-expiry";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type AccountType = "teacher" | "student";
export type GuestRole = AccountType;

type ProfileRow = {
  id: string;
  account_type: AccountType | null;
  display_name: string | null;
};

type GuestSandboxRow = {
  id: string;
  class_id: string | null;
  guest_role: GuestRole;
  status: "active" | "expired" | "discarded";
  expires_at: string | null;
  last_seen_at: string | null;
};

/**
 * Fully resolved authentication context returned by `getAuthContext`.
 *
 * Consumers should check `isGuest` first: guest sessions do not have a
 * `profile` row, `isEmailVerified` is always true for guests (they bypass
 * email auth), and access is scoped by `sandboxId` and `guestClassId`.
 *
 * `guestSessionError` is non-null when the guest sandbox check failed or
 * the session has expired.  `guestSessionExpired` is the specific sub-case
 * where the sandbox hit its wall-clock or inactivity limit.
 */
export type AuthContext = {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  user: Awaited<
    ReturnType<Awaited<ReturnType<typeof createServerSupabaseClient>>["auth"]["getUser"]>
  >["data"]["user"];
  accessToken: string | null;
  profile: ProfileRow | null;
  isEmailVerified: boolean;
  isGuest: boolean;
  guestSessionError: string | null;
  guestSessionExpired: boolean;
  sandboxId: string | null;
  guestRole: GuestRole | null;
  guestClassId: string | null;
};

function loginErrorUrl(message: string) {
  return `/login?error=${encodeURIComponent(message)}`;
}

function guestSessionRedirectUrl(context: Pick<AuthContext, "guestSessionExpired">) {
  return context.guestSessionExpired ? "/?guest=expired" : "/?error=guest-session-check-failed";
}

/**
 * Detects whether a Supabase user is an anonymous (guest) Auth user.
 *
 * Supabase sets `is_anonymous: true` on the user JWT claims for sessions
 * created via `signInAnonymously()`.  As a belt-and-suspenders fallback we
 * also check `app_metadata.provider === "anonymous"` because older SDK
 * versions (and some edge deployments) may not populate `is_anonymous`
 * reliably in the session object returned by `getSession()`.
 *
 * This function is intentionally local to this module: guest detection
 * should be centralised here to avoid divergent heuristics across pages.
 *
 * @param user  The user object from a Supabase session, or null.
 * @returns     `true` if the user was created via anonymous sign-in.
 */
function isAnonymousUser(
  user: Awaited<
    ReturnType<Awaited<ReturnType<typeof createServerSupabaseClient>>["auth"]["getUser"]>
  >["data"]["user"],
) {
  if (!user) {
    return false;
  }

  const candidate = user as {
    is_anonymous?: boolean;
    app_metadata?: { provider?: string | null } | null;
  };

  return candidate.is_anonymous === true || candidate.app_metadata?.provider === "anonymous";
}

/**
 * Loads and returns the fully resolved authentication context for the current
 * server request.
 *
 * This function is the single source of truth for session state in server
 * components and server actions.  It covers three user categories:
 *
 * 1. **No session**: Returns a context with all fields set to null/false.
 *    Callers that require auth should redirect to /login.
 *
 * 2. **Anonymous (guest) user**: Queries the `guest_sandboxes` table to find
 *    an active sandbox.  If the sandbox has expired, this function performs a
 *    side-effect: it marks the sandbox as "expired" in the DB and signs the
 *    user out.  This side-effect is intentional — expiry detection and cleanup
 *    happens at context-load time so all downstream page guards see a clean
 *    state without needing to handle expiry themselves.
 *
 * 3. **Real (email/password) user**: Queries the `profiles` table for role and
 *    display name.  Email verification is checked via `user.email_confirmed_at`.
 *
 * @returns  A fully populated `AuthContext` (never throws; errors are surfaced
 *           via `guestSessionError`).
 */
export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (!user) {
    return {
      supabase,
      user: null,
      accessToken: null,
      profile: null,
      isEmailVerified: false,
      isGuest: false,
      guestSessionError: null,
      guestSessionExpired: false,
      sandboxId: null,
      guestRole: null,
      guestClassId: null,
    };
  }

  let profile: ProfileRow | null = null;
  let isGuest = false;
  let guestSessionError: string | null = null;
  let guestSessionExpired = false;
  let sandboxId: string | null = null;
  let guestRole: GuestRole | null = null;
  let guestClassId: string | null = null;

  if (isAnonymousUser(user)) {
    // --- Guest user: load sandbox and enforce expiry ---

    const { data: sandbox, error: sandboxError } = await supabase
      .from("guest_sandboxes")
      .select("id,class_id,guest_role,status,expires_at,last_seen_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle<GuestSandboxRow>();

    if (sandboxError && sandboxError.code !== "PGRST116") {
      guestSessionError = "We couldn't verify your guest session right now. Please try again.";
    } else if (sandbox && !isGuestSandboxExpired(sandbox)) {
      // Valid, active sandbox — populate guest context fields.
      isGuest = true;
      sandboxId = sandbox.id;
      guestRole = sandbox.guest_role;
      guestClassId = sandbox.class_id;
    } else if (sandbox) {
      // Sandbox exists but has expired — clean up as a side-effect of context
      // loading so the guest sees a clean expired state on the very next render.
      guestSessionError = getGuestSessionExpiredMessage();
      guestSessionExpired = true;

      // Mark the sandbox expired in the DB (idempotent due to the status filter).
      await supabase
        .from("guest_sandboxes")
        .update({ status: "expired" })
        .eq("id", sandbox.id)
        .eq("status", "active");
      // Sign out the anonymous Auth user so the session cookie is cleared.
      await supabase.auth.signOut();
    }
  } else {
    // --- Real (email/password) user: load profile row ---

    const { data } = await supabase
      .from("profiles")
      .select("id,account_type,display_name")
      .eq("id", user.id)
      .maybeSingle<ProfileRow>();

    profile = data ?? null;
  }

  return {
    supabase,
    user,
    accessToken: session?.access_token ?? null,
    profile,
    // `email_confirmed_at` is populated by Supabase when the user clicks the
    // confirmation link.  Null means the email has not been verified yet.
    isEmailVerified: Boolean(user.email_confirmed_at),
    isGuest,
    guestSessionError,
    guestSessionExpired,
    sandboxId,
    guestRole,
    guestClassId,
  };
}

/**
 * Guards a server component or action to real (email/password) verified users
 * only.
 *
 * Redirect chain:
 * 1. No session → `/login`
 * 2. Guest session error → `/?guest=expired` or `/?error=guest-session-check-failed`
 * 3. Active guest → their class page (or `/` if no class assigned)
 * 4. Unverified email → `/login?error=...`
 * 5. Missing profile → `/login?error=...` (account setup incomplete)
 * 6. Wrong account type → `redirectPath` or role-specific dashboard
 *
 * @param options.accountType   Restricts access to "teacher" or "student"; omit to
 *                              allow any verified account type.
 * @param options.redirectPath  Override destination when the account-type check fails.
 * @returns  A narrowed context with `user`, `profile`, `accountType` guaranteed
 *           non-null, and `isEmailVerified: true`.
 */
export async function requireVerifiedUser(options?: {
  accountType?: AccountType;
  redirectPath?: string;
}) {
  const context = await getAuthContext();
  if (!context.user) {
    redirect("/login");
  }

  if (context.guestSessionError) {
    redirect(guestSessionRedirectUrl(context));
  }

  if (context.isGuest) {
    if (context.guestClassId) {
      redirect(`/classes/${context.guestClassId}`);
    }
    redirect("/");
  }

  if (!context.isEmailVerified) {
    redirect(loginErrorUrl("Please verify your email before continuing."));
  }

  const accountType = context.profile?.account_type;
  if (!accountType) {
    redirect(loginErrorUrl("Account setup is incomplete. Please sign in again."));
  }

  if (options?.accountType && accountType !== options.accountType) {
    const fallback = accountType === "teacher" ? "/teacher/dashboard" : "/student/dashboard";
    const destination = options.redirectPath ?? fallback;
    redirect(
      `${destination}?error=${encodeURIComponent(
        `This action requires a ${options.accountType} account.`,
      )}`,
    );
  }

  return {
    ...context,
    user: context.user,
    profile: {
      id: context.user.id,
      account_type: accountType,
      display_name: context.profile?.display_name ?? null,
    },
    accountType,
    isEmailVerified: true,
  };
}

/**
 * Guards a server component or action to EITHER an active guest session OR a
 * verified real user.
 *
 * This is used for pages that are accessible in both guest mode (demo walkthrough)
 * and by real authenticated users (production use).  The two paths return
 * compatible context shapes so callers don't need to branch on `isGuest`.
 *
 * **Guest path**: Extracts `guestRole` as the effective `accountType`.  The
 * returned `profile` is a synthetic row (`display_name: "Guest Explorer"`) so
 * UI components that render the user's name work without DB access.
 * `isEmailVerified` is set to `true` because guests bypass email auth entirely.
 *
 * **Verified user path**: Delegates to `requireVerifiedUser` with the same
 * options, which applies the full redirect chain.
 *
 * @param options.accountType   Restricts access to a specific role; for guests,
 *                              this checks `guestRole` instead of `profile.account_type`.
 * @param options.redirectPath  Override destination when the role check fails.
 * @returns  A narrowed context compatible with `requireVerifiedUser`'s return shape.
 */
export async function requireGuestOrVerifiedUser(options?: {
  accountType?: AccountType;
  redirectPath?: string;
}) {
  const context = await getAuthContext();
  if (!context.user) {
    redirect("/login");
  }

  if (context.guestSessionError) {
    redirect(guestSessionRedirectUrl(context));
  }

  // --- Guest path ---

  if (context.isGuest) {
    const accountType = context.guestRole;
    if (!accountType) {
      // Sandbox exists but guestRole is null — this should not happen in normal
      // operation; redirect to home so the user can re-enter.
      redirect("/");
    }

    if (options?.accountType && accountType !== options.accountType) {
      // Guest is in the wrong role for this page — redirect them back to their
      // class or the home page rather than the login page.
      const fallback = context.guestClassId ? `/classes/${context.guestClassId}` : "/";
      const destination = options.redirectPath ?? fallback;
      redirect(
        `${destination}?error=${encodeURIComponent(
          `This action requires a ${options.accountType} view.`,
        )}`,
      );
    }

    return {
      ...context,
      user: context.user,
      // Synthetic profile so downstream UI components render without a DB hit.
      profile: {
        id: context.user.id,
        account_type: accountType,
        display_name: "Guest Explorer",
      } satisfies ProfileRow,
      accountType,
      // Guests bypass email verification — treat their session as verified.
      isEmailVerified: true,
    };
  }

  // --- Verified user path ---
  // Delegate to requireVerifiedUser which handles all remaining redirect cases.
  return requireVerifiedUser(options);
}
