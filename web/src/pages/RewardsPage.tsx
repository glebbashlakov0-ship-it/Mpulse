import { CircleDollarSign } from "lucide-react";

export function RewardsPage() {
  return (
    <div className="min-h-screen bg-[#15191d] px-4 py-12 text-[#dee3e7] sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[760px] rounded-2xl border border-[#242b32] bg-[#181d21] p-8 shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
        <div className="mb-6 grid size-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-400">
          <CircleDollarSign size={30} />
        </div>
        <h1 className="text-3xl font-bold tracking-normal text-[#dee3e7]">Rewards</h1>
        <p className="mt-3 max-w-xl text-base font-semibold leading-7 text-[#7b8996]">
          Referral rewards will be added soon.
        </p>
      </section>
    </div>
  );
}
