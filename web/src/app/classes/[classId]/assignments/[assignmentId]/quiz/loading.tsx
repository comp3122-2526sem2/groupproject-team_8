import { Skeleton } from "@/components/ui/skeleton";

export default function QuizAssignmentLoading() {
  return (
    <div className="min-h-screen surface-page text-ui-primary">
      <div className="mx-auto w-full max-w-5xl px-6 py-16" aria-busy="true">
        {/* Page header */}
        <header className="mb-8 space-y-2">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-10 w-80 max-w-full" />
          <Skeleton className="h-4 w-48" />
          <div className="flex items-center gap-2 pt-1">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </header>

        <div className="space-y-4">
          {/* Stats card */}
          <div className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-5 w-28 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-36 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-3 w-48" />
          </div>

          {/* Question cards */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={`question-${i}`}
              className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-4"
            >
              {/* Question text */}
              <Skeleton className="h-4 w-full max-w-lg" />
              <Skeleton className="mt-1.5 h-4 w-2/3" />

              {/* Choice rows */}
              <div className="mt-3 space-y-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div
                    key={`choice-${i}-${j}`}
                    className="flex items-center gap-3 rounded-xl border border-default bg-[var(--surface-muted)] px-3 py-2.5"
                  >
                    <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
                    <Skeleton className="h-3.5 w-48 max-w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Submit button */}
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
      </div>
    </div>
  );
}
