import Link from "next/link";
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

export default async function TeacherClassesPage() {
  const timer = startServerTimer("teacher-classes");
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
  const displayName = profile.display_name?.trim() || user.email || "Teacher";
  timer.end({ classes: classes.length });

  return (
    <RoleAppShell
      accountType="teacher"
      userEmail={user.email ?? undefined}
      userDisplayName={profile.display_name}
    >
      <main className="mx-auto max-w-5xl p-6 pt-16 page-enter">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">
              My Classes
            </p>
            <h1 className="editorial-title mt-2 text-4xl text-ui-primary">
              {displayName}&apos;s teaching hub
            </h1>
            <p className="mt-2 text-sm text-ui-muted">
              Open classes, monitor chat activity, and create new assignments.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/teacher/dashboard">
                <AppIcons.arrowLeft className="h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <Button asChild variant="warm">
              <Link href="/classes/new">
                <AppIcons.add className="h-4 w-4" />
                Create class
              </Link>
            </Button>
          </div>
        </header>

        {/* Summary bar */}
        {classes.length > 0 && (
          <div className="mt-6 flex items-center gap-4 rounded-xl border border-default bg-[var(--surface-muted)] px-4 py-3">
            <span className="text-sm text-ui-muted">
              <span className="font-semibold text-ui-primary">{classes.length}</span>{" "}
              {classes.length === 1 ? "class" : "classes"}
            </span>
            <span className="text-ui-subtle">·</span>
            <span className="text-sm text-ui-muted">
              <span className="font-semibold text-ui-primary">{ownedClasses.length}</span> owned
            </span>
            {teachingEnrollments.length > 0 && (
              <>
                <span className="text-ui-subtle">·</span>
                <span className="text-sm text-ui-muted">
                  <span className="font-semibold text-ui-primary">
                    {classes.length - ownedClasses.length}
                  </span>{" "}
                  assisting
                </span>
              </>
            )}
          </div>
        )}

        <section className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 stagger-children">
            {classes.length > 0 ? (
              classes.map((classItem) => {
                const enrollmentRole = enrollmentMap.get(classItem.id);
                const role =
                  classItem.owner_id === user.id
                    ? "Owner"
                    : enrollmentRole === "teacher"
                      ? "Teacher"
                      : enrollmentRole === "ta"
                        ? "TA"
                        : null;
                if (!role) {
                  return null;
                }
                const isOwner = classItem.owner_id === user.id;

                return (
                  <Card
                    key={classItem.id}
                    className="ui-motion-lift group rounded-2xl p-5 hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  >
                    {/* Top row — role + subject badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          isOwner
                            ? "bg-accent-soft text-accent"
                            : "bg-[var(--surface-muted)] text-ui-muted border border-default",
                        )}
                      >
                        {role}
                      </span>
                      {classItem.subject && (
                        <span className="inline-flex items-center rounded-full border border-default bg-[var(--surface-card,white)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ui-subtle">
                          {classItem.subject}
                        </span>
                      )}
                      {classItem.level && (
                        <span className="inline-flex items-center rounded-full border border-default bg-[var(--surface-card,white)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ui-subtle">
                          {classItem.level}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <Link href={`/classes/${classItem.id}`} className="mt-3 block">
                      <h2 className="text-lg font-semibold text-ui-primary leading-snug group-hover:text-accent transition-colors duration-200">
                        {classItem.title}
                      </h2>
                    </Link>

                    {/* Actions */}
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      <Button asChild variant="warm" size="sm">
                        <Link href={`/classes/${classItem.id}`}>
                          <AppIcons.arrowRight className="h-3.5 w-3.5" />
                          Open class
                        </Link>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/classes/${classItem.id}#teacher-chat-monitor`}>
                          Chat monitor
                        </Link>
                      </Button>
                      <div className="ml-auto flex items-center gap-1.5">
                        <Button asChild variant="ghost" size="sm" className="h-8 px-2.5 text-xs">
                          <Link href={`/classes/${classItem.id}/activities/chat/new`}>
                            + Chat
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="sm" className="h-8 px-2.5 text-xs">
                          <Link href={`/classes/${classItem.id}/activities/quiz/new`}>
                            + Quiz
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })
            ) : (
              <EmptyStateCard
                className="md:col-span-2"
                icon="classes"
                title="No classes yet"
                description="Create a class to start inviting students and launching activities."
                primaryAction={{ label: "Create class", href: "/classes/new", variant: "warm" }}
                secondaryAction={{
                  label: "Back to dashboard",
                  href: "/teacher/dashboard",
                  variant: "outline",
                }}
              />
            )}
          </div>
        </section>
      </main>
    </RoleAppShell>
  );
}
