import * as React from "react";
import toast from "react-hot-toast";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  createDepositIntent,
  createWithdrawalRequest,
  loadComplianceEligibility,
  loadLedgerBalance,
  loadLedgerEntries,
  loadMyWallet,
  loadWalletDeposits,
  loadWithdrawalRequests,
} from "../lib/api";
import { formatRelativeTime, formatUsdt } from "../lib/format";
import { formatEligibilityReason, isEligibleToTrade } from "../lib/eligibility";
import type {
  ComplianceEligibilityPayload,
  LedgerBalancePayload,
  LedgerEntriesPayload,
  MyWalletPayload,
  WalletDepositsPayload,
  WithdrawalRequestsPayload,
} from "../lib/types";
import { useAuth } from "../hooks/useAuth";

const RAIL_LABEL = "USDT on TRON (TRC-20)";
const WALLET_NOTICE =
  "Withdrawals are reviewed before processing. Account features may vary by eligibility and region.";

export function WalletPage() {
  const { user, status: authStatus } = useAuth();
  const [walletState, setWalletState] = React.useState<MyWalletPayload | null>(null);
  const [balanceState, setBalanceState] = React.useState<LedgerBalancePayload | null>(null);
  const [depositsState, setDepositsState] = React.useState<WalletDepositsPayload | null>(null);
  const [withdrawalsState, setWithdrawalsState] =
    React.useState<WithdrawalRequestsPayload | null>(null);
  const [ledgerState, setLedgerState] = React.useState<LedgerEntriesPayload | null>(null);
  const [eligibilityState, setEligibilityState] =
    React.useState<ComplianceEligibilityPayload | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] =
    React.useState<"deposits" | "withdrawals" | "ledger">("deposits");
  const [depositAmount, setDepositAmount] = React.useState("25");
  const [withdrawAmount, setWithdrawAmount] = React.useState("");
  const [withdrawAddress, setWithdrawAddress] = React.useState("");
  const [isDepositCreating, setIsDepositCreating] = React.useState(false);
  const [isWithdrawSubmitting, setIsWithdrawSubmitting] = React.useState(false);

  const refreshWallet = React.useCallback(async () => {
    if (!user) {
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const [wallet, balance, deposits, withdrawals, ledger] = await Promise.all([
        loadMyWallet(),
        loadLedgerBalance(),
        loadWalletDeposits(),
        loadWithdrawalRequests(),
        loadLedgerEntries(50),
      ]);
      const eligibility = await loadComplianceEligibility().catch(() => null);

      setWalletState(wallet);
      setBalanceState(balance);
      setDepositsState(deposits);
      setWithdrawalsState(withdrawals);
      setLedgerState(ledger);
      setEligibilityState(eligibility);
      setStatus("ready");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Could not load wallet";
      setError(message);
      setStatus("error");
      toast.error(message);
    }
  }, [user]);

  React.useEffect(() => {
    if (user) {
      void refreshWallet();
    } else {
      setStatus("idle");
    }
  }, [refreshWallet, user]);

  async function refreshLedger() {
    const [balance, ledger] = await Promise.all([loadLedgerBalance(), loadLedgerEntries(50)]);
    setBalanceState(balance);
    setLedgerState(ledger);
  }

  async function handleDepositIntent(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(depositAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive expected amount.");
      return;
    }

    setIsDepositCreating(true);

    try {
      await createDepositIntent({
        expectedAmount: amount,
        reference: `wallet-page-${Date.now()}`,
      });
      setDepositsState(await loadWalletDeposits());
      toast.success("Deposit instruction created.");
    } catch (nextError) {
      toast.error(
        nextError instanceof Error ? nextError.message : "Could not create deposit instruction",
      );
    } finally {
      setIsDepositCreating(false);
    }
  }

  async function handleWithdraw(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(withdrawAmount);
    const canRequestWithdrawal = isEligibleToTrade(eligibilityState);

    if (!canRequestWithdrawal) {
      toast.error(
        getWithdrawalEligibilityText(eligibilityState) ??
          "Complete account verification before requesting a withdrawal.",
      );
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive withdrawal amount.");
      return;
    }

    setIsWithdrawSubmitting(true);

    try {
      await createWithdrawalRequest({
        amount,
        destinationAddress: withdrawAddress,
      });
      setWithdrawalsState(await loadWithdrawalRequests());
      setWithdrawAmount("");
      setWithdrawAddress("");
      toast.success("Withdrawal request submitted for review.");
    } catch (nextError) {
      toast.error(
        nextError instanceof Error ? nextError.message : "Could not create withdrawal request",
      );
    } finally {
      setIsWithdrawSubmitting(false);
    }
  }

  if (authStatus === "loading") {
    return <WalletShell title="Wallet" body={<LoadingState />} />;
  }

  if (!user) {
    return (
      <WalletShell
        title="Wallet"
        body={
          <section className="rounded-2xl border border-[#f7d022]/35 bg-[#f7d022]/10 p-5 text-[#f8da52]">
            <h2 className="text-lg font-semibold">Sign in required</h2>
            <p className="mt-1 text-sm">
              Wallet and balance data are available after you sign in.
            </p>
            <a
              href="/auth?mode=login&redirect=%2Fwallet"
              className="mt-4 inline-flex rounded-2xl bg-[#d4ad16] px-4 py-2 text-sm font-semibold text-white hover:bg-[#b18d0f]"
            >
              Log in or create account
            </a>
          </section>
        }
      />
    );
  }

  if (status === "loading") {
    return <WalletShell title="Wallet" body={<LoadingState />} />;
  }

  if (status === "error") {
    return (
      <WalletShell
        title="Wallet"
        body={
          <section className="rounded-2xl border border-[#cb3131]/35 bg-[#cb3131]/10 p-5 text-[#d78282]">
            <h2 className="text-lg font-semibold">Wallet could not load</h2>
            <p className="mt-1 text-sm">{error}</p>
            <button
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-[#cb3131] px-4 py-2 text-sm font-semibold text-white hover:bg-[#951616]"
              onClick={() => void refreshWallet()}
              type="button"
            >
              <RefreshCw size={16} />
              Retry
            </button>
          </section>
        }
      />
    );
  }

  const wallet = walletState?.wallet ?? null;
  const balance = balanceState?.balance ?? null;
  const depositIntents = depositsState?.depositIntents ?? [];
  const depositEvents = depositsState?.depositEvents ?? [];
  const withdrawals = withdrawalsState?.withdrawalRequests ?? [];
  const ledgerEntries = ledgerState?.entries ?? [];
  const canRequestWithdrawal = isEligibleToTrade(eligibilityState);
  const withdrawalEligibilityText = getWithdrawalEligibilityText(eligibilityState);

  return (
    <WalletShell
      title="Wallet"
      body={
        <>
          <section className="mb-6 rounded-2xl border border-[#f7d022]/35 bg-[#f7d022]/10 p-5 text-[#f8da52]">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                <h2 className="text-lg font-semibold">Wallet notice</h2>
                <p className="mt-1 text-sm">{WALLET_NOTICE}</p>
              </div>
            </div>
          </section>

          <section className="mb-6 rounded-2xl border border-[#242b32] bg-[#1e2428] p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[#7b8996]">Available balance</p>
                <h2 className="mt-1 text-3xl font-bold text-[#dee3e7]">
                  {formatUsdt(balance?.availableBalance ?? 0)}
                </h2>
                <p className="mt-2 text-sm text-[#7b8996]">
                  Rail: {RAIL_LABEL}. Withdrawal requests are reviewed before processing.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-4">
              <Metric label="Credited" value={formatUsdt(balance?.totalCredited ?? 0)} />
              <Metric label="Debited" value={formatUsdt(balance?.totalDebited ?? 0)} />
              <Metric label="Held" value={formatUsdt(balance?.totalHeld ?? 0)} />
              <Metric label="Released" value={formatUsdt(balance?.totalReleased ?? 0)} />
            </div>
          </section>

          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-[#242b32] bg-[#1e2428] p-6">
              <h2 className="text-xl font-semibold text-[#dee3e7]">Deposit instructions</h2>
              <p className="mt-1 text-sm text-[#7b8996]">
                Create an instruction for a USDT deposit on the selected network.
              </p>

              <div className="mt-5">
                <p className="text-sm font-medium text-[#afbac5]">Network</p>
                <p className="mt-1 font-semibold text-[#dee3e7]">{RAIL_LABEL}</p>
              </div>

              <div className="mt-4">
                <p className="text-sm font-medium text-[#afbac5]">Deposit address</p>
                {wallet ? (
                  <p className="mt-1 break-all rounded-2xl bg-[#181d21] p-3 font-mono text-sm text-[#dee3e7]">
                    {wallet.address}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-[#7b8996]">No wallet address yet.</p>
                )}
              </div>

              <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={handleDepositIntent}>
                <label className="min-w-0 flex-1 text-sm font-medium text-[#afbac5]">
                  Expected amount
                  <input
                    className="mt-1 w-full rounded-2xl border border-[#2e3841] px-3 py-2 text-sm focus:border-[#0093fd] focus:outline-none focus:ring-1 focus:ring-[#0093fd]"
                    min="0.01"
                    step="0.01"
                    type="number"
                    value={depositAmount}
                    onChange={(event) => setDepositAmount(event.target.value)}
                  />
                </label>
                <button
                  className="self-end rounded-2xl border border-[#2e3841] px-4 py-2 text-sm font-semibold text-[#d2d8df] hover:bg-[#181d21] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isDepositCreating}
                  type="submit"
                >
                  {isDepositCreating ? "Creating..." : "Create instruction"}
                </button>
              </form>
            </section>

            <section className="rounded-2xl border border-[#242b32] bg-[#1e2428] p-6">
              <h2 className="text-xl font-semibold text-[#dee3e7]">Withdrawal request</h2>
              <p className="mt-1 text-sm text-[#7b8996]">
                Withdrawal requests are reviewed before processing.
              </p>
              {!canRequestWithdrawal ? (
                <div className="mt-4 rounded-2xl border border-[#f7d022]/35 bg-[#f7d022]/10 px-4 py-3 text-sm font-semibold text-[#f8da52]">
                  {withdrawalEligibilityText ??
                    "Complete account verification before requesting a withdrawal."}
                </div>
              ) : null}

              <form className="mt-5 space-y-4" onSubmit={handleWithdraw}>
                <label className="block text-sm font-medium text-[#afbac5]">
                  Amount
                  <input
                    className="mt-1 w-full rounded-2xl border border-[#2e3841] px-3 py-2 text-sm focus:border-[#0093fd] focus:outline-none focus:ring-1 focus:ring-[#0093fd]"
                    min="0.01"
                    required
                    step="0.01"
                    type="number"
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                  />
                </label>
                <label className="block text-sm font-medium text-[#afbac5]">
                  TRON destination address
                  <input
                    className="mt-1 w-full rounded-2xl border border-[#2e3841] px-3 py-2 font-mono text-sm focus:border-[#0093fd] focus:outline-none focus:ring-1 focus:ring-[#0093fd]"
                    placeholder="T..."
                    required
                    type="text"
                    value={withdrawAddress}
                    onChange={(event) => setWithdrawAddress(event.target.value)}
                  />
                </label>
                <button
                  className="rounded-2xl bg-[#0093fd] px-4 py-2 text-sm font-semibold text-white hover:bg-[#26a3fd] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isWithdrawSubmitting || !canRequestWithdrawal}
                  type="submit"
                >
                  {!canRequestWithdrawal
                    ? "Complete verification"
                    : isWithdrawSubmitting
                      ? "Saving..."
                      : "Submit request"}
                </button>
              </form>
            </section>
          </div>

          <section className="rounded-2xl border border-[#242b32] bg-[#1e2428] p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold text-[#dee3e7]">Wallet history</h2>
              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-[#2e3841] px-3 py-2 text-sm font-semibold text-[#d2d8df] hover:bg-[#181d21]"
                onClick={() => void refreshWallet()}
                type="button"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>

            <div className="mb-5 flex gap-2 overflow-x-auto border-b border-[#242b32]">
              <HistoryTab
                active={activeTab === "deposits"}
                label="Deposits"
                onClick={() => setActiveTab("deposits")}
              />
              <HistoryTab
                active={activeTab === "withdrawals"}
                label="Withdrawals"
                onClick={() => setActiveTab("withdrawals")}
              />
              <HistoryTab
                active={activeTab === "ledger"}
                label="Ledger"
                onClick={() => setActiveTab("ledger")}
              />
            </div>

            {activeTab === "deposits" ? (
              <DepositHistory intents={depositIntents} events={depositEvents} />
            ) : null}
            {activeTab === "withdrawals" ? (
              <WithdrawalHistory withdrawals={withdrawals} />
            ) : null}
            {activeTab === "ledger" ? <LedgerHistory entries={ledgerEntries} /> : null}
          </section>
        </>
      }
    />
  );
}

function WalletShell({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#181d21]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="mb-8 text-3xl font-bold text-[#dee3e7]">{title}</h1>
        {body}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="rounded-2xl border border-[#242b32] bg-[#1e2428] p-12 text-center">
      <p className="text-[#7b8996]">Loading wallet...</p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#242b32] bg-[#181d21] p-4">
      <p className="text-sm text-[#7b8996]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[#dee3e7]">{value}</p>
    </div>
  );
}

function HistoryTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold ${
        active
          ? "border-[#0093fd] text-[#26a3fd]"
          : "border-transparent text-[#7b8996] hover:text-[#dee3e7]"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function DepositHistory({
  intents,
  events,
}: {
  intents: WalletDepositsPayload["depositIntents"];
  events: WalletDepositsPayload["depositEvents"];
}) {
  if (intents.length === 0 && events.length === 0) {
    return <EmptyState text="No deposit instructions or deposit events yet." />;
  }

  return (
    <div className="space-y-3">
      {intents.map((intent) => (
        <HistoryRow
          key={intent.id}
          title={`${formatUsdt(intent.expectedAmount)} expected`}
          meta={`Instruction · ${intent.network} · expires ${formatRelativeTime(intent.expiresAt)}`}
          status={intent.status}
          detail={intent.address}
        />
      ))}
      {events.map((event) => (
        <HistoryRow
          key={event.id}
          title={`${formatUsdt(event.amount)} event`}
          meta={`Detected by ${event.provider} · ${event.confirmations} confirmations`}
          status={event.status}
          detail={event.txHash}
        />
      ))}
    </div>
  );
}

function WithdrawalHistory({
  withdrawals,
}: {
  withdrawals: WithdrawalRequestsPayload["withdrawalRequests"];
}) {
  if (withdrawals.length === 0) {
    return <EmptyState text="No withdrawal requests yet." />;
  }

  return (
    <div className="space-y-3">
      {withdrawals.map((withdrawal) => (
        <HistoryRow
          key={withdrawal.id}
          title={formatUsdt(withdrawal.amount)}
          meta={`${withdrawal.network} request · ${formatRelativeTime(withdrawal.createdAt)}`}
          status={withdrawal.status}
          detail={`To ${withdrawal.destinationAddress} · Pending review`}
        />
      ))}
    </div>
  );
}

function LedgerHistory({ entries }: { entries: LedgerEntriesPayload["entries"] }) {
  if (entries.length === 0) {
    return <EmptyState text="No balance history yet." />;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <HistoryRow
          key={entry.id}
          title={`${isPositiveLedgerEntry(entry.entryType) ? "+" : "-"}${formatUsdt(entry.amount)}`}
          meta={`${ledgerReasonLabel(entry.reason)} · ${formatRelativeTime(entry.createdAt)}`}
          status={entry.entryType}
          detail={entry.referenceType ? ledgerReferenceLabel(entry.referenceType) : "Balance history"}
        />
      ))}
    </div>
  );
}

function HistoryRow({
  title,
  meta,
  status,
  detail,
}: {
  title: string;
  meta: string;
  status: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#242b32] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-[#dee3e7]">{title}</p>
        <p className="mt-1 text-sm text-[#7b8996]">{meta}</p>
        <p className="mt-1 truncate font-mono text-xs text-[#697d91]">{detail}</p>
      </div>
      <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${statusClass(status)}`}>
        {statusLabel(status)}
      </span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#2e3841] p-8 text-center text-sm text-[#7b8996]">
      {text}
    </div>
  );
}

function getWithdrawalEligibilityText(eligibility: ComplianceEligibilityPayload | null) {
  if (!eligibility) {
    return "Complete account verification before requesting a withdrawal.";
  }

  if (isEligibleToTrade(eligibility)) {
    return null;
  }

  const reason = eligibility.reasons.find((nextReason) => nextReason !== "TRANSFERS_UNAVAILABLE");
  return reason ? formatEligibilityReason(reason) : "Complete account verification before requesting a withdrawal.";
}

function isPositiveLedgerEntry(entryType: string) {
  return entryType === "credit" || entryType === "release" || entryType === "trade_credit";
}

function ledgerReasonLabel(reason: string) {
  if (reason.includes("credit")) {
    return "Balance added";
  }

  if (reason.includes("trade")) {
    return "Trade activity";
  }

  return reason.replace(/_/g, " ");
}

function ledgerReferenceLabel(referenceType: string) {
  if (referenceType.includes("credit")) {
    return "Balance adjustment";
  }

  if (referenceType.includes("trade")) {
    return "Trade";
  }

  return "Balance history";
}

function statusLabel(status: string) {
  if (status === "pending_review") {
    return "Pending review";
  }

  if (status === "trade_credit") {
    return "Trade credit";
  }

  if (status === "trade_debit") {
    return "Trade debit";
  }

  return status.replace(/_/g, " ");
}

function statusClass(status: string) {
  if (["credited", "credit", "confirmed", "approved_for_review"].includes(status)) {
    return "bg-[#3db468]/14 text-[#5fbe82]";
  }

  if (["waiting", "detected", "pending_review", "hold"].includes(status)) {
    return "bg-[#f7d022]/14 text-[#f8da52]";
  }

  if (["rejected", "failed", "debit", "trade_debit"].includes(status)) {
    return "bg-[#cb3131]/14 text-[#d05959]";
  }

  return "bg-[#242b32] text-[#afbac5]";
}
