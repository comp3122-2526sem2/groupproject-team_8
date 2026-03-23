import { Skeleton } from "@/components/ui/skeleton";

export default function FlashcardsAssignmentLoading() {
  return (
    <div className="min-h-screen surface-page px-6 py-16 text-ui-primary">
      <div className="mx-auto w-full max-w-5xl space-y-6" aria-busy="true">
        {/* Header breadcrumb */}
        <Skeleton className="h-3 w-48" />

        {/* Title + badge row */}
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>

        {/* Flashcard area */}
        <div className="mx-auto w-full max-w-2xl">
          {/* Progress bar */}
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />

          {/* Card face */}
          <div className="mt-8 flex min-h-[300px] items-center justify-center rounded-3xl border border-default bg-[var(--surface-card,white)] p-8">
            <div className="w-full space-y-3 text-center">
              <Skeleton className="mx-auto h-4 w-16" />
              <Skeleton className="mx-auto h-6 w-3/4" />
              <Skeleton className="mx-auto h-5 w-1/2" />
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex justify-center gap-4">
            <Skeleton className="h-10 w-32 rounded-xl" />
            <Skeleton className="h-10 w-32 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
