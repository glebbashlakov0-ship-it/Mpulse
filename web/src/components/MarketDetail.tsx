import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Code2,
  Gift,
  Link2,
  MessageCircle,
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

type GroupMarket = NonNullable<Market["group_markets"]>[number];

const panel = "rounded-3xl border border-[#293440] bg-[#171d24]";
const iconButton =
  "grid h-10 w-10 place-items-center rounded-2xl border border-[#293440] text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]";
const tabButton = "rounded-2xl px-4 py-2 text-sm font-semibold transition";

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
  const [amount, setAmount] = React.useState("0");
  const [showResolvedGroups, setShowResolvedGroups] = React.useState(false);
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
  const groupMarkets = sortGroupMarketsForDetail(market.group_markets ?? []);
  const isGroupedEvent = groupMarkets.length > 1;
  const liveGroupMarkets = groupMarkets.filter(isLiveGroupMarket);
  const resolvedGroupMarkets = groupMarkets.filter((groupMarket) => !isLiveGroupMarket(groupMarket));
  const visibleGroupMarkets = [
    ...liveGroupMarkets,
    ...(showResolvedGroups ? resolvedGroupMarkets : []),
  ];
  const initialSelectedMarketId =
    groupMarkets.find((groupMarket) => groupMarket.id === market.canonical_market_id)?.id ??
    groupMarkets[0]?.id ??
    market.id;
  const [selectedMarketId, setSelectedMarketId] = React.useState(initialSelectedMarketId);
  const selectedGroupMarket =
    groupMarkets.find((groupMarket) => groupMarket.id === selectedMarketId) ??
    groupMarkets[0] ??
    null;
  const tradeMarket = selectedGroupMarket ?? market;
  const yes = tradeMarket.outcomes.find((outcome) => outcome.name.toLowerCase() === "yes");
  const no = tradeMarket.outcomes.find((outcome) => outcome.name.toLowerCase() === "no");
  const selectedPrice = side === "yes" ? yes?.price ?? null : no?.price ?? null;
  const amountValue = Number(amount);
  const estimatedShares =
    selectedPrice && Number.isFinite(amountValue) && amountValue > 0
      ? amountValue / selectedPrice
      : 0;
  const currentPosition = portfolio.positions.find(
    (position) => position.marketId === tradeMarket.id,
  );
  const selectedSideShares =
    side === "yes" ? currentPosition?.yesShares ?? 0 : currentPosition?.noShares ?? 0;
  const marketTrades = portfolio.trades.filter((trade) => trade.marketId === tradeMarket.id);
  const primaryOutcome = tradeMarket.outcomes[0];
  const secondaryOutcome = tradeMarket.outcomes[1];
  const selectedVariantLabel =
    selectedGroupMarket?.label ?? tradeMarket.groupItemTitle ?? tradeMarket.title;
  const selectedOutcomeLabel =
    isGroupedEvent
      ? `${selectedVariantLabel} ${side === "yes" ? "Yes" : "No"}`
      : side === "yes" ? primaryOutcome?.name ?? "Yes" : secondaryOutcome?.name ?? "No";
  const displayOutcomes =
    isGroupedEvent
      ? groupMarkets.map((groupMarket) => ({
          name: groupMarket.label,
          price: groupMarket.yes_price,
          probability: groupMarket.yes_price,
          clobTokenId: groupMarket.clobTokenIds[0] ?? null,
        }))
      : tradeMarket.outcomes.length > 0
        ? tradeMarket.outcomes.slice(0, 6)
      : [
          { name: "Yes", price: yes?.price ?? 0.5, clobTokenId: null },
          { name: "No", price: no?.price ?? 0.5, clobTokenId: null },
        ];
  const relatedMarkets = market.related_markets?.slice(0, 4) ?? [];
  const priceHistory = market.history?.price_history ?? [];
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
    setSelectedMarketId(initialSelectedMarketId);
  }, [initialSelectedMarketId]);

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
        marketId: tradeMarket.id,
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

  if (isGroupedEvent) {
    const marketEndDate = selectedGroupMarket?.ends_at ?? market.ends_at;

    return (
      <section className="mx-auto w-full max-w-[1326px] overflow-x-hidden px-4 py-4 md:px-6 xl:px-0">
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,938px)_340px] xl:items-start">
          <article className="min-w-0 overflow-hidden xl:max-w-[938px]">
            {detailStatus === "error" ? (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm font-semibold text-red-200">
                <AlertCircle className="mt-0.5 shrink-0" size={18} />
                <span>
                  The market detail request failed. Showing the latest available market preview.
                </span>
              </div>
            ) : null}

            <div className="mb-2 flex items-center justify-between gap-4 bg-[#0f1318] py-1">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <MarketImage market={market} className="h-16 w-16 min-w-16 rounded-sm" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex max-h-6 flex-wrap items-center gap-1.5 overflow-hidden text-sm font-semibold text-[#8f9aa8]">
                    <span>{getMarketKind(market)}</span>
                    {market.topics[0] ? (
                      <>
                        <span>·</span>
                        <span className="capitalize">{market.topics[0]}</span>
                      </>
                    ) : null}
                  </div>
                  <h1 className="break-words text-[28px] font-semibold leading-tight tracking-normal text-[#edf1f5]">
                    {market.title}
                  </h1>
                </div>
              </div>

              <div className="hidden shrink-0 items-center gap-1 sm:flex">
                <button className="grid h-9 w-9 place-items-center rounded-full text-[#cbd3dc] transition hover:bg-[#151b22] hover:text-white" aria-label="Embed market">
                  <Code2 size={18} />
                </button>
                <button className="grid h-9 w-9 place-items-center rounded-full text-[#cbd3dc] transition hover:bg-[#151b22] hover:text-white" aria-label="Copy market link">
                  <Link2 size={18} />
                </button>
                <button className="grid h-9 w-9 place-items-center rounded-full text-[#cbd3dc] transition hover:bg-[#151b22] hover:text-white" aria-label="Save market">
                  <Bookmark size={18} />
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 pb-2 pt-2 text-[13px] font-medium tracking-[-0.09px] text-[#8f9aa8]">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="whitespace-nowrap text-[#d8dde5]">{formatMoney(market.volume_detail?.volume ?? market.volume)} Vol.</span>
                <span className="h-2.5 w-[1.5px] shrink-0 rounded-full bg-[#293440]" />
                <Clock3 className="shrink-0" size={12} />
                <span className="whitespace-nowrap">{formatDate(marketEndDate)}</span>
              </div>
              <span className="hidden text-lg font-semibold tracking-normal text-[#293440] sm:block">Polymarket</span>
            </div>

            <div className="clear-both divide-y divide-[#293440] border-y border-[#293440]">
              {visibleGroupMarkets.map((groupMarket) => {
                const isSelected = groupMarket.id === tradeMarket.id;
                const change = getGroupMarketPriceChange(market, groupMarket);

                return (
                  <div
                    className="relative grid min-w-0 gap-3 py-3 md:min-h-18 md:grid-cols-[minmax(0,1fr)_112px_280px] md:items-center"
                    key={groupMarket.id}
                  >
                    <button
                      className="flex min-w-0 flex-col items-start text-left"
                      onClick={() => setSelectedMarketId(groupMarket.id)}
                    >
                      <span className="block max-w-full truncate text-xl font-semibold leading-tight text-[#dce2ea]">
                        {groupMarket.label}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2 text-sm font-medium leading-none text-[#8f9aa8]">
                        {formatMoney(groupMarket.volume)} Vol.
                        {groupMarket.trading.accepting_orders ? <Gift size={16} /> : null}
                      </span>
                    </button>

                    <div className="flex items-baseline gap-2 md:justify-center">
                      <strong className="text-[28px] font-semibold leading-none text-[#edf1f5]">
                        {formatPercent(groupMarket.yes_price)}
                      </strong>
                      {change !== null && change !== 0 ? (
                        <span
                          className={`text-xs font-semibold ${
                            change > 0 ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {change > 0 ? "▲" : "▼"} {formatPercent(Math.abs(change))}
                        </span>
                      ) : null}
                    </div>

                    <div className="grid min-w-0 grid-cols-2 gap-2 md:flex md:justify-end">
                      <button
                        className={`h-12 min-w-0 rounded-sm px-4 text-base font-semibold transition md:w-[136px] ${
                          isSelected && side === "yes"
                            ? "bg-green-500/85 text-white"
                            : "bg-green-500/18 text-green-300 hover:bg-green-500/28"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                        disabled={groupMarket.yes_price === null || !canTrade}
                        onClick={() => {
                          setSelectedMarketId(groupMarket.id);
                          setSide("yes");
                          setAction("buy");
                        }}
                      >
                        <span className="block truncate">Buy Yes {formatCents(groupMarket.yes_price)}</span>
                      </button>
                      <button
                        className={`h-12 min-w-0 rounded-sm px-4 text-base font-semibold transition md:w-[136px] ${
                          isSelected && side === "no"
                            ? "bg-red-500/80 text-white"
                            : "bg-red-500/16 text-red-300 hover:bg-red-500/25"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                        disabled={groupMarket.no_price === null || !canTrade}
                        onClick={() => {
                          setSelectedMarketId(groupMarket.id);
                          setSide("no");
                          setAction("buy");
                        }}
                      >
                        <span className="block truncate">Buy No {formatCents(groupMarket.no_price)}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {resolvedGroupMarkets.length > 0 ? (
              <button
                className="mb-5 mt-2 flex h-8 items-center gap-2 p-0 text-sm font-semibold text-[#8f9aa8] transition hover:text-[#edf1f5]"
                onClick={() => setShowResolvedGroups((current) => !current)}
              >
                {showResolvedGroups ? "Hide resolved" : "View resolved"}
                <ChevronDown
                  className={`transition-transform ${showResolvedGroups ? "rotate-180" : ""}`}
                  size={17}
                />
              </button>
            ) : null}

            <section className="mb-6 mt-8">
              <div className="flex gap-5 text-lg font-semibold">
                <button className="text-[#edf1f5]">Rules</button>
                <button className="text-[#8f9aa8] transition hover:text-[#edf1f5]">Market Context</button>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-[#293440] bg-[#151a20]">
                <div className="flex items-center justify-between gap-4 border-b border-[#293440] px-4 py-4">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-[#edf1f5]">
                    <AlertCircle className="text-[#3b91f6]" size={16} />
                    Additional context
                  </div>
                  <span className="text-xs font-medium text-[#8f9aa8]">
                    Updated {formatShortDate(market.starts_at ?? market.ends_at)}
                  </span>
                </div>
                <p className="px-4 py-3 text-[13px] leading-6 text-[#8f9aa8]">
                  This market's language and available outcomes are shown from the grouped event.
                </p>
              </div>

              <div className="mt-4 space-y-6 text-base leading-7 text-[#d8dde5]">
                {splitDescription(market.description).map((paragraph, index) => (
                  <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
                ))}
              </div>
            </section>

            <section className="mt-12">
              <div className="flex flex-wrap gap-5 text-lg font-semibold">
                <button className="text-[#edf1f5]">Comments</button>
                <button className="text-[#8f9aa8]">Top Holders</button>
                <button className="text-[#8f9aa8]">Positions</button>
                <button className="text-[#8f9aa8]">Activity</button>
              </div>
              <div className="mt-6 flex items-center gap-3 rounded-xl border border-[#293440] bg-[#11161c] px-4 py-3 text-[#8f9aa8]">
                <span className="min-w-0 flex-1 truncate">Add a comment...</span>
                <SmilePlus size={18} />
                <button className="rounded-lg bg-blue-500/25 px-4 py-2 text-sm font-semibold text-[#3b91f6]">
                  Post
                </button>
              </div>
            </section>

            <section className="mt-8">
              <h2 className="mb-2 text-[16px] font-semibold text-[#edf1f5]">Frequently Asked Questions</h2>
              <div className="divide-y divide-[#293440]">
                {buildGroupedFaq(market, visibleGroupMarkets).map((question) => (
                  <button
                    className="flex w-full items-center justify-between gap-4 py-5 text-left text-[14px] font-medium text-[#d8dde5] lg:py-6"
                    key={question}
                  >
                    <span className="min-w-0 break-words">{question}</span>
                    <ChevronDown className="shrink-0 text-[#8f9aa8]" size={12} />
                  </button>
                ))}
              </div>
            </section>
          </article>

          <aside className={`${panel} h-fit min-w-0 overflow-hidden rounded-xl p-0 xl:sticky xl:top-24 xl:w-[340px]`}>
            <div className="flex items-center gap-3 px-4 py-4">
              <MarketImage market={tradeMarket} className="h-12 w-12 rounded-[7px]" />
              <div className="min-w-0">
                <span className="block truncate text-sm font-semibold text-[#8f9aa8]">{market.title}</span>
                <strong className="mt-1 flex min-w-0 items-center gap-1 text-lg font-semibold text-[#edf1f5]">
                  <span className="truncate">{selectedVariantLabel}</span>
                  <span className="shrink-0 text-[#8f9aa8]">·</span>
                  <span className="shrink-0 text-green-400">{side === "yes" ? "Yes" : "No"}</span>
                </strong>
              </div>
            </div>

            <div className="flex items-end justify-between border-b border-[#293440] px-4">
              <div className="flex gap-4 text-lg font-semibold">
                <button
                  className={`relative pb-3 ${action === "buy" ? "text-[#edf1f5]" : "text-[#8f9aa8]"}`}
                  onClick={() => setAction("buy")}
                >
                  Buy
                  {action === "buy" ? <span className="absolute bottom-0 left-0 h-0.5 w-full bg-[#edf1f5]" /> : null}
                </button>
                <button
                  className={`relative pb-3 ${action === "sell" ? "text-[#edf1f5]" : "text-[#8f9aa8]"}`}
                  onClick={() => setAction("sell")}
                >
                  Sell
                  {action === "sell" ? <span className="absolute bottom-0 left-0 h-0.5 w-full bg-[#edf1f5]" /> : null}
                </button>
              </div>
              <button className="flex items-center gap-1 pb-3 text-base font-semibold text-[#d8dde5]">
                Market
                <ChevronDown size={15} />
              </button>
            </div>

            <div className="p-4">
              <div className="grid min-w-0 grid-cols-2 gap-3">
                <button
                  className={`min-w-0 rounded-lg px-3 py-4 text-base font-semibold transition ${
                    side === "yes"
                      ? "bg-green-500/85 text-white"
                      : "bg-[#222932] text-[#8f9aa8] hover:text-[#edf1f5]"
                  }`}
                  onClick={() => setSide("yes")}
                >
                  <span className="block truncate">Yes {formatCents(yes?.price ?? null)}</span>
                </button>
                <button
                  className={`min-w-0 rounded-lg px-3 py-4 text-base font-semibold transition ${
                    side === "no"
                      ? "bg-red-500/80 text-white"
                      : "bg-[#222932] text-[#8f9aa8] hover:text-[#edf1f5]"
                  }`}
                  onClick={() => setSide("no")}
                >
                  <span className="block truncate">No {formatCents(no?.price ?? null)}</span>
                </button>
              </div>

              <label className="mt-9 block">
                <span className="text-base font-semibold text-[#d8dde5]">
                  {action === "buy" ? "Amount" : "Proceeds"}
                </span>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-5xl font-semibold text-[#607083]">$</span>
                  <input
                    className="min-w-0 flex-1 bg-transparent text-right text-5xl font-semibold text-[#607083] outline-none"
                    inputMode="decimal"
                    type="text"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
              </label>

              <div className="mt-7 flex justify-end gap-2">
                {[1, 5, 10, 100].map((value) => (
                  <button
                    className="rounded-lg bg-[#222932] px-3 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:text-[#edf1f5]"
                    onClick={() => addQuickAmount(value)}
                    key={value}
                  >
                    +${value}
                  </button>
                ))}
              </div>

              {!canTrade ? (
                <div className="mt-5 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm font-semibold text-amber-100">
                  {isCheckingEligibility
                    ? "Checking account verification..."
                    : tradingBlockers[0] ?? "Complete account verification before trading."}
                </div>
              ) : null}

              <button
                className="mt-5 w-full rounded-lg bg-[#3b91f6] px-5 py-4 text-base font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none disabled:opacity-50"
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
                      : "Trade"}
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
            </div>

            <p className="border-t border-[#293440] px-4 py-5 text-center text-sm font-medium text-[#8f9aa8]">
              By trading, you agree to the{" "}
              <a className="underline hover:text-[#edf1f5]" href="#terms">
                Terms of Use
              </a>
              .
            </p>

            {relatedMarkets.length > 0 ? (
              <div className="border-t border-dashed border-[#293440] p-4">
                <div className="grid gap-4">
                  {relatedMarkets.slice(0, 3).map((relatedMarket) => (
                    <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3" key={relatedMarket.id}>
                      <RelatedMarketImage relatedMarket={relatedMarket} />
                      <strong className="min-w-0 break-words text-sm font-semibold text-[#edf1f5]">
                        {relatedMarket.title}
                      </strong>
                      <b className="text-lg font-semibold text-[#edf1f5]">
                        {formatPercent(relatedMarket.probability)}
                      </b>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-[1500px] overflow-x-hidden px-4 py-6 md:px-6 md:py-8 xl:px-8">
      <button
        className="flex w-fit items-center gap-2 rounded-2xl border border-[#293440] px-4 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]"
        onClick={onBack}
      >
        <ArrowLeft size={18} />
        All markets
      </button>

      <div className="mt-6 grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_380px]">
        <article className="min-w-0 overflow-hidden">
          {detailStatus === "error" ? (
            <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-semibold text-red-200">
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
                  <span>{market.dates?.status ?? "Pulse Market"}</span>
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

          <div className="mt-7 grid gap-4 rounded-2xl border border-[#293440] bg-[#171d24] p-4 sm:grid-cols-2 lg:grid-cols-4">
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
              {priceHistory.length} price points
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

          <MarketChart outcomes={displayOutcomes} history={market.history} />

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
          </div>

          <div className="mt-4 grid gap-0 divide-y divide-[#293440]">
            {isGroupedEvent ? groupMarkets.map((groupMarket, index) => {
              const isSelected = groupMarket.id === tradeMarket.id;

              return (
                <div
                  className={`grid min-w-0 gap-3 py-4 md:grid-cols-[minmax(0,1fr)_110px_220px] md:items-center ${
                    isSelected ? "bg-[#1d252e]/45 px-3" : ""
                  }`}
                  key={groupMarket.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <OutcomeAvatar market={groupMarket} outcome={{ name: groupMarket.label, price: groupMarket.yes_price, clobTokenId: null }} index={index} />
                    <div className="min-w-0">
                      <strong className="block truncate text-base font-semibold text-[#edf1f5]">
                        {groupMarket.label}
                      </strong>
                      <span className="text-sm font-semibold text-[#8f9aa8]">
                        {formatMoney(groupMarket.volume)} Vol.
                      </span>
                    </div>
                  </div>
                  <div>
                    <strong className="block text-3xl font-semibold text-[#edf1f5]">
                      {formatPercent(groupMarket.yes_price)}
                    </strong>
                    <span className="text-sm font-semibold text-[#8f9aa8]">
                      Yes price
                    </span>
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-2">
                    <button
                      className="min-w-0 rounded-2xl bg-green-500/20 px-3 py-3 text-sm font-semibold text-green-300 transition hover:bg-green-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={groupMarket.yes_price === null || !canTrade}
                      onClick={() => {
                        setSelectedMarketId(groupMarket.id);
                        setSide("yes");
                        setAction("buy");
                      }}
                    >
                      <span className="block truncate">Buy Yes {formatCents(groupMarket.yes_price)}</span>
                    </button>
                    <button
                      className="min-w-0 rounded-2xl bg-red-500/20 px-3 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={groupMarket.no_price === null || !canTrade}
                      onClick={() => {
                        setSelectedMarketId(groupMarket.id);
                        setSide("no");
                        setAction("buy");
                      }}
                    >
                      <span className="block truncate">Buy No {formatCents(groupMarket.no_price)}</span>
                    </button>
                  </div>
                </div>
              );
            }) : displayOutcomes.map((outcome, index) => {
              const price = outcome.price ?? outcome.probability ?? null;
              const isBinaryMarket = tradeMarket.outcomes.length === 2;
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
                    className={`min-w-0 rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
              Pulse Market mirrors public market data and displays available prices, outcomes, and
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
            <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[#293440] bg-[#0f1318] px-4 py-3 text-[#8f9aa8]">
              <span className="min-w-0 flex-1 truncate">Add a comment...</span>
              <SmilePlus size={18} />
              <button className="rounded-2xl bg-blue-500/25 px-4 py-2 text-sm font-semibold text-[#3b91f6]">
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
            <MarketImage market={tradeMarket} className="h-14 w-14" />
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
              className={`min-w-0 rounded-2xl px-3 py-4 text-base font-semibold transition sm:px-4 sm:text-lg ${
                side === "yes"
                  ? "bg-green-500/80 text-white"
                  : "bg-[#1d252e] text-[#8f9aa8] hover:text-[#edf1f5]"
              }`}
              onClick={() => setSide("yes")}
            >
              <span className="block truncate">
                {isGroupedEvent ? "Yes" : primaryOutcome?.name ?? "Yes"} {formatCents(yes?.price ?? primaryOutcome?.price ?? null)}
              </span>
            </button>
            <button
              className={`min-w-0 rounded-2xl px-3 py-4 text-base font-semibold transition sm:px-4 sm:text-lg ${
                side === "no"
                  ? "bg-red-500/80 text-white"
                  : "bg-[#1d252e] text-[#8f9aa8] hover:text-[#edf1f5]"
              }`}
              onClick={() => setSide("no")}
            >
              <span className="block truncate">
                {isGroupedEvent ? "No" : secondaryOutcome?.name ?? "No"} {formatCents(no?.price ?? secondaryOutcome?.price ?? null)}
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
                className="rounded-2xl bg-[#1d252e] px-3 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:text-[#edf1f5]"
                onClick={() => addQuickAmount(value)}
                key={value}
              >
                +${value}
              </button>
            ))}
            <button
              className="rounded-2xl bg-[#1d252e] px-3 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:text-[#edf1f5]"
              onClick={setMaxAmount}
            >
              Max
            </button>
          </div>

          <div className="mt-5 flex items-center justify-between rounded-2xl bg-[#0f1318] px-4 py-3">
            <span className="text-sm font-semibold text-[#8f9aa8]">
              {action === "buy" ? "Estimated shares" : "Shares to sell"}
            </span>
            <strong className="text-sm font-semibold text-[#edf1f5]">
              {formatShares(estimatedShares)}
            </strong>
          </div>

          {action === "sell" ? (
            <div className="mt-3 flex items-center justify-between rounded-2xl bg-[#0f1318] px-4 py-3">
              <span className="text-sm font-semibold text-[#8f9aa8]">Available shares</span>
              <strong className="text-sm font-semibold text-[#edf1f5]">
                {formatShares(selectedSideShares)}
              </strong>
            </div>
          ) : null}

          {!canTrade ? (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm font-semibold text-amber-100">
              {isCheckingEligibility
                ? "Checking account verification..."
                : tradingBlockers[0] ?? "Complete account verification before trading."}
            </div>
          ) : null}

          <button
            className="mt-4 w-full rounded-2xl bg-[#3b91f6] px-5 py-4 text-base font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none disabled:opacity-50"
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
                    ? `Buy ${side === "yes" ? "Yes" : "No"}`
                    : `Sell ${side === "yes" ? "Yes" : "No"}`}
          </button>

          {tradeMessage ? (
            <div
              className={`mt-4 flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
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

          <div className="mt-6 rounded-2xl border border-[#293440] bg-[#0f1318] p-4">
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
                  className={`rounded-2xl px-3 py-2 text-sm font-semibold ${
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
                <div className="rounded-2xl border border-dashed border-[#293440] bg-[#0f1318] p-4 text-sm font-semibold text-[#8f9aa8]">
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
                    className="grid gap-2 rounded-2xl bg-[#0f1318] p-3 text-sm"
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

function isLiveGroupMarket(groupMarket: GroupMarket) {
  return (
    groupMarket.active !== false &&
    groupMarket.closed !== true &&
    groupMarket.archived !== true &&
    groupMarket.trading.accepting_orders !== false &&
    groupMarket.status !== "closed" &&
    groupMarket.status !== "expired"
  );
}

function sortGroupMarketsForDetail(groupMarkets: GroupMarket[]) {
  const withIndex = groupMarkets.map((groupMarket, index) => ({ groupMarket, index }));
  const allDateLabels = withIndex.length > 0 && withIndex.every(({ groupMarket }) => {
    return getMonthDaySortValue(groupMarket.label ?? groupMarket.groupItemTitle ?? groupMarket.title) !== null;
  });

  return withIndex
    .sort((left, right) => {
      if (allDateLabels) {
        const leftDate = getMonthDaySortValue(
          left.groupMarket.label ?? left.groupMarket.groupItemTitle ?? left.groupMarket.title,
        );
        const rightDate = getMonthDaySortValue(
          right.groupMarket.label ?? right.groupMarket.groupItemTitle ?? right.groupMarket.title,
        );

        if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
          return leftDate - rightDate;
        }
      } else {
        const leftPrice = left.groupMarket.yes_price ?? left.groupMarket.outcomes[0]?.price ?? -1;
        const rightPrice = right.groupMarket.yes_price ?? right.groupMarket.outcomes[0]?.price ?? -1;

        if (leftPrice !== rightPrice) {
          return rightPrice - leftPrice;
        }
      }

      return left.index - right.index;
    })
    .map(({ groupMarket }) => groupMarket);
}

function getMonthDaySortValue(label: string) {
  const match = label.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})\b/i,
  );

  if (!match) {
    return null;
  }

  const month = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].findIndex((prefix) => match[1].toLowerCase().startsWith(prefix));
  const day = Number(match[2]);

  if (month < 0 || !Number.isFinite(day)) {
    return null;
  }

  return month * 32 + day;
}

function getGroupMarketPriceChange(
  market: Market,
  groupMarket: Market & { label: string; yes_price: number | null },
) {
  if (groupMarket.yes_price === null) {
    return null;
  }

  const history = market.history?.price_history ?? [];
  const previous = [...history]
    .reverse()
    .map((point) => getHistoryOutcomePrice(point.outcomes, groupMarket.label))
    .find((price) => price !== null);

  if (previous === undefined || previous === null) {
    return null;
  }

  return groupMarket.yes_price - previous;
}

function getHistoryOutcomePrice(
  outcomes: Array<{ name: string; price: number | null }> | undefined,
  label: string,
) {
  if (!Array.isArray(outcomes)) {
    return null;
  }

  const normalizedLabel = normalizeOutcomeLabel(label);
  const match = outcomes.find((outcome) => normalizeOutcomeLabel(outcome.name) === normalizedLabel);

  return match?.price ?? null;
}

function normalizeOutcomeLabel(label: string) {
  return label
    .toLowerCase()
    .replace(/\b0?(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/[,?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitDescription(description: string | null) {
  if (!description?.trim()) {
    return [
      "This market resolves according to the official source event definition.",
      "Pulse Market mirrors public market data and displays available prices, outcomes, and market activity for this contract.",
    ];
  }

  return description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function buildGroupedFaq(market: Market, groupMarkets: Array<Market & { label: string }>) {
  const title = market.title.replace(/\?+$/, "...?");
  const topRows = groupMarkets.slice(0, 2).map((groupMarket) => groupMarket.label);

  return [
    `What is the "${title}" prediction market?`,
    `How much trading activity has "${title}" generated on Polymarket?`,
    `How do I trade on "${title}"?`,
    topRows.length > 0
      ? `What are the current odds for "${title}"?`
      : `What are the current outcomes for "${title}"?`,
    `How will "${title}" be resolved?`,
  ];
}
