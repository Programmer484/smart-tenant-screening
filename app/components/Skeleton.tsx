export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-foreground/[0.06] ${className}`}
      style={style}
    />
  );
}

export function PropertyEditorSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <div className="flex justify-end">
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <div className="flex gap-1 border-b border-foreground/8 pb-3">
        {[80, 60, 50, 90].map((w, i) => (
          <Skeleton key={i} className="h-5" style={{ width: w }} />
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}

export function ApplicantsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-[#1a2e2a]/10 bg-white shadow-sm">
      <div className="border-b border-[#1a2e2a]/8 bg-[#f7f9f8] px-4 py-3">
        <Skeleton className="h-3 w-48" />
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-4 border-b border-[#1a2e2a]/6 px-4 py-4">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

