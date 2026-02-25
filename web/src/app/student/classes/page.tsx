import Link from "next/link";
import Sidebar from "@/app/components/Sidebar";
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
    <div className="surface-page min-h-screen">
      <Sidebar
        accountType="student"
        userEmail={user.email ?? undefined}
        userDisplayName={profile.display_name}
      />
      <div className="sidebar-content">
        <main className="mx-auto max-w-5xl p-6 pt-16">
          <header className="flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">My Classes</p>
              <h1 className="editorial-title mt-2 text-4xl text-ui-primary">{displayName}&apos;s classes</h1>
              <p className="mt-2 text-sm text-ui-muted">
                Open class workspaces and continue chats, quizzes, and flashcards.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/student/dashboard"
                className="ui-motion-color rounded-xl border border-default bg-white px-4 py-2 text-sm font-semibold text-ui-muted hover:border-accent hover:text-accent"
              >
                Back to Dashboard
              </Link>
              <Link href="/join" className="btn-warm ui-motion-lift rounded-xl px-4 py-2 text-sm font-semibold">
                Join class
              </Link>
            </div>
          </header>

          <section className="mt-8">
            <div className="grid gap-4 md:grid-cols-2">
              {classes && classes.length > 0 ? (
                classes.map((classItem) => (
                  <div
                    key={classItem.id}
                    className="ui-motion-lift group rounded-2xl border border-default bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ui-subtle">Student</p>
                    <Link href={`/classes/${classItem.id}`} className="mt-2 block">
                      <h2 className="text-xl font-semibold text-ui-primary">{classItem.title}</h2>
                    </Link>
                    <p className="mt-2 text-sm text-ui-muted">
                      {classItem.subject || "General"} · {classItem.level || "Mixed"}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/classes/${classItem.id}`}
                        className="ui-motion-color rounded-full border border-default bg-white px-3 py-1 text-xs font-medium text-ui-muted hover:border-accent hover:bg-accent-soft hover:text-accent"
                      >
                        Open class
                      </Link>
                      <Link
                        href={`/classes/${classItem.id}?view=chat`}
                        className="ui-motion-color rounded-full border border-default bg-white px-3 py-1 text-xs font-medium text-ui-muted hover:border-accent hover:bg-accent-soft hover:text-accent"
                      >
                        Open AI chat
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-default bg-[var(--surface-muted)] p-6 text-sm text-ui-muted md:col-span-2">
                  No classes joined yet. Use a join code from your teacher.
                </div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
