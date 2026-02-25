import Link from "next/link";
import { signOut } from "@/app/actions";
import BrandMark from "@/app/components/BrandMark";
import type { AccountType } from "@/lib/auth/session";

type Breadcrumb = {
  label: string;
  href?: string;
};

type NavKey = "dashboard" | "new-class" | "join-class";

type AuthHeaderProps = {
  breadcrumbs?: Breadcrumb[];
  activeNav?: NavKey;
  accountType?: AccountType;
  tone?: "default" | "subtle";
  classContext?: {
    classId: string;
    isTeacher: boolean;
  };
};

function getNavClass(isActive: boolean) {
  const base =
    "ui-motion-color rounded-full border px-4 py-2 text-xs font-semibold tracking-wide";
  if (isActive) {
    return `${base} chip-warm`;
  }
  return `${base} chip-neutral hover:border-accent hover:bg-accent-soft hover:text-accent`;
}

function renderBreadcrumbs(breadcrumbs: Breadcrumb[], clickable = true) {
  return (
    <nav className="flex flex-wrap items-center gap-2 text-xs font-medium text-ui-muted">
      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        if (clickable && crumb.href && !isLast) {
          return (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-2">
              <Link href={crumb.href} className="ui-motion-color hover:text-accent">
                {crumb.label}
              </Link>
              <span className="text-ui-subtle">/</span>
            </span>
          );
        }
        return (
          <span key={`${crumb.label}-${index}`} className="text-ui-subtle">
            {crumb.label}
          </span>
        );
      })}
    </nav>
  );
}

export default function AuthHeader({
  breadcrumbs,
  activeNav,
  accountType,
  classContext,
  tone = "default",
}: AuthHeaderProps) {
  const resolvedAccountType =
    accountType ??
    (classContext
      ? classContext.isTeacher
        ? "teacher"
        : "student"
      : null);
  const dashboardHref =
    resolvedAccountType === "teacher"
      ? "/teacher/dashboard"
      : resolvedAccountType === "student"
        ? "/student/dashboard"
        : "/dashboard";
  const classesHref =
    resolvedAccountType === "teacher"
      ? "/teacher/classes"
      : resolvedAccountType === "student"
        ? "/student/classes"
        : "/dashboard";
  const showTeacherNav = resolvedAccountType === "teacher" || classContext?.isTeacher;
  const classTitle =
    breadcrumbs && breadcrumbs.length > 0
      ? breadcrumbs[breadcrumbs.length - 1]?.label ?? "Class"
      : "Class";
  const shellClass =
    tone === "subtle"
      ? "sticky top-0 z-40 border-b border-default bg-[var(--surface-muted)]/95 backdrop-blur"
      : "sticky top-0 z-40 border-b border-default bg-white/95 backdrop-blur";

  if (classContext) {
    return (
      <div className="sticky top-0 z-40 border-b border-default bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <h1 className="editorial-title truncate text-2xl text-ui-primary">{classTitle}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={classesHref}
              className="ui-motion-color rounded-full border border-default bg-white px-4 py-2 text-xs font-semibold text-ui-muted hover:border-accent hover:text-accent"
            >
              My Classes
            </Link>
            {classContext.isTeacher ? (
              <>
                <Link
                  href={`/classes/${classContext.classId}#teacher-chat-monitor`}
                  className="ui-motion-color rounded-full border border-default bg-white px-4 py-2 text-xs font-semibold text-ui-muted hover:border-accent hover:text-accent"
                >
                  Chat Monitor
                </Link>
                <Link
                  href={`/classes/${classContext.classId}/activities/quiz/new`}
                  className="ui-motion-color chip-warm rounded-full px-4 py-2 text-xs font-semibold hover:bg-accent-soft"
                >
                  New Quiz
                </Link>
              </>
            ) : (
              <Link
                href={`/classes/${classContext.classId}?view=chat`}
                className="ui-motion-color rounded-full border border-default bg-white px-4 py-2 text-xs font-semibold text-ui-muted hover:border-accent hover:text-accent"
              >
                Open AI Chat
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link
          href={dashboardHref}
          className="ui-motion-color flex items-center gap-2 text-sm font-semibold tracking-wide text-ui-subtle hover:text-accent"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--foreground)] text-white">
            <BrandMark className="h-4 w-4" />
          </span>
          Learning Platform
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            href={dashboardHref}
            className={getNavClass(activeNav === "dashboard")}
            aria-current={activeNav === "dashboard" ? "page" : undefined}
          >
            Dashboard
          </Link>
          {showTeacherNav ? (
            <Link
              href="/classes/new"
              className={getNavClass(activeNav === "new-class")}
              aria-current={activeNav === "new-class" ? "page" : undefined}
            >
              New Class
            </Link>
          ) : (
            <Link
              href="/join"
              className={getNavClass(activeNav === "join-class")}
              aria-current={activeNav === "join-class" ? "page" : undefined}
            >
              Join Class
            </Link>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="ui-motion-color rounded-full border border-default bg-white px-4 py-2 text-xs font-semibold text-ui-muted hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className="mx-auto w-full max-w-6xl px-6 pb-5">
          {renderBreadcrumbs(breadcrumbs)}
        </div>
      ) : null}
    </div>
  );
}
