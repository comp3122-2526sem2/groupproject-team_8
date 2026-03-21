import { HeaderLoadingScaffold } from "@/app/components/LoadingScaffold";
import { Skeleton } from "@/components/ui/skeleton";

export default function InsightsLoading() {
  return (
    <HeaderLoadingScaffold maxWidthClassName="max-w-6xl">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>

      {/* Summary cards — 3 col */}
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={`summary-${i}`}
            className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-5"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="mt-4 h-8 w-16" />
            <Skeleton className="mt-1.5 h-3 w-32 max-w-full" />
          </div>
        ))}
      </div>

      {/* Charts area — 2 col */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-6">
          <Skeleton className="h-5 w-36 mb-4" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>

      {/* Student table */}
      <div className="rounded-2xl border border-default bg-[var(--surface-card,white)] p-6">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={`row-${i}`} className="flex items-center gap-4 rounded-xl border border-default p-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-36" />
              <div className="ml-auto flex items-center gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </HeaderLoadingScaffold>
  );
}
