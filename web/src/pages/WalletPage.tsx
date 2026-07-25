import * as React from "react";
import toast from "react-hot-toast";
import { Link, useSearchParams } from "react-router";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CircleDollarSign,
  Copy,
  RefreshCw,
} from "lucide-react";
import {
  createDepositIntent,
  createWithdrawalQuote,
  createWithdrawalRequest,
  loadCoinLedger,
  loadMyWallet,
  loadWalletDeposits,
  loadWithdrawalRequests,
} from "../lib/api";
import {
  formatAssetAmount,
  formatCoinMicros,
  formatRelativeTime,
  formatSignedCoinMicros,
  formatUsdReference,
  parseAssetInputToAtomic,
  parseCoinInputToMicros,
} from "../lib/format";
import type {
  CoinLedgerPayload,
  DepositIntent,
  MyWalletPayload,
  WalletDepositsPayload,
  WithdrawalQuote,
  WithdrawalRequestsPayload,
} from "../lib/types";
import { useAuth } from "../hooks/useAuth";
import { useCoinAccount } from "../hooks/useCoinAccount";

const RAIL_LABEL = "USDT on TRON (TRC-20)";
const DEPOSIT_QUICK_AMOUNTS = ["25", "50", "100", "500"] as const;
export function WalletPage() {
  const { user, status: authStatus } = useAuth();
  const userId = user?.id ?? null;
  const {
    balance,
    error: coinAccountError,
    refreshBalance,
    supportedAssets,
  } = useCoinAccount();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeAction: "deposit" | "withdraw" =
    searchParams.get("action") === "withdraw" ? "withdraw" : "deposit";
  const [walletState, setWalletState] = React.useState<MyWalletPayload | null>(null);
  const [depositsState, setDepositsState] = React.useState<WalletDepositsPayload | null>(null);
  const [withdrawalsState, setWithdrawalsState] =
    React.useState<WithdrawalRequestsPayload | null>(null);
  const [ledgerState, setLedgerState] = React.useState<CoinLedgerPayload | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] =
    React.useState<"deposits" | "withdrawals" | "ledger">("deposits");
  const [depositAmount, setDepositAmount] = React.useState("25");
  const [depositReference, setDepositReference] = React.useState("");
  const [depositStatus, setDepositStatus] = React.useState<string | null>(null);
  const [createdDepositIntent, setCreatedDepositIntent] = React.useState<DepositIntent | null>(null);
  const [withdrawAmount, setWithdrawAmount] = React.useState("");
  const [withdrawAddress, setWithdrawAddress] = React.useState("");
  const [withdrawalQuote, setWithdrawalQuote] = React.useState<WithdrawalQuote | null>(null);
  const [addressCopied, setAddressCopied] = React.useState(false);
  const [isDepositCreating, setIsDepositCreating] = React.useState(false);
  const [isWithdrawSubmitting, setIsWithdrawSubmitting] = React.useState(false);
  const isMountedRef = React.useRef(false);
  const walletRequestIdRef = React.useRef(0);
  const copyResetTimeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      walletRequestIdRef.current += 1;
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = null;
      }
    };
  }, []);

  const refreshWallet = React.useCallback(async () => {
    const requestId = ++walletRequestIdRef.current;
    if (!userId) {
      return;
    }

    setStatus("loading");
    setError(null);

    try {
      const [wallet, deposits, withdrawals, ledger] = await Promise.all([
        loadMyWallet().catch(() => null),
        loadWalletDeposits(),
        loadWithdrawalRequests(),
        loadCoinLedger(50),
        refreshBalance(),
      ]);

      if (!isMountedRef.current || requestId !== walletRequestIdRef.current) {
        return;
      }
      setWalletState(wallet);
      setDepositsState(deposits);
      setWithdrawalsState(withdrawals);
      setLedgerState(ledger);
      setStatus("ready");
    } catch (nextError) {
      if (!isMountedRef.current || requestId !== walletRequestIdRef.current) {
        return;
      }
      const message = nextError instanceof Error ? nextError.message : "Could not load wallet";
      setError(message);
      setStatus("error");
      toast.error(message);
    }
  }, [refreshBalance, userId]);

  React.useEffect(() => {
    if (userId) {
      void refreshWallet();
    } else {
      walletRequestIdRef.current += 1;
      setStatus("idle");
    }

    return () => {
      walletRequestIdRef.current += 1;
    };
  }, [refreshWallet, userId]);

  const selectAction = React.useCallback(
    (action: "deposit" | "withdraw") => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("action", action);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  async function handleDepositIntent(event: React.FormEvent) {
    event.preventDefault();
    const expectedUsdtAtomic = parseAssetInputToAtomic(depositAmount);

    if (!expectedUsdtAtomic) {
      toast.error("Enter a positive expected amount.");
      return;
    }

    setIsDepositCreating(true);
    setDepositStatus(null);

    try {
      const created = await createDepositIntent({
        expectedUsdtAtomic,
        memo: depositReference.trim() || null,
      });
      const [deposits, ledger] = await Promise.all([
        loadWalletDeposits(),
        loadCoinLedger(50),
        refreshBalance(),
      ]);
      if (!isMountedRef.current) {
        return;
      }
      setDepositReference("");
      setCreatedDepositIntent(created.depositIntent);
      setDepositsState(deposits);
      setLedgerState(ledger);
      setDepositStatus(
        `${formatAssetAmount(created.depositIntent.expectedUsdtAtomic, "USDT", {
          atomic: true,
        })} deposit instructions created · ${statusLabel(created.depositIntent.status)}`,
      );
      toast.success("Deposit request created.");
    } catch (nextError) {
      if (!isMountedRef.current) {
        return;
      }
      toast.error(
        nextError instanceof Error ? nextError.message : "Could not create deposit",
      );
    } finally {
      if (isMountedRef.current) {
        setIsDepositCreating(false);
      }
    }
  }

  async function handleWithdraw(event: React.FormEvent) {
    event.preventDefault();
    const coinAmountMicros = parseCoinInputToMicros(withdrawAmount);

    if (!coinAmountMicros) {
      toast.error("Enter a positive withdrawal amount.");
      return;
    }

    setIsWithdrawSubmitting(true);

    try {
      const result = await createWithdrawalQuote({
        coinAmountMicros,
        destinationAddress: withdrawAddress.trim(),
      });
      if (!isMountedRef.current) {
        return;
      }
      setWithdrawalQuote(result.quote);
      toast.success("Withdrawal quote created. Review it before confirming.");
    } catch (nextError) {
      if (!isMountedRef.current) {
        return;
      }
      toast.error(
        nextError instanceof Error ? nextError.message : "Could not create withdrawal quote",
      );
    } finally {
      if (isMountedRef.current) {
        setIsWithdrawSubmitting(false);
      }
    }
  }

  async function handleConfirmWithdrawal() {
    if (!withdrawalQuote || withdrawalQuote.status !== "open") {
      return;
    }

    setIsWithdrawSubmitting(true);
    try {
      await createWithdrawalRequest({ quoteId: withdrawalQuote.id });
      const [withdrawals, ledger] = await Promise.all([
        loadWithdrawalRequests(),
        loadCoinLedger(50),
        refreshBalance(),
      ]);
      if (!isMountedRef.current) {
        return;
      }
      setWithdrawalsState(withdrawals);
      setLedgerState(ledger);
      setWithdrawAmount("");
      setWithdrawAddress("");
      setWithdrawalQuote(null);
      toast.success("Withdrawal reserved and submitted for review.");
    } catch (nextError) {
      if (!isMountedRef.current) {
        return;
      }
      toast.error(
        nextError instanceof Error ? nextError.message : "Could not create withdrawal request",
      );
    } finally {
      if (isMountedRef.current) {
        setIsWithdrawSubmitting(false);
      }
    }
  }

  async function handleCopyAddress() {
    if (!walletState?.wallet.address) {
      return;
    }

    try {
      await navigator.clipboard.writeText(walletState.wallet.address);
      if (!isMountedRef.current) {
        return;
      }
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      setAddressCopied(true);
      toast.success("Deposit address copied.");
      copyResetTimeoutRef.current = window.setTimeout(() => {
        copyResetTimeoutRef.current = null;
        if (isMountedRef.current) {
          setAddressCopied(false);
        }
      }, 1800);
    } catch {
      if (isMountedRef.current) {
        toast.error("Could not copy the deposit address.");
      }
    }
  }

  if (authStatus === "loading") {
    return <WalletShell body={<LoadingState />} />;
  }

  if (!user) {
    return (
      <WalletShell
        body={
          <section className="rounded-2xl border border-[#f7d022]/35 bg-[#f7d022]/10 p-5 text-[#f8da52]">
            <h2 className="text-lg font-semibold">Sign in required</h2>
            <p className="mt-1 text-sm">
              Coins and transaction history are available after you sign in.
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

  if (status === "idle" || status === "loading") {
    return <WalletShell body={<LoadingState />} />;
  }

  if (status === "error") {
    return (
      <WalletShell
        body={
          <section className="rounded-2xl border border-[#cb3131]/35 bg-[#cb3131]/10 p-5 text-[#d78282]">
            <h2 className="text-lg font-semibold">Coins could not load</h2>
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
  const availableCoinMicros = balance?.availableCoinMicros ?? "0";
  const reservedCoinMicros = balance?.reservedCoinMicros ?? "0";
  const totalCoinMicros = balance?.totalCoinMicros ?? "0";
  const deposits = depositsState?.deposits ?? [];
  const withdrawals = withdrawalsState?.withdrawalRequests ?? [];
  const ledgerEntries = ledgerState?.entries ?? [];
  const settlementRail = supportedAssets?.settlementAssets.find(
    (rail) => rail.asset === "USDT" && rail.network === "TRON",
  );
  const depositEnabled = settlementRail?.depositEnabled ?? false;
  const withdrawalEnabled = settlementRail?.withdrawalEnabled ?? false;
  const transferNote = settlementRail
    ? `${RAIL_LABEL} · ${
        settlementRail.reviewOnly
          ? "Requests are review-only; no automatic broadcast."
          : "Transfers are processed on TRON."
      }`
    : "Money rail capabilities are unavailable.";

  return (
    <WalletShell
      body={
        <>
          <AccountViewTabs />

          {coinAccountError ? (
            <div className="mt-4 rounded-xl border border-[#cb3131]/35 bg-[#cb3131]/10 px-4 py-3 text-sm text-[#d78282]">
              {coinAccountError}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <section className="flex min-h-[268px] flex-col rounded-2xl border border-[#2e3841] bg-[#1e2428] p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#7b8996]">
                  <CircleDollarSign size={17} />
                  Coins
                </div>
                <span className="text-xs font-medium text-[#697d91]">Available Coins</span>
              </div>

              <div className="mt-5">
                <strong className="block text-4xl font-semibold tracking-tight text-[#dee3e7] sm:text-5xl">
                  {formatCoinMicros(availableCoinMicros)}
                </strong>
                <p className="mt-2 text-sm font-medium text-[#7b8996]">
                  {formatCoinMicros(reservedCoinMicros)} reserved
                </p>
              </div>

              <div className="mt-auto grid grid-cols-2 gap-2 pt-8">
                <ActionButton
                  active={activeAction === "deposit"}
                  disabled={!depositEnabled}
                  icon={<ArrowDownToLine size={17} />}
                  label={depositEnabled ? "Deposit" : "Deposit unavailable"}
                  onClick={() => selectAction("deposit")}
                />
                <ActionButton
                  active={activeAction === "withdraw"}
                  disabled={!withdrawalEnabled}
                  icon={<ArrowUpFromLine size={17} />}
                  label={withdrawalEnabled ? "Withdraw" : "Withdrawal unavailable"}
                  onClick={() => selectAction("withdraw")}
                />
              </div>
            </section>

            <section className="min-h-[268px] overflow-hidden rounded-2xl border border-[#2e3841] bg-[#1e2428] p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#7b8996]">
                  <Activity size={17} />
                  Coin activity
                </div>
                <span className="rounded-lg bg-[#18344f] px-2.5 py-1 text-xs font-bold text-[#26a3fd]">
                  Recent
                </span>
              </div>

              <strong className="mt-5 block text-3xl font-semibold tracking-tight text-[#dee3e7]">
                {formatCoinMicros(totalCoinMicros)}
              </strong>
              <p className="mt-1 text-sm font-medium text-[#7b8996]">Total Coins</p>

              <CashActivityChart entries={ledgerEntries} />

              <div className="mt-3 grid grid-cols-3 gap-3 border-t border-[#2e3841] pt-3">
                <CompactMetric label="Available" value={availableCoinMicros} />
                <CompactMetric label="Reserved" value={reservedCoinMicros} />
                <CompactMetric label="Total" value={totalCoinMicros} />
              </div>
            </section>
          </div>

          <section className="mt-5 rounded-2xl border border-[#2e3841] bg-[#1e2428]">
            <div className="flex items-center gap-1 border-b border-[#2e3841] p-1.5">
              <ActionTab
                active={activeAction === "deposit"}
                disabled={!depositEnabled}
                label="Deposit"
                onClick={() => selectAction("deposit")}
              />
              <ActionTab
                active={activeAction === "withdraw"}
                disabled={!withdrawalEnabled}
                label="Withdraw"
                onClick={() => selectAction("withdraw")}
              />
            </div>

            <div className="p-5 sm:p-6">
              {activeAction === "deposit" ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold text-[#dee3e7]">Deposit USDT</h2>
                      <p className="mt-1 text-sm text-[#7b8996]">
                        Send external USDT on TRON; confirmed funds are converted to Coins using a
                        fresh saved rate.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span className="rounded-lg border border-[#2e3841] bg-[#181d21] px-3 py-1.5 text-xs font-semibold text-[#d2d8df]">
                        USDT
                      </span>
                      <span className="rounded-lg border border-[#2e3841] bg-[#181d21] px-3 py-1.5 text-xs font-semibold text-[#d2d8df]">
                        TRC-20
                      </span>
                    </div>
                  </div>

                  {!depositEnabled ? (
                    <RailUnavailableNotice
                      text={
                        settlementRail?.disabledReason ??
                        "USDT deposits are unavailable. No active deposit operation is exposed."
                      }
                    />
                  ) : null}

                  <form
                    className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]"
                    onSubmit={handleDepositIntent}
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#7b8996]">
                        Deposit address
                      </p>
                      {wallet ? (
                        <div className="mt-2 flex items-center gap-2 rounded-xl border border-[#2e3841] bg-[#181d21] p-2 pl-3">
                          <code className="min-w-0 flex-1 truncate text-sm text-[#dee3e7]">
                            {wallet.address}
                          </code>
                          <button
                            aria-label="Copy deposit address"
                            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#2e3841] bg-[#242b32] px-3 py-2 text-xs font-semibold text-[#d2d8df] transition hover:bg-[#2e3841]"
                            onClick={() => void handleCopyAddress()}
                            type="button"
                          >
                            {addressCopied ? <Check size={15} /> : <Copy size={15} />}
                            {addressCopied ? "Copied" : "Copy"}
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-[#7b8996]">
                          No deposit address available.
                        </p>
                      )}
                      <p className="mt-2 text-xs leading-relaxed text-[#697d91]">
                        Network: {RAIL_LABEL}. Only send USDT using TRC-20.
                      </p>

                      <label className="mt-5 block text-sm font-medium text-[#afbac5]">
                        Payment reference{" "}
                        <span className="font-normal text-[#697d91]">(optional)</span>
                        <input
                          className="mt-2 w-full rounded-xl border border-[#2e3841] bg-[#181d21] px-4 py-3 text-sm text-[#dee3e7] outline-none placeholder:text-[#697d91] focus:border-[#0093fd] focus:ring-1 focus:ring-[#0093fd]"
                          disabled={!depositEnabled}
                          placeholder="Optional note (not proof of payment)"
                          type="text"
                          value={depositReference}
                          onChange={(event) => setDepositReference(event.target.value)}
                        />
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[#afbac5]">
                        Amount
                        <div className="mt-2 flex items-center rounded-xl border border-[#2e3841] bg-[#181d21] px-4 focus-within:border-[#0093fd] focus-within:ring-1 focus-within:ring-[#0093fd]">
                          <input
                            className="min-w-0 flex-1 bg-transparent py-3 pr-2 text-2xl font-semibold text-[#dee3e7] outline-none"
                            disabled={!depositEnabled}
                            inputMode="decimal"
                            pattern="[0-9]+([.][0-9]{1,6})?"
                            type="text"
                            value={depositAmount}
                            onChange={(event) => setDepositAmount(event.target.value)}
                          />
                          <span className="text-sm font-semibold text-[#7b8996]">USDT</span>
                        </div>
                      </label>

                      <div className="mt-3 grid grid-cols-4 gap-2">
                        {DEPOSIT_QUICK_AMOUNTS.map((amount) => (
                          <button
                            className={`rounded-lg border px-2 py-2 text-sm font-semibold transition ${
                              depositAmount === amount
                                ? "border-[#0093fd] bg-[#0093fd]/12 text-[#26a3fd]"
                                : "border-[#2e3841] bg-[#181d21] text-[#afbac5] hover:bg-[#242b32]"
                            }`}
                            disabled={!depositEnabled}
                            key={amount}
                            onClick={() => setDepositAmount(amount)}
                            type="button"
                          >
                            {amount} USDT
                          </button>
                        ))}
                      </div>

                      <button
                        className="mt-5 w-full rounded-xl bg-[#0093fd] px-4 py-3 text-sm font-bold text-white shadow-[0_4px_0_#006fbe] transition hover:bg-[#26a3fd] active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isDepositCreating || !wallet || !depositEnabled}
                        type="submit"
                      >
                        {isDepositCreating
                          ? "Creating deposit..."
                          : depositEnabled
                            ? "Create deposit instructions"
                            : "Deposits unavailable"}
                      </button>
                    </div>
                  </form>

                  {depositStatus ? (
                    <div className="mt-4 flex items-center gap-2 rounded-xl bg-[#3db468]/12 px-3 py-2.5 text-sm text-[#5fbe82]">
                      <Check size={16} />
                      {depositStatus}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div>
                    <h2 className="text-xl font-semibold text-[#dee3e7]">Withdraw USDT</h2>
                    <p className="mt-1 text-sm text-[#7b8996]">
                      Quote Coins to external USDT, reserve the Coin amount, and submit for manual
                      review.
                    </p>
                  </div>

                  {!withdrawalEnabled ? (
                    <RailUnavailableNotice
                      text={
                        settlementRail?.disabledReason ??
                        "USDT withdrawals are unavailable. No active withdrawal operation is exposed."
                      }
                    />
                  ) : null}

                  <form
                    className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
                    onSubmit={handleWithdraw}
                  >
                    <label className="block text-sm font-medium text-[#afbac5]">
                      Amount
                      <div className="mt-2 flex items-center rounded-xl border border-[#2e3841] bg-[#181d21] px-4 focus-within:border-[#0093fd] focus-within:ring-1 focus-within:ring-[#0093fd]">
                        <input
                          className="min-w-0 flex-1 bg-transparent py-3 pr-2 text-2xl font-semibold text-[#dee3e7] outline-none"
                          disabled={!withdrawalEnabled}
                          inputMode="decimal"
                          pattern="[0-9]+([.][0-9]{1,6})?"
                          required
                          type="text"
                          value={withdrawAmount}
                          onChange={(event) => {
                            setWithdrawAmount(event.target.value);
                            setWithdrawalQuote(null);
                          }}
                        />
                        <span className="text-sm font-semibold text-[#7b8996]">Coins</span>
                      </div>
                    </label>

                    <label className="block text-sm font-medium text-[#afbac5]">
                      Destination address
                      <input
                        className="mt-2 w-full rounded-xl border border-[#2e3841] bg-[#181d21] px-4 py-4 font-mono text-sm text-[#dee3e7] outline-none placeholder:text-[#697d91] focus:border-[#0093fd] focus:ring-1 focus:ring-[#0093fd]"
                        placeholder="TRON address (T...)"
                        disabled={!withdrawalEnabled}
                        required
                        type="text"
                        value={withdrawAddress}
                        onChange={(event) => {
                          setWithdrawAddress(event.target.value);
                          setWithdrawalQuote(null);
                        }}
                      />
                    </label>

                    <button
                      className="h-[54px] rounded-xl bg-[#0093fd] px-7 text-sm font-bold text-white shadow-[0_4px_0_#006fbe] transition hover:bg-[#26a3fd] active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isWithdrawSubmitting || !withdrawalEnabled}
                      type="submit"
                    >
                      {isWithdrawSubmitting
                        ? "Submitting..."
                        : withdrawalEnabled
                          ? "Request quote"
                          : "Withdrawals unavailable"}
                    </button>
                  </form>

                  {withdrawalQuote ? (
                    <section
                      aria-label="Withdrawal quote"
                      className="mt-5 rounded-xl border border-[#2e3841] bg-[#181d21] p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#dee3e7]">
                            Withdrawal quote
                          </p>
                          <p className="mt-1 text-xs text-[#7b8996]">
                            Expires {formatRelativeTime(withdrawalQuote.expiresAt)}
                          </p>
                        </div>
                        <span className="rounded-full bg-[#f7d022]/14 px-3 py-1 text-xs font-semibold text-[#f8da52]">
                          Under review after confirmation
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <QuoteMetric
                          label="Coins reserved"
                          value={formatCoinMicros(withdrawalQuote.coinToDebitMicros)}
                        />
                        <QuoteMetric
                          label="External USDT"
                          value={formatAssetAmount(
                            withdrawalQuote.estimatedUsdtAtomic,
                            "USDT",
                            { atomic: true },
                          )}
                        />
                        <QuoteMetric
                          label="Rate"
                          value={`${formatUsdReference(
                            withdrawalQuote.rateSnapshot.rateDecimal,
                          )} / USDT`}
                        />
                        <QuoteMetric
                          label="Fees"
                          value={`${formatAssetAmount(
                            withdrawalQuote.networkFeeUsdtAtomic,
                            "USDT",
                            { atomic: true },
                          )} network · ${formatAssetAmount(
                            withdrawalQuote.providerFeeUsdtAtomic,
                            "USDT",
                            { atomic: true },
                          )} provider`}
                        />
                      </dl>
                      <p className="mt-3 text-xs text-[#697d91]">
                        Rate from {withdrawalQuote.rateSnapshot.source} at{" "}
                        {formatRelativeTime(withdrawalQuote.rateSnapshot.quotedAt)}.
                      </p>
                      <button
                        className="mt-4 h-11 rounded-xl bg-[#0093fd] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={
                          isWithdrawSubmitting ||
                          withdrawalQuote.status !== "open" ||
                          Date.parse(withdrawalQuote.expiresAt) <= Date.now()
                        }
                        onClick={() => void handleConfirmWithdrawal()}
                        type="button"
                      >
                        {isWithdrawSubmitting
                          ? "Confirming..."
                          : "Confirm and reserve Coins"}
                      </button>
                    </section>
                  ) : null}
                </>
              )}

              <p className="mt-5 border-t border-[#242b32] pt-4 text-xs text-[#697d91]">
                {transferNote}
              </p>
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-[#242b32] bg-[#1e2428] p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-[#dee3e7]">Transactions</h2>
                <p className="mt-1 text-sm text-[#7b8996]">
                  External deposits, reviewed withdrawals, and Coin ledger activity.
                </p>
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-xl border border-[#2e3841] px-3 py-2 text-sm font-semibold text-[#d2d8df] transition hover:bg-[#181d21]"
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
                label="Activity"
                onClick={() => setActiveTab("ledger")}
              />
            </div>

            {activeTab === "deposits" ? (
              <DepositHistory latestIntent={createdDepositIntent} deposits={deposits} />
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

function AccountViewTabs() {
  return (
    <nav
      aria-label="Account views"
      className="inline-flex rounded-xl border border-[#2e3841] bg-[#15191d] p-1"
    >
      <Link
        className="rounded-lg px-5 py-2 text-sm font-semibold text-[#7b8996] transition hover:bg-[#1e2428] hover:text-[#dee3e7]"
        to="/portfolio"
      >
        Portfolio
      </Link>
      <Link
        aria-current="page"
        className="rounded-lg bg-[#2e3841] px-5 py-2 text-sm font-semibold text-[#dee3e7]"
        to="/wallet"
      >
        Coins
      </Link>
    </nav>
  );
}

function WalletShell({ body }: { body: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#181d21]">
      <div className="mx-auto max-w-[1160px] px-4 py-6 sm:px-6 sm:py-8">{body}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="rounded-2xl border border-[#242b32] bg-[#1e2428] p-12 text-center">
      <p className="text-[#7b8996]">Loading Coins...</p>
    </section>
  );
}

function CashActivityChart({ entries }: { entries: CoinLedgerPayload["entries"] }) {
  const recentEntries = entries.slice(0, 18).reverse();
  const maxAmount = recentEntries.reduce((largest, entry) => {
    const magnitude = getCoinEntryMagnitude(entry);
    return magnitude > largest ? magnitude : largest;
  }, 1n);

  if (recentEntries.length === 0) {
    return (
      <div className="mt-6 flex h-[70px] items-end">
        <div className="h-px w-full bg-[#0093fd]/55" />
      </div>
    );
  }

  return (
    <div
      aria-label="Recent Coin activity"
      className="mt-5 flex h-[70px] items-end gap-1.5 overflow-hidden border-b border-[#0093fd]/35"
    >
      {recentEntries.map((entry) => {
        const magnitude = getCoinEntryMagnitude(entry);
        const height = magnitude === 0n ? 8n : 8n + (magnitude * 92n) / maxAmount;

        return (
          <span
            className={`min-w-1 flex-1 rounded-t-sm ${
              isPositiveCoinEntry(entry.operationType)
                ? "bg-gradient-to-t from-[#006fbe] to-[#26a3fd]"
                : "bg-gradient-to-t from-[#254865] to-[#7b8996]"
            }`}
            key={entry.id}
            style={{ height: `${height.toString()}%` }}
            title={`${ledgerReasonLabel(entry.reason)}: ${formatCoinEntryMovement(entry)}`}
          />
        );
      })}
    </div>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-medium text-[#697d91]">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-[#dee3e7]">
        {formatCoinMicros(value)}
      </p>
    </div>
  );
}

function ActionButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition ${
        active
          ? "bg-[#0093fd] text-white shadow-[0_3px_0_#006fbe]"
          : "border border-[#2e3841] bg-[#181d21] text-[#d2d8df] hover:bg-[#242b32]"
      } disabled:cursor-not-allowed disabled:border-[#2e3841] disabled:bg-[#181d21] disabled:text-[#697d91] disabled:shadow-none`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function ActionTab({
  active,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`rounded-lg px-5 py-2 text-sm font-semibold transition ${
        active
          ? "bg-[#2e3841] text-[#dee3e7]"
          : "text-[#7b8996] hover:bg-[#181d21] hover:text-[#dee3e7]"
      } disabled:cursor-not-allowed disabled:text-[#697d91]`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
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
  latestIntent,
  deposits,
}: {
  latestIntent: DepositIntent | null;
  deposits: WalletDepositsPayload["deposits"];
}) {
  if (!latestIntent && deposits.length === 0) {
    return <EmptyState text="No deposits yet." />;
  }

  return (
    <div className="space-y-3">
      {latestIntent ? (
        <HistoryRow
          title={`${formatAssetAmount(latestIntent.expectedUsdtAtomic, "USDT", {
            atomic: true,
          })} expected`}
          meta={`Pending deposit intent · ${latestIntent.network} · ${formatRelativeTime(
            latestIntent.createdAt,
          )}`}
          status={latestIntent.status}
          detail="Pending deposits never count toward Available Coins."
        />
      ) : null}
      {deposits.map((deposit) => (
        <HistoryRow
          key={deposit.id}
          title={
            deposit.creditedCoinMicros
              ? formatCoinMicros(deposit.creditedCoinMicros)
              : formatAssetAmount(deposit.netUsdtAtomic, "USDT", { atomic: true })
          }
          meta={`${formatAssetAmount(deposit.grossUsdtAtomic, "USDT", {
            atomic: true,
          })} external · ${deposit.actualConfirmations}/${deposit.requiredConfirmations} confirmations`}
          status={deposit.status}
          detail={depositDetail(deposit)}
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
          title={formatCoinMicros(withdrawal.coinReservedMicros)}
          meta={`${withdrawal.network} request · ${formatRelativeTime(withdrawal.createdAt)}`}
          status={withdrawal.status}
          detail={`${formatAssetAmount(withdrawal.estimatedUsdtAtomic, "USDT", {
            atomic: true,
          })} external · ${formatAssetAmount(withdrawal.networkFeeUsdtAtomic, "USDT", {
            atomic: true,
          })} network fee · To ${withdrawal.destinationAddress}`}
        />
      ))}
    </div>
  );
}

function LedgerHistory({ entries }: { entries: CoinLedgerPayload["entries"] }) {
  if (entries.length === 0) {
    return <EmptyState text="No balance history yet." />;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <HistoryRow
          key={entry.id}
          title={formatCoinEntryMovement(entry)}
          meta={`${ledgerReasonLabel(entry.reason)} · ${formatRelativeTime(entry.createdAt)}`}
          status={entry.operationType}
          detail={ledgerEntryDetail(entry)}
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

function RailUnavailableNotice({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-xl border border-[#f7d022]/30 bg-[#f7d022]/10 px-4 py-3 text-sm font-medium text-[#f8da52]">
      {text}
    </div>
  );
}

function QuoteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#697d91]">{label}</dt>
      <dd className="mt-1 font-semibold text-[#dee3e7]">{value}</dd>
    </div>
  );
}

function isPositiveCoinEntry(operationType: string) {
  return (
    operationType.endsWith("_credit") ||
    operationType.endsWith("_release") ||
    operationType === "migration_credit"
  );
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

function ledgerEntryDetail(entry: CoinLedgerPayload["entries"][number]) {
  const balance = `${formatCoinMicros(entry.availableAfterCoinMicros)} available · ${formatCoinMicros(
    entry.reservedAfterCoinMicros,
  )} reserved`;
  return entry.sourceId ? `${ledgerReferenceLabel(entry.sourceType)} · ${balance}` : balance;
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

function getCoinEntryMagnitude(entry: CoinLedgerPayload["entries"][number]) {
  const available = BigInt(entry.availableDeltaCoinMicros);
  const reserved = BigInt(entry.reservedDeltaCoinMicros);
  const availableMagnitude = available < 0n ? -available : available;
  const reservedMagnitude = reserved < 0n ? -reserved : reserved;
  return availableMagnitude > reservedMagnitude ? availableMagnitude : reservedMagnitude;
}

function formatCoinEntryMovement(entry: CoinLedgerPayload["entries"][number]) {
  const available = BigInt(entry.availableDeltaCoinMicros);
  const reserved = BigInt(entry.reservedDeltaCoinMicros);
  if (available !== 0n) {
    return `${formatSignedCoinMicros(available)} available`;
  }
  return `${formatSignedCoinMicros(reserved)} reserved`;
}

function depositDetail(deposit: WalletDepositsPayload["deposits"][number]) {
  if (deposit.status === "pending_rate" || deposit.status === "confirmed_unpriced") {
    return "Awaiting rate; no Coins are available yet.";
  }
  if (deposit.status === "manual_review") {
    return deposit.manualReviewReason
      ? `Manual review: ${deposit.manualReviewReason}`
      : "Manual review required.";
  }
  return `${deposit.blockchainTxHash}:${deposit.eventIndex} · ${deposit.tokenContract}`;
}

function statusLabel(status: string) {
  if (status === "pending_review") {
    return "Under review";
  }

  if (status === "waiting") {
    return "Pending deposit";
  }

  if (status === "pending_rate" || status === "confirmed_unpriced") {
    return "Awaiting rate";
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

  if (
    ["waiting", "detected", "confirming", "pending_rate", "confirmed_unpriced", "pending_review", "hold"].includes(
      status,
    )
  ) {
    return "bg-[#f7d022]/14 text-[#f8da52]";
  }

  if (["rejected", "failed", "debit", "trade_debit"].includes(status)) {
    return "bg-[#cb3131]/14 text-[#d05959]";
  }

  return "bg-[#242b32] text-[#afbac5]";
}
