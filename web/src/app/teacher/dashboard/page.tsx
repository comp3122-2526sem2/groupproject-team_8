import Link from "next/link";
import DashboardHashRedirect from "@/app/components/DashboardHashRedirect";
import EmptyStateCard from "@/app/components/EmptyStateCard";
import RoleAppShell from "@/app/components/RoleAppShell";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireVerifiedUser } from "@/lib/auth/session";
import { startServerTimer } from "@/lib/perf";
import { cn } from "@/lib/utils";

type ClassSummary = {
  id: string;
  title: string;
  subject: string | null;
  level: string | null;
  owner_id: string;
  created_at?: string;
};

const QUICK_ACTIONS = [
  {
    label: "Create class",
    description: "Start a new class for students",
    href: "/classes/new",
    icon: "add" as const,
    accent: true,
  },
  {
    label: "View all classes",
    description: "Manage your teaching classes",
    href: "/teacher/classes",
    icon: "classes" as const,
    accent: false,
  },
  {
    label: "Help & docs",
    description: "Learn how to use this platform",
    href: "/help",
    icon: "help" as const,
    accent: false,
  },
];

export default async function TeacherDashboardPage() {
  const timer = startServerTimer("teacher-dashboard");
  const { supabase, user, profile } = await requireVerifiedUser({ accountType: "teacher" });

  const [ownedClassesResult, teacherEnrollmentsResult] = await Promise.all([
    supabase
      .from("classes")
      .select("id,title,subject,level,owner_id,created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("enrollments")
      .select("class_id,role")
      .eq("user_id", user.id)
      .in("role", ["teacher", "ta"]),
  ]);

  const ownedClasses = ownedClassesResult.data ?? [];
  const teachingEnrollments = teacherEnrollmentsResult.data ?? [];
  const additionalClassIds = teachingEnrollments
    .map((enrollment) => enrollment.class_id)
    .filter((classId) => !ownedClasses.some((item) => item.id === classId));

  const additionalClassesResult =
    additionalClassIds.length > 0
      ? await supabase
          .from("classes")
          .select("id,title,subject,level,owner_id,created_at")
          .in("id", additionalClassIds)
      : { data: [] as ClassSummary[] };

  const classes = [...ownedClasses, ...(additionalClassesResult.data ?? [])].sort((a, b) => {
    const left = a.created_at ? new Date(a.created_at).getTime() : 0;
    const right = b.created_at ? new Date(b.created_at).getTime() : 0;
    return right - left;
  });

  const enrollmentMap = new Map(
    teachingEnrollments.map((enrollment) => [enrollment.class_id, enrollment.role]),
  );
  const ownedClassCount = ownedClasses.length;
  const assistantClassCount = classes.filter((classItem) => classItem.owner_id !== user.id).length;
  const recentClasses = classes.slice(0, 3);
  const displayName = profile.display_name?.trim() || user.email || "Teacher";

  timer.end({ classes: classes.length });

  return (
    <RoleAppShell
      accountType="teacher"
      userEmail={user.email ?? undefined}
      userDisplayName={profile.display_name}
    >
      <DashboardHashRedirect classesHref="/teacher/classes" />
      <main className="mx-auto max-w-5xl p-6 pt-16 page-enter">
        {/* ── Header ── */}
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
              Teacher Dashboard
            </p>
            <h1 className="editorial-title mt-2 text-4xl text-ui-primary">
              Welcome, {displayName}
            </h1>
            <p className="mt-2 text-sm text-ui-muted">
              Manage classes, materials, and assignment workflows.
            </p>
          </div>
          <Button asChild variant="warm">
            <Link href="/classes/new">
              <AppIcons.add className="h-4 w-4" />
              Create class
            </Link>
          </Button>
        </header>

        {/* ── Stats ── */}
        <section className="mt-8 grid gap-4 sm:grid-cols-3 stagger-children">
          <Card className="rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-ui-muted">
                <AppIcons.classes className="h-4 w-4" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                Total classes
              </p>
            </div>
            <p className="mt-4 text-3xl font-bold text-ui-primary">{classes.length}</p>
            <p className="mt-1.5 text-sm text-ui-muted">Across all classes where you teach.</p>
          </Card>

          <Card className="rounded-2xl p-5 bg-accent-soft border-[color-mix(in_srgb,var(--accent-primary)_25%,transparent)]">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-card,white)]/60 text-accent">
                <AppIcons.graduation className="h-4 w-4" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent/70">
                Your classes
              </p>
            </div>
            <p className="mt-4 text-3xl font-bold text-accent">{ownedClassCount}</p>
            <p className="mt-1.5 text-sm text-accent/60">Classes you created and manage.</p>
          </Card>

          <Card className="rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-ui-muted">
                <AppIcons.user className="h-4 w-4" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
                Assistant roles
              </p>
            </div>
            <p className="mt-4 text-3xl font-bold text-ui-primary">{assistantClassCount}</p>
            <p className="mt-1.5 text-sm text-ui-muted">Classes where you teach or assist as TA.</p>
          </Card>
        </section>

        {/* ── Quick actions ── */}
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
            Quick actions
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 stagger-children">
            {QUICK_ACTIONS.map((action) => {
              const Icon = AppIcons[action.icon];
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className={cn(
                    "ui-motion-lift group flex items-center gap-3 rounded-2xl border p-4 hover:-translate-y-0.5",
                    action.accent
                      ? "border-accent/30 bg-accent-soft hover:bg-accent hover:border-accent hover:shadow-[var(--shadow-accent)]"
                      : "border-default bg-[var(--surface-card,white)] hover:border-accent hover:shadow-md",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200",
                      action.accent
                        ? "bg-white/40 text-accent group-hover:bg-white/20 group-hover:text-white"
                        : "bg-[var(--surface-muted)] text-ui-muted group-hover:bg-accent-soft group-hover:text-accent",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-sm font-semibold transition-colors duration-200",
                        action.accent
                          ? "text-accent group-hover:text-white"
                          : "text-ui-primary",
                      )}
                    >
                      {action.label}
                    </p>
                    <p
                      className={cn(
                        "truncate text-xs transition-colors duration-200",
                        action.accent
                          ? "text-accent/70 group-hover:text-white/80"
                          : "text-ui-muted",
                      )}
                    >
                      {action.description}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── Recent classes ── */}
        <section className="mt-8">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ui-primary">Recent classes</h2>
            <Link
              href="/teacher/classes"
              className="ui-motion-color text-sm font-semibold text-accent hover:text-accent-strong"
            >
              View all →
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3 stagger-children">
            {recentClasses.length > 0 ? (
              recentClasses.map((classItem) => {
                const enrollmentRole = enrollmentMap.get(classItem.id);
                const roleLabel =
                  classItem.owner_id === user.id
                    ? "Owner"
                    : enrollmentRole === "ta"
                      ? "TA"
                      : "Teacher";
                return (
                  <Link
                    key={classItem.id}
                    href={`/classes/${classItem.id}`}
                    className="ui-motion-lift block rounded-2xl border border-default bg-[var(--surface-card,white)] p-5 hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        {roleLabel}
                      </span>
                      {classItem.subject && (
                        <span className="inline-flex items-center rounded-full border border-default bg-[var(--surface-muted)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ui-muted">
                          {classItem.subject}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-ui-primary leading-snug">
                      {classItem.title}
                    </h3>
                    <p className="mt-1.5 text-xs text-ui-muted">{classItem.level || "Mixed level"}</p>
                  </Link>
                );
              })
            ) : (
              <EmptyStateCard
                className="md:col-span-3"
                icon="classes"
                title="No classes yet"
                description="Create your first class to start building a blueprint and assigning activities."
                primaryAction={{ label: "Create class", href: "/classes/new", variant: "warm" }}
              />
            )}
          </div>
        </section>
      </main>
    </RoleAppShell>
  );
}
