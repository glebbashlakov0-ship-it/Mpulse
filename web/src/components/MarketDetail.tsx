import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Code2,
  Gift,
  Link2,
  MessageCircle,
  SlidersHorizontal,
  SmilePlus,
} from "lucide-react";
import { loadComplianceEligibility, placeTradeApi, resetPortfolioApi } from "../lib/api";
import {
  getTradingBlockerReasons,
  isEligibleToTrade,
} from "../lib/eligibility";
import {
  formatCents,
  formatDate,
  formatMoney,
  formatPercent,
  formatRelativeTime,
  formatShares,
  formatShortDate,
  formatUsdt,
} from "../lib/format";
import { getMarketKind, getOutcomeActionLabel } from "../lib/market";
import type { Market } from "../lib/types";
import type { ComplianceEligibilityPayload } from "../lib/types";
import { usePortfolio } from "../hooks/usePortfolio";
import { MarketChart } from "./MarketChart";
import { MarketImage, OutcomeAvatar, RelatedMarketImage } from "./MarketMedia";

const panel = "rounded-[14px] border border-[#293440] bg-[#171d24]";
const iconButton =
  "grid h-10 w-10 place-items-center rounded-lg border border-[#293440] text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]";
const tabButton = "rounded-lg px-4 py-2 text-sm font-semibold transition";

export function MarketDetail({
  market,
  detailStatus,
  onBack,
}: {
  market: Market;
  detailStatus: "idle" | "loading" | "ready" | "error";
  onBack: () => void;
}) {
  const [side, setSide] = React.useState<"yes" | "no">("yes");
  const [action, setAction] = React.useState<"buy" | "sell">("buy");
  const [amount, setAmount] = React.useState("100");
  const [portfolio, setPortfolio] = usePortfolio();
  const [isPlacingTrade, setIsPlacingTrade] = React.useState(false);
  const [eligibility, setEligibility] = React.useState<ComplianceEligibilityPayload | null>(null);
  const [eligibilityStatus, setEligibilityStatus] = React.useState<"loading" | "ready" | "blocked">(
    "loading",
  );
  const [tradeMessage, setTradeMessage] = React.useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const yes = market.outcomes.find((outcome) => outcome.name.toLowerCase() === "yes");
  const no = market.outcomes.find((outcome) => outcome.name.toLowerCase() === "no");
  const selectedPrice = side === "yes" ? yes?.price ?? null : no?.price ?? null;
  const amountValue = Number(amount);
  const estimatedShares =
    selectedPrice && Number.isFinite(amountValue) && amountValue > 0
      ? amountValue / selectedPrice
      : 0;
  const currentPosition = portfolio.positions.find(
    (position) => position.marketId === market.id,
  );
  const selectedSideShares =
    side === "yes" ? currentPosition?.yesShares ?? 0 : currentPosition?.noShares ?? 0;
  const marketTrades = portfolio.trades.filter((trade) => trade.marketId === market.id);
  const primaryOutcome = market.outcomes[0];
  const secondaryOutcome = market.outcomes[1];
  const selectedOutcomeLabel =
    side === "yes" ? primaryOutcome?.name ?? "Yes" : secondaryOutcome?.name ?? "No";
  const displayOutcomes =
    market.outcomes.length > 0
      ? market.outcomes.slice(0, 6)
      : [
          { name: "Yes", price: yes?.price ?? 0.5, clobTokenId: null },
          { name: "No", price: no?.price ?? 0.5, clobTokenId: null },
        ];
  const relatedMarkets = market.related_markets?.slice(0, 4) ?? [];
  const snapshots = market.history?.snapshots ?? [];
  const timelineDates = [market.starts_at, market.ends_at].filter(Boolean).map(formatShortDate);
  const canTrade = eligibilityStatus === "ready" && isEligibleToTrade(eligibility);
  const isCheckingEligibility = eligibilityStatus === "loading";
  const tradingBlockers = getTradingBlockerReasons(eligibility);
  const canPlaceTrade =
    canTrade &&
    !isPlacingTrade &&
    selectedPrice !== null &&
    selectedPrice > 0 &&
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    (action === "buy"
      ? amountValue <= portfolio.wallet.balance
      : estimatedShares <= selectedSideShares);

  React.useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setEligibility(null);
        setEligibilityStatus("blocked");
      }
    }, 6000);

    setEligibilityStatus("loading");
    loadComplianceEligibility()
      .then((nextEligibility) => {
        if (!cancelled) {
          window.clearTimeout(timeout);
          setEligibility(nextEligibility);
          setEligibilityStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          window.clearTimeout(timeout);
          setEligibility(null);
          setEligibilityStatus("blocked");
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  async function placeTrade() {
    if (!canTrade) {
      setTradeMessage({
        tone: "error",
        text: tradingBlockers[0] ?? "Complete account verification before trading.",
      });
      return;
    }

    if (!selectedPrice || selectedPrice <= 0) {
      setTradeMessage({ tone: "error", text: "Price is not available for this side yet." });
      return;
    }

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setTradeMessage({ tone: "error", text: "Enter a valid USDT amount." });
      return;
    }

    if (action === "buy" && amountValue > portfolio.wallet.balance) {
      setTradeMessage({ tone: "error", text: "Insufficient balance." });
      return;
    }

    if (action === "sell" && estimatedShares > selectedSideShares) {
      setTradeMessage({ tone: "error", text: "Insufficient shares for this sale." });
      return;
    }

    setIsPlacingTrade(true);
    setTradeMessage({ tone: "info", text: "Placing order..." });
    try {
      const result = await placeTradeApi({
        marketId: market.id,
        side,
        action,
        amount: amountValue,
      });
      setPortfolio(result.portfolio);
      setTradeMessage({
        tone: "success",
        text:
          action === "buy"
            ? `Bought ${formatShares(result.trade.shares)} ${selectedOutcomeLabel} shares for ${formatUsdt(amountValue)}.`
            : `Sold ${formatShares(result.trade.shares)} ${selectedOutcomeLabel} shares for ${formatUsdt(result.trade.amount)}.`,
      });
    } catch (error) {
      setTradeMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not place trade.",
      });
    } finally {
      setIsPlacingTrade(false);
    }
  }

  async function resetPortfolio() {
    if (!window.confirm("Reset your portfolio to 10,000 USDT and clear trade history?")) {
      return;
    }

    try {
      const nextPortfolio = await resetPortfolioApi();
      setPortfolio(nextPortfolio);
      setTradeMessage({ tone: "success", text: "Portfolio reset to 10,000 USDT." });
    } catch (error) {
      setTradeMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not reset portfolio.",
      });
    }
  }

  function addQuickAmount(value: number) {
    const currentAmount = Number(amount);
    const nextAmount = Number.isFinite(currentAmount) ? currentAmount + value : value;
    const maxAmount =
      action === "buy" ? portfolio.wallet.balance : selectedSideShares * (selectedPrice ?? 0);
    setAmount(String(Math.min(maxAmount, nextAmount)));
  }

  function setMaxAmount() {
    const maxAmount =
      action === "buy" ? portfolio.wallet.balance : selectedSideShares * (selectedPrice ?? 0);
    setAmount(String(Math.max(0, Math.floor(maxAmount))));
  }

  return (
    <section className="mx-auto w-full max-w-[1500px] overflow-x-hidden px-4 py-6 md:px-6 md:py-8 xl:px-8">
      <button
        className="flex w-fit items-center gap-2 rounded-lg border border-[#293440] px-4 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]"
        onClick={onBack}
      >
        <ArrowLeft size={18} />
        All markets
      </button>

      <div className="mt-6 grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_380px]">
        <article className="min-w-0 overflow-hidden">
          {detailStatus === "error" ? (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm font-semibold text-red-200">
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
              <span>
                The market detail request failed. Showing the latest available market preview.
              </span>
            </div>
          ) : null}

          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 gap-3 sm:gap-4">
              <MarketImage market={market} className="h-14 w-14 sm:h-16 sm:w-16" />
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-[#8f9aa8]">
                  <span>{getMarketKind(market)}</span>
                  <span>·</span>
                  <span>{market.dates?.status ?? "Market Pulse"}</span>
                  <span>·</span>
                  <span>{detailStatus === "ready" ? "Live detail" : "Market preview"}</span>
                </div>
                <h1 className="max-w-4xl break-words text-2xl font-semibold leading-tight tracking-normal text-[#edf1f5] sm:text-3xl md:text-4xl">
                  {market.title}
                </h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button className={iconButton} aria-label="Embed market">
                <Code2 size={20} />
              </button>
              <button className={iconButton} aria-label="Copy market link">
                <Link2 size={20} />
              </button>
              <button className={iconButton} aria-label="Save market">
                <Bookmark size={20} />
              </button>
            </div>
          </div>

          <div className="mt-7 grid gap-4 rounded-lg border border-[#293440] bg-[#171d24] p-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailStat label="Volume" value={formatMoney(market.volume_detail?.volume ?? market.volume)} />
            <DetailStat label="Liquidity" value={formatMoney(market.volume_detail?.liquidity ?? market.liquidity)} />
            <DetailStat label="Starts" value={formatDate(market.dates?.starts_at ?? market.starts_at)} />
            <DetailStat label="Closes" value={formatDate(market.dates?.ends_at ?? market.ends_at)} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {timelineDates.length > 0 ? timelineDates.map((date, index) => (
              <button
                className={`${tabButton} ${
                  index === 0
                    ? "bg-[#edf1f5] text-[#0f1318]"
                    : "bg-[#171d24] text-[#8f9aa8] hover:text-[#edf1f5]"
                }`}
                key={date}
              >
                {date}
              </button>
            )) : (
              <span className={`${tabButton} bg-[#171d24] text-[#8f9aa8]`}>Dates TBD</span>
            )}
            <span className={`${tabButton} bg-[#171d24] text-[#8f9aa8]`}>
              {snapshots.length} snapshots
              <ChevronRight className="ml-1 inline" size={15} />
            </span>
          </div>

          <div className="mt-6 flex flex-wrap gap-4 text-sm font-semibold text-[#8f9aa8]">
            {displayOutcomes.slice(0, 4).map((outcome, index) => (
              <span className="flex min-w-0 max-w-full items-center gap-2" key={`${outcome.name}-${index}`}>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    index === 0
                      ? "bg-blue-300"
                      : index === 1
                        ? "bg-blue-500"
                        : index === 2
                          ? "bg-[#f4bd3f]"
                          : "bg-orange-400"
                  }`}
                />
                <span className="min-w-0 truncate">{outcome.name}</span>
                <strong className="shrink-0">{formatPercent(outcome.price)}</strong>
              </span>
            ))}
          </div>

          <MarketChart outcomes={displayOutcomes} snapshots={snapshots} />

          <div className="mt-5 flex flex-col gap-4 border-b border-[#293440] pb-5 text-sm font-semibold text-[#8f9aa8] md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Gift size={17} />
              <span>{formatMoney(market.volume)} Vol.</span>
              <span className="h-1 w-1 rounded-full bg-[#8f9aa8]/50" />
              <span>{formatMoney(market.liquidity)} Liq.</span>
              <span className="h-1 w-1 rounded-full bg-[#8f9aa8]/50" />
              <Clock3 size={17} />
              <span>{formatDate(market.ends_at)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {["1H", "6H", "1D", "1W", "1M", "ALL"].map((range) => (
                <button
                  className={`transition hover:text-[#edf1f5] ${range === "ALL" ? "text-[#edf1f5]" : ""}`}
                  key={range}
                >
                  {range}
                </button>
              ))}
              <SlidersHorizontal size={18} />
            </div>
          </div>

          <div className="mt-4 grid gap-0 divide-y divide-[#293440]">
            {displayOutcomes.map((outcome, index) => {
              const price = outcome.price ?? outcome.probability ?? null;
              const isBinaryMarket = market.outcomes.length === 2;
              const normalizedOutcomeName = outcome.name.trim().toLowerCase();
              const tradeSide =
                normalizedOutcomeName === "no" || (!isBinaryMarket && index === 1)
                  ? "no"
                  : "yes";
              const isTradableOutcome = isBinaryMarket && index < 2;
              const actionLabel = isTradableOutcome
                ? `Buy ${getOutcomeActionLabel(outcome.name, true)}`
                : `View ${getOutcomeActionLabel(outcome.name, false)}`;

              return (
                <div
                  className="grid min-w-0 gap-3 py-4 md:grid-cols-[minmax(0,1fr)_110px_170px] md:items-center"
                  key={`${outcome.name}-${index}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <OutcomeAvatar market={market} outcome={outcome} index={index} />
                    <div className="min-w-0">
                      <strong className="block truncate text-base font-semibold text-[#edf1f5]">
                        {outcome.name}
                      </strong>
                      <span className="text-sm font-semibold text-[#8f9aa8]">
                        {formatMoney(Math.max(market.volume / (index + 1.8), 25000))} Vol.
                      </span>
                    </div>
                  </div>
                  <div>
                    <strong className="block text-3xl font-semibold text-[#edf1f5]">
                      {formatPercent(price)}
                    </strong>
                    <span className="text-sm font-semibold text-[#8f9aa8]">
                      Current market price
                    </span>
                  </div>
                  <button
                    className={`min-w-0 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      tradeSide === "no"
                        ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                        : "bg-green-500/20 text-green-300 hover:bg-green-500/30"
                    }`}
                    disabled={!isTradableOutcome || price === null || !canTrade}
                    onClick={() => {
                      setSide(tradeSide);
                      setAction("buy");
                    }}
                  >
                    <span className="block truncate">
                      {actionLabel} {formatCents(price)}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className={`${panel} mt-8 p-5`}>
            <div className="flex gap-5 text-lg font-semibold">
              <button className="text-[#edf1f5]">Rules</button>
              <button className="text-[#8f9aa8]">Market Context</button>
            </div>
            <p className="mt-5 break-words text-base leading-7 text-[#edf1f5]">
              {market.description ||
                "This market resolves according to the official source event definition."}
            </p>
            <p className="mt-4 break-words text-base leading-7 text-[#edf1f5]">
              Market Pulse mirrors public market data and displays available prices, outcomes, and
              market activity for this contract.
            </p>
          </div>

          <div className={`${panel} mt-6 p-5`}>
            <div className="flex flex-wrap gap-5 text-base font-semibold">
              <button className="text-[#edf1f5]">Comments (4,016)</button>
              <button className="text-[#8f9aa8]">Top Holders</button>
              <button className="text-[#8f9aa8]">Positions</button>
              <button className="text-[#8f9aa8]">Activity</button>
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-lg border border-[#293440] bg-[#0f1318] px-4 py-3 text-[#8f9aa8]">
              <span className="min-w-0 flex-1 truncate">Add a comment...</span>
              <SmilePlus size={18} />
              <button className="rounded-lg bg-blue-500/25 px-4 py-2 text-sm font-semibold text-[#3b91f6]">
                Post
              </button>
            </div>
            <div className="mt-5 flex gap-4">
              <span className="h-11 w-11 shrink-0 rounded-full bg-linear-to-br from-purple-500 via-pink-500 to-orange-400" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <strong className="text-sm font-semibold text-[#edf1f5]">Market-Analyst</strong>
                  <span className="text-sm font-semibold text-[#8f9aa8]">20m ago</span>
                </div>
                <p className="mt-2 text-base leading-7 text-[#edf1f5]">
                  Watching the odds move here. The flow feels much closer to a live market screen.
                </p>
              </div>
              <MessageCircle className="text-[#8f9aa8]" size={18} />
            </div>
          </div>
        </article>

        <aside className={`${panel} h-fit min-w-0 overflow-hidden p-4 sm:p-5 xl:sticky xl:top-32`}>
          <div className="flex items-center gap-3">
            <MarketImage market={market} className="h-14 w-14" />
            <div className="min-w-0">
              <strong className="block truncate text-lg font-semibold text-[#edf1f5]">
                {selectedOutcomeLabel}
              </strong>
              <span className="text-sm font-semibold text-[#8f9aa8]">
                Balance {formatUsdt(portfolio.wallet.balance)}
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-b border-[#293440] pb-3">
            <div className="flex gap-4 text-lg font-semibold">
              <button
                className={action === "buy" ? "text-[#edf1f5]" : "text-[#8f9aa8]"}
                onClick={() => setAction("buy")}
              >
                Buy
              </button>
              <button
                className={action === "sell" ? "text-[#edf1f5]" : "text-[#8f9aa8]"}
                onClick={() => setAction("sell")}
              >
                Sell
              </button>
            </div>
            <button className="flex items-center gap-1 text-sm font-semibold text-[#edf1f5]">
              Market
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="mt-5 grid min-w-0 grid-cols-2 gap-3">
            <button
              className={`min-w-0 rounded-lg px-3 py-4 text-base font-semibold transition sm:px-4 sm:text-lg ${
                side === "yes"
                  ? "bg-green-500/80 text-white"
                  : "bg-[#1d252e] text-[#8f9aa8] hover:text-[#edf1f5]"
              }`}
              onClick={() => setSide("yes")}
            >
              <span className="block truncate">
                {primaryOutcome?.name ?? "Yes"} {formatCents(yes?.price ?? primaryOutcome?.price ?? null)}
              </span>
            </button>
            <button
              className={`min-w-0 rounded-lg px-3 py-4 text-base font-semibold transition sm:px-4 sm:text-lg ${
                side === "no"
                  ? "bg-red-500/80 text-white"
                  : "bg-[#1d252e] text-[#8f9aa8] hover:text-[#edf1f5]"
              }`}
              onClick={() => setSide("no")}
            >
              <span className="block truncate">
                {secondaryOutcome?.name ?? "No"} {formatCents(no?.price ?? secondaryOutcome?.price ?? null)}
              </span>
            </button>
          </div>

          <label className="mt-7 block">
            <span className="text-base font-semibold text-[#edf1f5]">
              {action === "buy" ? "Amount" : "Proceeds"}
            </span>
            <div className="mt-2 flex items-center gap-2 border-b border-[#293440] pb-2">
              <span className="text-4xl font-semibold text-slate-600 sm:text-5xl">$</span>
              <input
                className="min-w-0 flex-1 bg-transparent text-right text-4xl font-semibold text-[#edf1f5] outline-none sm:text-5xl"
                min="1"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            {[1, 5, 10, 100].map((value) => (
              <button
                className="rounded-lg bg-[#1d252e] px-3 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:text-[#edf1f5]"
                onClick={() => addQuickAmount(value)}
                key={value}
              >
                +${value}
              </button>
            ))}
            <button
              className="rounded-lg bg-[#1d252e] px-3 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:text-[#edf1f5]"
              onClick={setMaxAmount}
            >
              Max
            </button>
          </div>

          <div className="mt-5 flex items-center justify-between rounded-lg bg-[#0f1318] px-4 py-3">
            <span className="text-sm font-semibold text-[#8f9aa8]">
              {action === "buy" ? "Estimated shares" : "Shares to sell"}
            </span>
            <strong className="text-sm font-semibold text-[#edf1f5]">
              {formatShares(estimatedShares)}
            </strong>
          </div>

          {action === "sell" ? (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-[#0f1318] px-4 py-3">
              <span className="text-sm font-semibold text-[#8f9aa8]">Available shares</span>
              <strong className="text-sm font-semibold text-[#edf1f5]">
                {formatShares(selectedSideShares)}
              </strong>
            </div>
          ) : null}

          {!canTrade ? (
            <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-sm font-semibold text-amber-100">
              {isCheckingEligibility
                ? "Checking account verification..."
                : tradingBlockers[0] ?? "Complete account verification before trading."}
            </div>
          ) : null}

          <button
            className="mt-4 w-full rounded-lg bg-[#3b91f6] px-5 py-4 text-base font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none disabled:opacity-50"
            disabled={isCheckingEligibility || (canTrade && !canPlaceTrade)}
            onClick={() => {
              if (canTrade) {
                void placeTrade();
              } else {
                window.location.href = "/kyc";
              }
            }}
          >
            {isCheckingEligibility
              ? "Checking verification..."
              : !canTrade
                ? "Complete verification"
                : isPlacingTrade
                  ? "Placing..."
                  : action === "buy"
                    ? "Buy"
                    : "Sell"}
          </button>

          {tradeMessage ? (
            <div
              className={`mt-4 flex items-start gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${
                tradeMessage.tone === "success"
                  ? "bg-green-500/10 text-green-200"
                  : tradeMessage.tone === "error"
                    ? "bg-red-500/10 text-red-200"
                    : "bg-[#0f1318] text-[#edf1f5]"
              }`}
            >
              {tradeMessage.tone === "success" ? (
                <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
              ) : tradeMessage.tone === "error" ? (
                <AlertCircle className="mt-0.5 shrink-0" size={17} />
              ) : null}
              <span className="min-w-0 break-words">{tradeMessage.text}</span>
            </div>
          ) : null}

          <p className="mt-5 text-center text-sm font-medium text-[#8f9aa8]">
            By trading, you agree to the{" "}
            <a className="underline hover:text-[#edf1f5]" href="#terms">
              Terms of Use
            </a>
            .
          </p>

          <div className="mt-6 rounded-lg border border-[#293440] bg-[#0f1318] p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-[#edf1f5]">Your position</h3>
              <button className="text-sm font-semibold text-[#3b91f6]" onClick={resetPortfolio}>
                Reset
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <TicketStat label="Yes shares" value={formatShares(currentPosition?.yesShares ?? 0)} />
              <TicketStat label="No shares" value={formatShares(currentPosition?.noShares ?? 0)} />
              <TicketStat label="Open cost" value={formatUsdt(currentPosition?.totalCost ?? 0)} />
            </div>
          </div>

          <div className="mt-6 border-t border-[#293440] pt-5">
            <div className="mb-4 flex gap-2">
              {["All", getMarketKind(market), "AI"].map((label, index) => (
                <button
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    index === 0
                      ? "bg-[#1d252e] text-[#edf1f5]"
                      : "text-[#8f9aa8] hover:bg-[#1d252e]"
                  }`}
                  key={label}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="grid gap-4">
              {relatedMarkets.length > 0 ? relatedMarkets.map((relatedMarket) => (
                <div className="grid min-w-0 grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3" key={relatedMarket.id}>
                  <RelatedMarketImage relatedMarket={relatedMarket} />
                  <strong className="min-w-0 break-words text-sm font-semibold text-[#edf1f5]">
                    {relatedMarket.title}
                  </strong>
                  <b className="text-lg font-semibold text-[#edf1f5]">
                    {formatPercent(relatedMarket.probability)}
                  </b>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-[#293440] bg-[#0f1318] p-4 text-sm font-semibold text-[#8f9aa8]">
                  No related markets available yet.
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 border-t border-[#293440] pt-5">
            <h3 className="text-base font-semibold text-[#edf1f5]">Trade history</h3>
            {marketTrades.length === 0 ? (
              <p className="mt-3 text-sm font-semibold text-[#8f9aa8]">No trades yet.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {marketTrades.slice(0, 6).map((trade) => (
                  <div
                    className="grid gap-2 rounded-lg bg-[#0f1318] p-3 text-sm"
                    key={trade.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="font-semibold text-[#edf1f5]">
                        {trade.action === "sell" ? "Sell" : "Buy"}{" "}
                        {trade.side === "yes" ? "Yes" : "No"}
                      </strong>
                      <span className="font-semibold text-[#8f9aa8]">
                        {formatRelativeTime(trade.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <strong className="font-semibold text-[#edf1f5]">
                        {formatShares(trade.shares)} shares
                      </strong>
                      <span className="font-semibold text-[#8f9aa8]">
                        {formatUsdt(trade.amount)} @ {formatPercent(trade.price)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function TicketStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs font-bold uppercase tracking-wide text-[#8f9aa8]">
        {label}
      </span>
      <strong className="mt-1 block break-words text-sm font-semibold text-[#edf1f5]">{value}</strong>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs font-bold uppercase tracking-wide text-[#8f9aa8]">
        {label}
      </span>
      <strong className="mt-1 block break-words text-sm font-semibold text-[#edf1f5]">{value}</strong>
    </div>
  );
}
