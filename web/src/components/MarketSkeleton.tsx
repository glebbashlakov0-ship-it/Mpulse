export function MarketSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          aria-hidden="true"
          className="h-[180px] animate-pulse rounded-[15.2px] border border-[#e6e8ea] bg-white shadow-[0_8px_16px_rgba(0,0,0,0.04)]"
          key={index}
        >
          <div className="flex h-full flex-col justify-between p-3">
            <div className="flex gap-2">
              <div className="size-[38px] rounded-md bg-[#eef1f4]" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-4/5 rounded bg-[#eef1f4]" />
                <div className="h-4 w-3/5 rounded bg-[#eef1f4]" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-10 rounded-sm bg-[#eef1f4]" />
              <div className="h-4 w-1/2 rounded bg-[#eef1f4]" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarketDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1350px] px-4 py-8 lg:px-6">
      <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-[520px] animate-pulse rounded-xl border border-[#e6e8ea] bg-[#f4f5f6]" />
        <div className="h-[390px] animate-pulse rounded-xl border border-[#e6e8ea] bg-[#f4f5f6]" />
      </div>
    </div>
  );
}

export function MarketActivitySkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          aria-hidden="true"
          className="h-16 animate-pulse rounded-xl border border-[#e6e8ea] bg-[#f4f5f6]"
          key={index}
        />
      ))}
    </div>
  );
}
