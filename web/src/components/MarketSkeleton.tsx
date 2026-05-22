export function MarketSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          className="min-h-[220px] animate-pulse rounded-2xl border border-[#242b32] bg-[#1e2428]"
          key={index}
        />
      ))}
    </div>
  );
}
