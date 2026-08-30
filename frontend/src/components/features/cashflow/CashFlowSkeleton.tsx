function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted/60 ${className ?? ''}`} />;
}

export function CashFlowSkeleton({ variant }: { variant: 'today' | 'month' }) {
  if (variant === 'today') {
    return (
      <div data-testid="cashflow-skeleton" className="space-y-5">
        {/* Hero */}
        <Bone className="h-28 w-full" />
        {/* Obligations */}
        <div className="space-y-2">
          <Bone className="h-4 w-36" />
          <Bone className="h-16 w-full" />
          <Bone className="h-16 w-full" />
          <Bone className="h-16 w-full" />
        </div>
        {/* Balance + chart 2-col */}
        <div className="md:grid md:grid-cols-2 md:gap-6">
          <Bone className="h-36 w-full" />
          <Bone className="mt-5 h-36 w-full md:mt-0" />
        </div>
      </div>
    );
  }

  return (
    <div data-testid="cashflow-skeleton" className="space-y-5">
      {/* Period picker */}
      <div className="flex justify-between">
        <Bone className="h-8 w-8" />
        <Bone className="h-6 w-32" />
        <Bone className="h-8 w-8" />
      </div>
      {/* 2-col grid */}
      <div className="md:grid md:grid-cols-2 md:gap-6 space-y-5 md:space-y-0">
        <div className="space-y-5">
          <Bone className="h-36 w-full" />
          <Bone className="h-44 w-full" />
        </div>
        <div className="space-y-5">
          <Bone className="h-56 w-full" />
          <Bone className="h-28 w-full" />
        </div>
      </div>
    </div>
  );
}
