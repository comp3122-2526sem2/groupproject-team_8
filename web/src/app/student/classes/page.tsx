import Link from "next/link";
import EmptyStateCard from "@/app/components/EmptyStateCard";
import RoleAppShell from "@/app/components/RoleAppShell";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireVerifiedUser } from "@/lib/auth/session";
import { startServerTimer } from "@/lib/perf";

export default async function StudentClassesPage() {
  const timer = startServerTimer("student-classes");
  const { supabase, user, profile } = await requireVerifiedUser({ accountType: "student" });

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_id,role")
    .eq("user_id", user.id)
    .eq("role", "student");

  const classIds = (enrollments ?? []).map((enrollment) => enrollment.class_id);

  const { data: classes } =
    classIds.length > 0
      ? await supabase
          .from("classes")
          .select("id,title,subject,level,owner_id")
          .in("id", classIds)
          .order("created_at", { ascending: false })
      : { data: [] };

  const displayName = profile.display_name?.trim() || user.email || "Student";
  timer.end({ classes: classes?.length ?? 0 });

  return (
    <RoleAppShell
      accountType="student"
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
              {displayName}&apos;s classes
            </h1>
            <p className="mt-2 text-sm text-ui-muted">
              Open class workspaces and continue chats, quizzes, and flashcards.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/student/dashboard">
                <AppIcons.arrowLeft className="h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <Button asChild variant="warm">
              <Link href="/join">
                <AppIcons.add className="h-4 w-4" />
                Join class
              </Link>
            </Button>
          </div>
        </header>

        {/* Count pill */}
        {classes && classes.length > 0 && (
          <div className="mt-6 flex items-center gap-4 rounded-xl border border-default bg-[var(--surface-muted)] px-4 py-3">
            <span className="text-sm text-ui-muted">
              <span className="font-semibold text-ui-primary">{classes.length}</span>{" "}
              {classes.length === 1 ? "class" : "classes"} enrolled
            </span>
          </div>
        )}

        <section className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 stagger-children">
            {classes && classes.length > 0 ? (
              classes.map((classItem) => (
                <Card
                  key={classItem.id}
                  className="ui-motion-lift group rounded-2xl p-5 hover:border-accent hover:shadow-md"
                >
                  {/* Badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center rounded-full bg-[var(--surface-muted)] border border-default px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ui-subtle">
                      Student
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
                  <div className="mt-4 flex items-center gap-2">
                    <Button asChild variant="warm" size="sm">
                      <Link href={`/classes/${classItem.id}`}>
                        <AppIcons.arrowRight className="h-3.5 w-3.5" />
                        Open class
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/classes/${classItem.id}?view=chat`}>AI chat</Link>
                    </Button>
                  </div>
                </Card>
              ))
            ) : (
              <EmptyStateCard
                className="md:col-span-2"
                icon="classes"
                title="No classes joined yet"
                description="Use a class join code from your teacher to unlock AI chat, quizzes, and flashcards."
                primaryAction={{ label: "Join class", href: "/join", variant: "warm" }}
                secondaryAction={{
                  label: "Back to dashboard",
                  href: "/student/dashboard",
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
