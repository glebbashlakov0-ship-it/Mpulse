import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Code2,
  ExternalLink,
  Info,
  Link2,
  MessageCircle,
  SmilePlus,
} from "lucide-react";
import {
  createTradingQuoteApi,
  loadComplianceEligibility,
  loadMarketActivity,
  placeTradeApi,
  postMarketComment,
  resetPortfolioApi,
} from "../lib/api";
import {
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
import { getMarketEyebrowParts, getOutcomeActionLabel, getSourceImage } from "../lib/market";
import { formatMarketText } from "../lib/marketText";
import type {
  ComplianceEligibilityPayload,
  LocalPosition,
  Market,
  MarketActivityItem,
  MarketActivityPayload,
  MarketComment,
  MarketHolder,
  MarketPublicPosition,
  Trade,
  TradingQuote,
} from "../lib/types";
import { usePortfolio } from "../hooks/usePortfolio";
import { MarketChart } from "./MarketChart";
import { MarketImage, OutcomeAvatar } from "./MarketMedia";
import { MarketActivitySkeleton } from "./MarketSkeleton";

type GroupMarket = NonNullable<Market["group_markets"]>[number];
type DetailTab = "rules" | "context";
type ActivityTab = "comments" | "holders" | "positions" | "activity";
type MarketTradeActivityItem = Extract<MarketActivityItem, { type: "trade" }>;
type OrderType = "market" | "limit";
type MarketFaqItem = {
  id: string;
  question: string;
  answer: string[];
};
type FaqOutcome = {
  label: string;
  price: number | null;
};
type LocalComment = {
  id: string;
  author: string;
  time: string;
  text: string;
  positionLabel?: string;
};

const detailPageShell =
  "market-detail-page mx-auto w-full max-w-[1350px] overflow-x-clip px-4 py-4 text-[var(--pm-text-primary)] lg:px-6";
const detailGrid = "grid min-w-0 gap-12 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start";
const panel = "rounded-xl border border-[#e6e8ea] bg-white";
const eventHeader =
  "mb-2 flex w-full flex-col justify-center bg-[var(--pm-background)] py-1";
const eventHeaderRow = "relative flex w-full items-center justify-between gap-4";
const eventHeaderMain = "flex min-w-0 flex-1 items-center gap-4";
const eventHeaderImage = "h-16 w-16 min-w-16 rounded-[7.2px]";
const eventEyebrow =
  "mb-1 flex max-h-6 flex-wrap items-center gap-1 overflow-hidden text-sm font-[540] leading-5 text-[var(--pm-text-secondary)]";
const eventTitle =
  "market-detail-event-title break-words text-[24px] font-semibold leading-7 tracking-normal text-[var(--pm-text-primary)]";
const iconButton =
  "grid h-9 w-9 place-items-center rounded-full text-[#77808d] transition hover:bg-[#f4f5f6] hover:text-[#0e0f11]";
const tabButton = "rounded-md px-3 py-1.5 text-sm font-semibold transition";
const activeTextTabClass = "text-[#0e0f11]";
const inactiveTextTabClass = "text-[#77808d] transition hover:text-[#4b5563]";
const platformFeeRate = 0.02;
const emptyMarketActivity: MarketActivityPayload = {
  comments: [],
  topHolders: [],
  positions: [],
  activity: [],
};

export function MarketDetail({
  market: initialMarket,
  detailStatus,
  onBack,
}: {
  market: Market;
  detailStatus: "idle" | "loading" | "ready" | "error";
  onBack: () => void;
}) {
  const [market, setMarket] = React.useState(initialMarket);
  const [side, setSide] = React.useState<"yes" | "no">("yes");
  const [action, setAction] = React.useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = React.useState<OrderType>("market");
  const [amount, setAmount] = React.useState("0");
  const [limitPriceCents, setLimitPriceCents] = React.useState("0.0");
  const [detailTab, setDetailTab] = React.useState<DetailTab>("rules");
  const [activityTab, setActivityTab] = React.useState<ActivityTab>("comments");
  const [commentText, setCommentText] = React.useState("");
  const [marketActivity, setMarketActivity] =
    React.useState<MarketActivityPayload>(emptyMarketActivity);
  const [marketActivityStatus, setMarketActivityStatus] =
    React.useState<"loading" | "ready" | "error">("loading");
  const [isPostingComment, setIsPostingComment] = React.useState(false);
  const [isSaved, setIsSaved] = React.useState(false);
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
  const [quote, setQuote] = React.useState<TradingQuote | null>(null);
  const [quoteStatus, setQuoteStatus] = React.useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [quoteError, setQuoteError] = React.useState<string | null>(null);
  const groupMarkets = sortGroupMarketsForDetail(market.group_markets ?? []);
  const isGroupedEvent = groupMarkets.length > 1;
  const liveGroupMarkets = groupMarkets.filter(isLiveGroupMarket);
  const resolvedGroupMarkets = groupMarkets.filter((groupMarket) => !isLiveGroupMarket(groupMarket));
  const visibleGroupMarkets = [
    ...liveGroupMarkets,
    ...(showResolvedGroups ? resolvedGroupMarkets : []),
  ];
  const usesGroupMarketImages = groupMarkets.some((groupMarket) =>
    hasDistinctGroupMarketImage(market, groupMarket),
  );
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
  const primaryOutcome = tradeMarket.outcomes[0];
  const secondaryOutcome = tradeMarket.outcomes[1];
  const yes =
    tradeMarket.outcomes.find((outcome) => outcome.name.toLowerCase() === "yes") ??
    primaryOutcome;
  const no =
    tradeMarket.outcomes.find((outcome) => outcome.name.toLowerCase() === "no") ??
    secondaryOutcome;
  const yesDisplayPrice = getActionDisplayPrice(yes?.price ?? null, action);
  const noDisplayPrice = getActionDisplayPrice(no?.price ?? null, action);
  const selectedMarketPrice = side === "yes" ? yesDisplayPrice : noDisplayPrice;
  const limitOrderPrice = parseLimitPrice(limitPriceCents);
  const selectedPrice = orderType === "limit" ? limitOrderPrice : selectedMarketPrice;
  const amountValue = Number(amount);
  const hasValidAmount = Number.isFinite(amountValue) && amountValue > 0;
  const usesShareInput = action === "sell" || orderType === "limit";
  const estimatedStake =
    action === "buy" && selectedPrice && hasValidAmount
      ? usesShareInput
        ? amountValue * selectedPrice
        : amountValue * (1 - platformFeeRate)
      : 0;
  const estimatedFee =
    action === "buy" && selectedPrice && hasValidAmount
      ? usesShareInput
        ? estimatedStake / (1 - platformFeeRate) - estimatedStake
        : amountValue * platformFeeRate
      : 0;
  const estimatedShares =
    selectedPrice && hasValidAmount
      ? action === "buy"
        ? usesShareInput
          ? amountValue
          : estimatedStake / selectedPrice
        : amountValue
      : 0;
  const estimatedCost = action === "buy" && selectedPrice
    ? usesShareInput
      ? estimatedStake + estimatedFee
      : amountValue
    : 0;
  const estimatedProceeds = action === "sell" && selectedPrice ? estimatedShares * selectedPrice : 0;
  const currentPosition = portfolio.positions.find(
    (position) => position.marketId === tradeMarket.id,
  );
  const selectedSideShares =
    side === "yes" ? currentPosition?.yesShares ?? 0 : currentPosition?.noShares ?? 0;
  const marketTrades = portfolio.trades.filter((trade) => trade.marketId === tradeMarket.id);
  const selectedVariantLabel =
    selectedGroupMarket?.label ?? tradeMarket.groupItemTitle ?? tradeMarket.title;
  const selectedVariantDisplayLabel = formatMarketText(selectedVariantLabel);
  const marketDisplayTitle = formatMarketText(market.title);
  const tradeMarketDisplayTitle = formatMarketText(tradeMarket.title);
  const eyebrowParts = getMarketEyebrowParts(market);
  const selectedOutcomeLabel =
    isGroupedEvent
      ? `${selectedVariantDisplayLabel} ${side === "yes" ? "Yes" : "No"}`
      : side === "yes"
        ? formatMarketText(primaryOutcome?.name) || "Yes"
        : formatMarketText(secondaryOutcome?.name) || "No";
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
  const priceHistory = market.history?.price_history ?? [];
  const timelineDates = [market.starts_at, market.ends_at].filter(Boolean).map(formatShortDate);
  const canTrade = eligibilityStatus === "ready" && isEligibleToTrade(eligibility);
  const canPlaceTrade =
    canTrade &&
    !isPlacingTrade &&
    selectedPrice !== null &&
    selectedPrice > 0 &&
    hasValidAmount &&
    (action === "buy"
      ? estimatedCost <= portfolio.wallet.balance
      : estimatedShares <= selectedSideShares);
  const activityMarketIds =
    groupMarkets.length > 1
      ? [...new Set([...groupMarkets.map((groupMarket) => groupMarket.id), market.id])]
      : [market.id];
  const activityMarketIdsKey = activityMarketIds.join(",");
  const activityMarketLabels: Record<string, string> = Object.fromEntries(
    [
      ...groupMarkets.map((groupMarket) => [groupMarket.id, groupMarket.label] as const),
      [tradeMarket.id, selectedVariantLabel] as const,
    ],
  );

  React.useEffect(() => {
    setMarket(initialMarket);
  }, [initialMarket]);

  React.useEffect(() => {
    setSelectedMarketId(initialSelectedMarketId);
  }, [initialSelectedMarketId]);

  React.useEffect(() => {
    setDetailTab("rules");
    setActivityTab("comments");
    setCommentText("");
    setOrderType("market");
    setLimitPriceCents("0.0");
    setAmount("0");
  }, [market.id]);

  React.useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setMarketActivityStatus("loading");
    loadMarketActivity(market.id, controller.signal, activityMarketIds)
      .then((activity) => {
        if (!cancelled) {
          setMarketActivity(activity);
          setMarketActivityStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (!cancelled) {
          setMarketActivity(emptyMarketActivity);
          setMarketActivityStatus("error");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activityMarketIdsKey, market.id]);

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

  React.useEffect(() => {
    if (!hasValidAmount || !selectedPrice || selectedPrice <= 0) {
      setQuote(null);
      setQuoteStatus("idle");
      setQuoteError(null);
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setQuoteStatus("loading");
      setQuoteError(null);
      createTradingQuoteApi({
        marketId: tradeMarket.id,
        side,
        action,
        amount: action === "buy" ? estimatedCost : undefined,
        shares: action === "sell" ? estimatedShares : undefined,
      })
        .then((nextQuote) => {
          if (!cancelled) {
            setQuote(nextQuote);
            setQuoteStatus("ready");
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setQuote(null);
            setQuoteStatus("error");
            setQuoteError(error instanceof Error ? error.message : "Quote unavailable");
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    action,
    estimatedCost,
    estimatedShares,
    hasValidAmount,
    selectedPrice,
    side,
    tradeMarket.id,
  ]);

  async function placeTrade() {
    if (!canTrade) {
      setTradeMessage({
        tone: "info",
        text: "Complete verification",
      });
      return;
    }

    if (!selectedPrice || selectedPrice <= 0) {
      setTradeMessage({
        tone: "error",
        text: orderType === "limit"
          ? "Enter a valid limit price."
          : "Price is not available for this side yet.",
      });
      return;
    }

    if (!hasValidAmount) {
      setTradeMessage({
        tone: "error",
        text: usesShareInput ? "Enter a valid share quantity." : "Enter a valid USDT amount.",
      });
      return;
    }

    if (action === "buy" && estimatedCost > portfolio.wallet.balance) {
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
        amount: action === "buy" ? estimatedCost : undefined,
        shares: action === "sell" ? estimatedShares : undefined,
      });
      setPortfolio(result.portfolio);
      if (result.market) {
        setMarket(result.market);
      }
      setQuote(null);
      setTradeMessage({
        tone: "success",
        text:
          action === "buy"
            ? `Bought ${formatShares(result.trade.shares)} ${selectedOutcomeLabel} shares for ${formatUsdt(result.trade.amount)}.`
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
    setAmount(formatInputNumber(Math.min(portfolio.wallet.balance, nextAmount)));
  }

  function addShareStep(value: number) {
    const currentAmount = Number(amount);
    const nextAmount = Number.isFinite(currentAmount) ? currentAmount + value : value;
    const maxShares =
      action === "sell"
        ? selectedSideShares
        : selectedPrice && selectedPrice > 0
          ? portfolio.wallet.balance / selectedPrice
          : Number.POSITIVE_INFINITY;
    setAmount(formatInputNumber(Math.min(maxShares, Math.max(0, nextAmount))));
  }

  function setSellSharePercent(percent: number) {
    setAmount(formatInputNumber(selectedSideShares * percent));
  }

  function setMaxAmount() {
    if (action === "sell") {
      setAmount(formatInputNumber(selectedSideShares));
      return;
    }

    if (orderType === "limit") {
      const maxShares =
        selectedPrice && selectedPrice > 0 ? portfolio.wallet.balance / selectedPrice : 0;
      setAmount(formatInputNumber(maxShares));
      return;
    }

    setAmount(formatInputNumber(portfolio.wallet.balance));
  }

  function adjustLimitPrice(delta: number) {
    const currentPrice = Number(limitPriceCents);
    const nextPrice = Math.min(99, Math.max(0, (Number.isFinite(currentPrice) ? currentPrice : 0) + delta));
    setLimitPriceCents(nextPrice.toFixed(1));
  }

  function changeAction(nextAction: "buy" | "sell") {
    setAction(nextAction);
    setAmount("0");
    setTradeMessage(null);
  }

  function toggleOrderType() {
    setOrderType((current) => (current === "market" ? "limit" : "market"));
    setLimitPriceCents("0.0");
    setAmount("0");
    setTradeMessage(null);
  }

  async function copyMarketLink() {
    await copyTextToClipboard(window.location.href);
    setTradeMessage({ tone: "success", text: "Market link copied." });
  }

  async function copyEmbedCode() {
    const url = window.location.href;
    const title = marketDisplayTitle.replace(/"/g, "&quot;");
    await copyTextToClipboard(
      `<iframe title="${title}" src="${url}" width="100%" height="720"></iframe>`,
    );
    setTradeMessage({ tone: "success", text: "Embed code copied." });
  }

  function toggleSavedMarket() {
    setIsSaved((current) => {
      const next = !current;
      setTradeMessage({
        tone: "success",
        text: next ? "Market saved." : "Market removed from saved.",
      });
      return next;
    });
  }

  async function postComment() {
    const text = commentText.trim();

    if (!text || isPostingComment) {
      return;
    }

    setIsPostingComment(true);

    try {
      const nextActivity = await postMarketComment({
        marketId: tradeMarket.id,
        body: text,
        positionLabel: selectedOutcomeLabel,
      });
      setMarketActivity(nextActivity);
      setMarketActivityStatus("ready");
      setCommentText("");
      setActivityTab("comments");
    } catch (error) {
      setTradeMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not post comment.",
      });
    } finally {
      setIsPostingComment(false);
    }
  }

  function goToVerification() {
    window.location.href = "/kyc";
  }

	  function renderTradeTicket() {
	    const ticketPrimaryLabel = isGroupedEvent
	      ? selectedVariantDisplayLabel
	      : formatEnglishDate(market.dates?.ends_at ?? market.ends_at) ?? selectedOutcomeLabel;
	    const actionLabel = action === "buy" ? "Buy" : "Sell";
	    const sideLabel = side === "yes" ? "Yes" : "No";
	    const tradeButtonLabel = isPlacingTrade
	      ? "Placing..."
	      : orderType === "limit"
	        ? `Place ${actionLabel.toLowerCase()} order`
	        : `${actionLabel} ${sideLabel}`;

    return (
      <>
        <div className="market-trade-ticket flex h-full w-full flex-col overflow-hidden rounded-[22px] border border-[#e6e8ea] bg-white shadow-none">
          <div className="flex w-full flex-col">
            <div className="flex w-full items-center gap-3 px-4 pb-4 pt-5">
              <MarketImage market={tradeMarket} className="h-12 w-12 min-w-12 rounded-[7px]" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-[#77808d]">{tradeMarketDisplayTitle}</span>
                <span className="flex min-w-0 items-center text-base font-semibold text-[#0e0f11]">
                  <span className="min-w-0 truncate">{ticketPrimaryLabel}</span>
                  <span className="mx-1.5 shrink-0 text-[#a6adb7]">·</span>
                  <span className={side === "yes" ? "shrink-0 text-[#30a159]" : "shrink-0 text-[#e23939]"}>
	                    {side === "yes" ? "Yes" : "No"}
                  </span>
                </span>
              </div>
            </div>

            <div className="flex w-full items-end justify-between border-b border-[#e6e8ea] px-4 pb-0">
              <div className="flex gap-4 text-[18px] font-semibold leading-none">
                <button
                  className={`relative bg-transparent pb-4 ${
                    action === "buy" ? "text-[#0e0f11]" : "text-[#77808d] hover:text-[#4b5563]"
                  }`}
                  onClick={() => changeAction("buy")}
                  type="button"
                >
                  Buy
                  {action === "buy" ? (
                    <span className="absolute bottom-0 left-0 h-[3px] w-full bg-[#0e0f11]" />
                  ) : null}
                </button>
                <button
                  className={`relative bg-transparent pb-4 ${
                    action === "sell" ? "text-[#0e0f11]" : "text-[#77808d] hover:text-[#4b5563]"
                  }`}
                  onClick={() => changeAction("sell")}
                  type="button"
                >
                  Sell
                  {action === "sell" ? (
                    <span className="absolute bottom-0 left-0 h-[3px] w-full bg-[#0e0f11]" />
                  ) : null}
                </button>
              </div>
              <button
                className="flex w-[90px] items-center justify-end gap-1 pb-4 text-[17px] font-semibold capitalize text-[#0e0f11] transition hover:text-[#4b5563]"
                onClick={toggleOrderType}
                type="button"
              >
	                {orderType === "market" ? "Market" : "Limit"}
                <ChevronDown
                  className={`ml-1 transition-transform ${orderType === "limit" ? "rotate-180" : ""}`}
                  size={18}
                />
              </button>
            </div>
          </div>

          <div className="flex w-full flex-col gap-5 px-4 py-5">
            <div className="grid w-full grid-cols-2 gap-3">
              <button
                className={`h-16 min-w-0 rounded-[14px] px-3 text-[20px] font-semibold transition ${
                  side === "yes"
                    ? "bg-[#30a159] text-white shadow-[0_4px_0_rgba(24,126,63,0.95)]"
                    : "bg-[#f4f5f6] text-[#77808d] shadow-[0_4px_0_rgba(0,0,0,0.18)] hover:text-[#0e0f11]"
                }`}
                onClick={() => setSide("yes")}
                type="button"
              >
	                <span className="block truncate">Yes {formatCents(yesDisplayPrice)}</span>
              </button>
              <button
                className={`h-16 min-w-0 rounded-[14px] px-3 text-[20px] font-semibold transition ${
                  side === "no"
                    ? "bg-[#e23939] text-white shadow-[0_4px_0_rgba(168,30,30,0.95)]"
                    : "bg-[#f4f5f6] text-[#77808d] shadow-[0_4px_0_rgba(0,0,0,0.18)] hover:text-[#0e0f11]"
                }`}
                onClick={() => setSide("no")}
                type="button"
              >
	                <span className="block truncate">No {formatCents(noDisplayPrice)}</span>
              </button>
            </div>

            {orderType === "limit" ? (
              <>
                <div className="flex w-full items-center">
                  <span className="flex-1 text-base font-medium text-[#0e0f11]">
	                    Limit price
                  </span>
                  <div className="flex h-10 items-center overflow-hidden rounded-md border border-[#e6e8ea] bg-white text-center text-lg font-semibold text-[#0e0f11]">
                    <button
                      className="grid h-full aspect-square place-items-center text-[#77808d] transition hover:bg-[#f4f5f6] hover:text-[#0e0f11]"
                      onClick={() => adjustLimitPrice(-1)}
                      type="button"
                    >
                      -
                    </button>
                    <div className="flex min-w-[66px] items-center justify-center gap-0.5">
                      <input
                        className="w-9 bg-transparent text-center tabular-nums tracking-normal outline-none"
                        inputMode="decimal"
                        onChange={(event) => setLimitPriceCents(event.target.value)}
                        placeholder="0"
                        type="text"
                        value={limitPriceCents.replace(/\.0$/, "")}
                      />
                      <span>¢</span>
                    </div>
                    <button
                      className="grid h-full aspect-square place-items-center text-[#77808d] transition hover:bg-[#f4f5f6] hover:text-[#0e0f11]"
                      onClick={() => adjustLimitPrice(1)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="-mx-4 h-px bg-[#e6e8ea]" />

                <div className="flex w-full flex-col gap-2">
                  <div className="flex w-full items-center">
	                    <span className="flex-1 text-base font-medium text-[#0e0f11]">Shares</span>
                    <input
                      className="h-10 min-w-[118px] rounded-md border border-[#e6e8ea] bg-transparent px-3 text-right text-lg font-semibold text-[#0e0f11] outline-none"
                      inputMode="decimal"
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0"
                      type="text"
                      value={amount === "0" ? "" : amount}
                    />
                  </div>
                  <div className="flex w-full justify-end">
                    <div className="flex gap-1">
                      {(action === "sell" ? [0.25, 0.5, 0.75] : [-100, -10, 10, 20, 100]).map((value) => (
                        <button
                          className="h-8 rounded-md border border-[#e6e8ea] bg-white px-2.5 text-xs font-semibold text-[#77808d] transition hover:bg-[#f4f5f6] hover:text-[#0e0f11]"
                          key={value}
                          onClick={() => {
                            if (action === "sell") {
                              setSellSharePercent(value);
                            } else {
                              addShareStep(value);
                            }
                          }}
                          type="button"
                        >
                          {action === "sell"
                            ? `${Math.round(value * 100)}%`
                            : value > 0
                              ? `+${value}`
                              : value}
                        </button>
                      ))}
                      <button
                        className="h-8 rounded-md border border-[#e6e8ea] bg-white px-2.5 text-xs font-semibold text-[#77808d] transition hover:bg-[#f4f5f6] hover:text-[#0e0f11]"
                        onClick={setMaxAmount}
                        type="button"
                      >
                        Max
                      </button>
                    </div>
                  </div>
                  <div className="h-6" />
                </div>

                <div className="-mx-4 h-px bg-[#e6e8ea]" />

                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-[#77808d]">
	                      Expires
                    </span>
                    <button
                      className="flex items-center gap-1 text-sm font-medium text-[#77808d]"
                      type="button"
                    >
	                      Never
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  {action === "buy" ? (
                    <>
                      <TradeInfoRow label="Total" value={formatUsd(estimatedCost)} tone="blue" />
                      <TradeInfoRow label="Into market" value={formatUsd(estimatedStake)} />
                      <TradeInfoRow label="Platform fee" value={formatUsd(estimatedFee)} />
                      <TradeInfoRow
                        label="To win"
                        value={formatUsd(Math.max(0, estimatedShares - estimatedCost))}
                        tone="green"
                        withInfo
                      />
                    </>
                  ) : (
                    <TradeInfoRow
                      label="You'll receive"
                      value={formatUsd(estimatedProceeds)}
                      tone="green"
                      withInfo
                    />
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="mt-2 flex min-h-[132px] items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span className="block text-[22px] font-medium text-[#0e0f11]">
	                      {action === "buy" ? "Amount" : "Shares"}
                    </span>
                    {action === "buy" ? (
                      <span className="mt-1 block text-sm font-semibold text-[#77808d]">
                        {formatUsd(portfolio.wallet.balance)} available
                      </span>
                    ) : null}
                  </div>
                  <input
                    className="min-w-0 flex-1 bg-transparent text-right text-[72px] font-semibold leading-none text-[#697d91] outline-none"
                    inputMode="decimal"
                    onChange={(event) => setAmount(event.target.value.replace(/^\$/, ""))}
                    placeholder={usesShareInput ? "0" : "$0"}
                    type="text"
                    value={amount === "0" ? "" : usesShareInput ? amount : `$${amount}`}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  {action === "sell" ? (
                    [0.25, 0.5, 0.75].map((value) => (
                      <button
                        className="h-10 rounded-[12px] border border-transparent bg-[#f4f5f6] px-4 text-base font-semibold text-[#77808d] transition hover:bg-[#eef1f4] hover:text-[#0e0f11]"
                        key={value}
                        onClick={() => setSellSharePercent(value)}
                        type="button"
                      >
                        {Math.round(value * 100)}%
                      </button>
                    ))
                  ) : (
                    [1, 5, 10, 100].map((value) => (
                      <button
                        className="h-10 rounded-[12px] border border-transparent bg-[#f4f5f6] px-4 text-base font-semibold text-[#77808d] transition hover:bg-[#eef1f4] hover:text-[#0e0f11]"
                        key={value}
                        onClick={() => addQuickAmount(value)}
                        type="button"
                      >
                        +${value}
                      </button>
                    ))
                  )}
                  <button
                    className="h-10 rounded-[12px] border border-transparent bg-[#f4f5f6] px-4 text-base font-semibold text-[#77808d] transition hover:bg-[#eef1f4] hover:text-[#0e0f11]"
                    onClick={setMaxAmount}
                    type="button"
                  >
                    Max
                  </button>
                </div>
              </>
            )}

            <button
              className="mt-1 flex h-16 w-full items-center justify-center gap-2 rounded-[14px] bg-[#0093fd] px-5 text-[18px] font-semibold text-white shadow-[0_7px_0_#0879c8] transition hover:bg-[#1a9cff] active:translate-y-[2px] active:shadow-[0_4px_0_#0879c8] disabled:cursor-wait disabled:opacity-90"
              disabled={isPlacingTrade}
              onClick={() => {
                if (canTrade) {
                  void placeTrade();
                } else {
                  goToVerification();
                }
              }}
              type="button"
            >
              {tradeButtonLabel}
            </button>

            {tradeMessage ? (
              <div
                className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${
                  tradeMessage.tone === "success"
                    ? "bg-[#3db468]/10 text-[#a6d2b6]"
                    : tradeMessage.tone === "error"
                      ? "bg-[#cb3131]/10 text-[#daa]"
                      : "bg-[#f4f5f6] text-[#0e0f11]"
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
        </div>

        <p className="mt-5 px-3 text-center text-sm font-medium leading-5 text-[#77808d]">
	          By trading, you agree to the{" "}
	          <a className="underline hover:text-[#0e0f11]" href="#terms">
	            Terms of Use
	          </a>
          .
        </p>
      </>
    );
  }

  if (isGroupedEvent) {
    const marketEndDate = selectedGroupMarket?.ends_at ?? market.ends_at;

    return (
      <section className={detailPageShell}>
        <div className={detailGrid}>
          <article className="min-w-0 overflow-hidden">
            {detailStatus === "error" ? (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#e23939]/25 bg-[#e23939]/10 p-4 text-sm font-semibold text-[#991b1b]">
                <AlertCircle className="mt-0.5 shrink-0" size={18} />
                <span>The market detail request failed. Showing the latest available market data.</span>
              </div>
            ) : null}

            <div className={eventHeader}>
              <div className={eventHeaderRow}>
                <div className={eventHeaderMain}>
                  <MarketImage market={market} className={eventHeaderImage} />
                  <div className="min-w-0 flex-1">
                    <div className={eventEyebrow}>
                      {eyebrowParts.map((part, index) => (
                        <React.Fragment key={`${part}-${index}`}>
                          {index > 0 ? <span>·</span> : null}
                          <span>{part}</span>
                        </React.Fragment>
                      ))}
                    </div>
                    <h1 className={eventTitle}>
                      {marketDisplayTitle}
                    </h1>
                  </div>
                </div>

                <div className="hidden shrink-0 items-center gap-1 sm:flex">
                  <button
                    className={iconButton}
                    aria-label="Embed market"
                    onClick={() => void copyEmbedCode()}
                    type="button"
                  >
                    <Code2 size={18} />
                  </button>
                  <button
                    className={iconButton}
                    aria-label="Copy market link"
                    onClick={() => void copyMarketLink()}
                    type="button"
                  >
                    <Link2 size={18} />
                  </button>
                  <button
                    className={`${iconButton} ${
                      isSaved ? "text-[#1f55f5]" : ""
                    }`}
                    aria-label={isSaved ? "Unsave market" : "Save market"}
                    onClick={toggleSavedMarket}
                    type="button"
                  >
                    <Bookmark fill={isSaved ? "currentColor" : "none"} size={18} />
                  </button>
                </div>
              </div>
            </div>

            <MarketChart
              endsAt={marketEndDate}
              outcomes={displayOutcomes}
              history={market.history}
              selectedOutcomeName={selectedVariantLabel}
            />

            <div className="market-detail-outcome-list clear-both">
              {visibleGroupMarkets.map((groupMarket) => {
                const isSelected = groupMarket.id === tradeMarket.id;
                const change = getGroupMarketPriceChange(market, groupMarket);

                return (
                  <div
                    className="market-detail-outcome-row group relative grid min-w-0 gap-3 py-3 transition md:min-h-[72px] md:grid-cols-[minmax(0,1fr)_132px_280px] md:items-center"
                    key={groupMarket.id}
                  >
                    <button
                      className="flex min-w-0 items-center gap-3 text-left"
                      onClick={() => setSelectedMarketId(groupMarket.id)}
                      type="button"
                    >
                      {usesGroupMarketImages ? (
                        <MarketImage market={groupMarket} className="size-12 rounded-full" />
                      ) : null}
                      <span className="min-w-0">
                        <span className="block max-w-full truncate text-[16px] font-semibold leading-5 text-[var(--pm-text-primary)]">
                          {formatMarketText(groupMarket.label)}
                        </span>
                        <span className="mt-1.5 flex items-center gap-2 text-[14px] font-medium leading-none text-[#77808d]">
	                          {formatMoney(groupMarket.volume)} Volume
                        </span>
                      </span>
                    </button>

                    <div className="flex items-baseline gap-2 md:justify-center">
                      <strong className="text-[28px] font-semibold leading-none text-[#0e0f11]">
                        {formatPercent(groupMarket.yes_price)}
                      </strong>
                      {change !== null && change !== 0 ? (
                        <span
                          className={`text-xs font-semibold ${
                            change > 0 ? "text-[#30a159]" : "text-[#e23939]"
                          }`}
                        >
                          {change > 0 ? "▲" : "▼"} {formatPercent(Math.abs(change))}
                        </span>
                      ) : null}
                    </div>

                    <div className="grid min-w-0 grid-cols-2 gap-2 md:flex md:justify-end">
                      <button
                        className={`h-12 min-w-0 rounded-[7.2px] px-4 text-sm font-semibold transition md:w-[136px] ${
                          isSelected && side === "yes"
                            ? "bg-[#30a159] text-white shadow-[0_4px_0_rgba(24,126,63,0.95)]"
                            : "bg-[#30a159]/12 text-[#30a159] hover:bg-[#30a159] hover:text-white"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                        disabled={groupMarket.yes_price === null}
                        onClick={() => {
                          setSelectedMarketId(groupMarket.id);
                          setSide("yes");
                        }}
                      >
                        <span className="block truncate">
	                          {getTradeActionLabel(action)} Yes{" "}
                          {formatCents(getActionDisplayPrice(groupMarket.yes_price, action))}
                        </span>
                      </button>
                      <button
                        className={`h-12 min-w-0 rounded-[7.2px] px-4 text-sm font-semibold transition md:w-[136px] ${
                          isSelected && side === "no"
                            ? "bg-[#e23939] text-white shadow-[0_4px_0_rgba(168,30,30,0.95)]"
                            : "bg-[#e23939]/10 text-[#e23939] hover:bg-[#e23939] hover:text-white"
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                        disabled={groupMarket.no_price === null}
                        onClick={() => {
                          setSelectedMarketId(groupMarket.id);
                          setSide("no");
                        }}
                      >
                        <span className="block truncate">
	                          {getTradeActionLabel(action)} No{" "}
                          {formatCents(getActionDisplayPrice(groupMarket.no_price, action))}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {resolvedGroupMarkets.length > 0 ? (
              <button
                className="mb-5 mt-2 flex h-8 items-center gap-2 p-0 text-sm font-semibold text-[#77808d] transition hover:text-[#0e0f11]"
                onClick={() => setShowResolvedGroups((current) => !current)}
              >
                {showResolvedGroups ? "Hide resolved" : "View resolved"}
                <ChevronDown
                  className={`transition-transform ${showResolvedGroups ? "rotate-180" : ""}`}
                  size={17}
                />
              </button>
            ) : null}

            <MarketInfoTabs
              activeTab={detailTab}
              market={market}
              onTabChange={setDetailTab}
            />

            <MarketActivityTabs
              activeTab={activityTab}
              activityMarketLabels={activityMarketLabels}
              commentText={commentText}
              currentPosition={currentPosition}
              data={marketActivity}
              isLoading={marketActivityStatus === "loading"}
              isPostingComment={isPostingComment}
              market={tradeMarket}
              onCommentTextChange={setCommentText}
              onPostComment={postComment}
              onTabChange={setActivityTab}
            />

            <MarketFaqSection market={market} groupMarkets={groupMarkets} />
          </article>

          <aside className="h-fit min-w-0 overflow-visible xl:sticky xl:top-[132px] xl:w-[340px] xl:self-start">
            {renderTradeTicket()}
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className={detailPageShell}>
      <button
        className="mb-5 flex w-fit items-center gap-2 rounded-md border border-[#e6e8ea] px-3 py-2 text-sm font-semibold text-[#77808d] transition hover:bg-[#f4f5f6] hover:text-[#0e0f11]"
        onClick={onBack}
      >
        <ArrowLeft size={18} />
        All markets
      </button>

      <div className={detailGrid}>
        <article className="min-w-0 overflow-hidden">
          {detailStatus === "error" ? (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#e23939]/25 bg-[#e23939]/10 p-4 text-sm font-semibold text-[#991b1b]">
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
              <span>The market detail request failed. Showing the latest available market data.</span>
            </div>
          ) : null}

          <div className={eventHeader}>
            <div className={eventHeaderRow}>
              <div className={eventHeaderMain}>
                <MarketImage market={market} className={eventHeaderImage} />
                <div className="min-w-0 flex-1">
                  <div className={eventEyebrow}>
                    {eyebrowParts.map((part, index) => (
                      <React.Fragment key={`${part}-${index}`}>
                        {index > 0 ? <span>·</span> : null}
                        <span>{part}</span>
                      </React.Fragment>
                    ))}
                  </div>
                  <h1 className={`${eventTitle} max-w-4xl`}>
                    {marketDisplayTitle}
                  </h1>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  className={iconButton}
                  aria-label="Embed market"
                  onClick={() => void copyEmbedCode()}
                  type="button"
                >
                  <Code2 size={20} />
                </button>
                <button
                  className={iconButton}
                  aria-label="Copy market link"
                  onClick={() => void copyMarketLink()}
                  type="button"
                >
                  <Link2 size={20} />
                </button>
                <button
                  className={`${iconButton} ${isSaved ? "border-[#0093fd]/50 text-[#0093fd]" : ""}`}
                  aria-label={isSaved ? "Unsave market" : "Save market"}
                  onClick={toggleSavedMarket}
                  type="button"
                >
                  <Bookmark fill={isSaved ? "currentColor" : "none"} size={20} />
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 border-y border-[#e6e8ea] py-4 sm:grid-cols-2 lg:grid-cols-4">
	            <DetailStat label="Volume" value={formatMoney(market.volume_detail?.volume ?? market.volume)} />
            <DetailStat label="Pool" value={formatMoney(market.volume_detail?.liquidity ?? market.liquidity)} />
            <DetailStat label="Starts" value={formatDate(market.dates?.starts_at ?? market.starts_at)} />
            <DetailStat label="Closes" value={formatDate(market.dates?.ends_at ?? market.ends_at)} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            {timelineDates.length > 0 ? timelineDates.map((date, index) => (
              <button
                className={`${tabButton} ${
                  index === 0
                    ? "bg-[#0e0f11] text-white"
                    : "bg-[#f4f5f6] text-[#77808d] hover:text-[#0e0f11]"
                }`}
                key={date}
              >
                {date}
              </button>
            )) : (
              <span className={`${tabButton} bg-[#f4f5f6] text-[#77808d]`}>Dates TBD</span>
            )}
            <span className={`${tabButton} bg-[#f4f5f6] text-[#77808d]`}>
              {priceHistory.length} price points
              <ChevronRight className="ml-1 inline" size={15} />
            </span>
          </div>

          <MarketChart
            endsAt={market.dates?.ends_at ?? market.ends_at}
            outcomes={displayOutcomes}
            history={market.history}
          />

          <div className="market-detail-outcome-list mt-4 grid gap-0">
            {isGroupedEvent ? groupMarkets.map((groupMarket) => {
              return (
                <div
                  className="market-detail-outcome-row grid min-w-0 gap-3 py-4 transition md:grid-cols-[minmax(0,1fr)_110px_220px] md:items-center"
                  key={groupMarket.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {usesGroupMarketImages ? (
                      <MarketImage market={groupMarket} className="h-12 w-12 rounded-full" />
                    ) : null}
                    <div className="min-w-0">
                      <strong className="block truncate text-base font-semibold text-[#0e0f11]">
                        {formatMarketText(groupMarket.label)}
                      </strong>
                      <span className="text-sm font-semibold text-[#77808d]">
	                        {formatMoney(groupMarket.volume)} Volume
                      </span>
                    </div>
                  </div>
                  <div>
                    <strong className="block text-3xl font-semibold text-[#0e0f11]">
                      {formatPercent(groupMarket.yes_price)}
                    </strong>
                    <span className="text-sm font-semibold text-[#77808d]">
                      Yes price
                    </span>
                  </div>
                  <div className="grid min-w-0 grid-cols-2 gap-2">
                    <button
                      className="min-w-0 rounded-[7.2px] bg-[#30a159]/12 px-3 py-3 text-sm font-semibold text-[#30a159] transition hover:bg-[#30a159] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={groupMarket.yes_price === null}
                      onClick={() => {
                        setSelectedMarketId(groupMarket.id);
                        setSide("yes");
                      }}
                    >
                      <span className="block truncate">
	                        {getTradeActionLabel(action)} Yes{" "}
                        {formatCents(getActionDisplayPrice(groupMarket.yes_price, action))}
                      </span>
                    </button>
                    <button
                      className="min-w-0 rounded-[7.2px] bg-[#e23939]/10 px-3 py-3 text-sm font-semibold text-[#e23939] transition hover:bg-[#e23939] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={groupMarket.no_price === null}
                      onClick={() => {
                        setSelectedMarketId(groupMarket.id);
                        setSide("no");
                      }}
                    >
                      <span className="block truncate">
	                        {getTradeActionLabel(action)} No{" "}
                        {formatCents(getActionDisplayPrice(groupMarket.no_price, action))}
                      </span>
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
                ? `${getTradeActionLabel(action)} ${getOutcomeActionLabel(outcome.name, true)}`
                : `View ${getOutcomeActionLabel(outcome.name, false)}`;
              const displayPrice = getActionDisplayPrice(price, action);

              return (
                <div
                  className="grid min-w-0 gap-3 py-4 md:grid-cols-[minmax(0,1fr)_110px_170px] md:items-center"
                  key={`${outcome.name}-${index}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <OutcomeAvatar market={market} outcome={outcome} index={index} />
                    <div className="min-w-0">
                      <strong className="block truncate text-base font-semibold text-[#0e0f11]">
                        {formatMarketText(outcome.name)}
                      </strong>
                      <span className="text-sm font-semibold text-[#77808d]">
	                        {formatMoney(getOutcomeVolume(market, outcome.name))} Volume
                      </span>
                    </div>
                  </div>
                  <div>
                    <strong className="block text-3xl font-semibold text-[#0e0f11]">
                      {formatPercent(price)}
                    </strong>
                    <span className="text-sm font-semibold text-[#77808d]">
                      Current market price
                    </span>
                  </div>
                  <button
                    className={`min-w-0 rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      tradeSide === "no"
                        ? "bg-[#e23939]/10 text-[#e23939] hover:bg-[#e23939] hover:text-white"
                        : "bg-[#30a159]/12 text-[#30a159] hover:bg-[#30a159] hover:text-white"
                    }`}
                    disabled={!isTradableOutcome || price === null}
                    onClick={() => {
                      setSide(tradeSide);
                    }}
                  >
                    <span className="block truncate">
                      {actionLabel} {formatCents(displayPrice)}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <MarketInfoTabs
            activeTab={detailTab}
            market={market}
            onTabChange={setDetailTab}
            framed
          />

          <MarketActivityTabs
            activeTab={activityTab}
            activityMarketLabels={activityMarketLabels}
            commentText={commentText}
            currentPosition={currentPosition}
            data={marketActivity}
            isLoading={marketActivityStatus === "loading"}
            isPostingComment={isPostingComment}
            market={tradeMarket}
            onCommentTextChange={setCommentText}
            onPostComment={postComment}
            onTabChange={setActivityTab}
            framed
          />

          <MarketFaqSection market={market} groupMarkets={[]} />
        </article>

        <aside className="h-fit min-w-0 overflow-visible xl:sticky xl:top-[132px] xl:w-[340px] xl:self-start">
          {renderTradeTicket()}
        </aside>

        <aside className="hidden">
          <div className="flex items-center gap-3">
            <MarketImage market={tradeMarket} className="h-14 w-14" />
            <div className="min-w-0">
              <strong className="block truncate text-lg font-semibold text-[#dee3e7]">
                {selectedOutcomeLabel}
              </strong>
              <span className="text-sm font-semibold text-[#7b8996]">
                Balance {formatUsdt(portfolio.wallet.balance)}
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-b border-[#242b32] pb-3">
            <div className="flex gap-4 text-lg font-semibold">
              <button
                className={action === "buy" ? "text-[#dee3e7]" : "text-[#7b8996]"}
                onClick={() => changeAction("buy")}
              >
                Buy
              </button>
              <button
                className={action === "sell" ? "text-[#dee3e7]" : "text-[#7b8996]"}
                onClick={() => changeAction("sell")}
              >
                Sell
              </button>
            </div>
            <button
              className="flex items-center gap-1 text-sm font-semibold text-[#dee3e7] transition hover:text-white"
              onClick={toggleOrderType}
              type="button"
            >
              {orderType === "market" ? "Market" : "Limit"}
              <ChevronDown
                className={`transition-transform ${orderType === "limit" ? "rotate-180" : ""}`}
                size={15}
              />
            </button>
          </div>

          <div className="mt-5 grid min-w-0 grid-cols-2 gap-3">
            <button
              className={`min-w-0 rounded-2xl px-3 py-4 text-base font-semibold transition sm:px-4 sm:text-lg ${
                side === "yes"
                  ? "bg-[#3db468]/80 text-white"
                  : "bg-[#2e3841] text-[#7b8996] hover:text-[#dee3e7]"
              }`}
              onClick={() => setSide("yes")}
            >
              <span className="block truncate">
                {isGroupedEvent ? "Yes" : primaryOutcome?.name ?? "Yes"} {formatCents(yesDisplayPrice)}
              </span>
            </button>
            <button
              className={`min-w-0 rounded-2xl px-3 py-4 text-base font-semibold transition sm:px-4 sm:text-lg ${
                side === "no"
                  ? "bg-[#cb3131]/80 text-white"
                  : "bg-[#2e3841] text-[#7b8996] hover:text-[#dee3e7]"
              }`}
              onClick={() => setSide("no")}
            >
              <span className="block truncate">
                {isGroupedEvent ? "No" : secondaryOutcome?.name ?? "No"} {formatCents(noDisplayPrice)}
              </span>
            </button>
          </div>

          {orderType === "limit" ? (
            <label className="mt-7 block">
              <span className="text-base font-semibold text-[#dee3e7]">Limit price</span>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[#242b32] bg-[#15191d] px-3 py-2">
                <button
                  className="grid h-10 w-10 place-items-center rounded-xl bg-[#2e3841] text-lg font-semibold text-[#7b8996] transition hover:text-[#dee3e7]"
                  onClick={() => adjustLimitPrice(-1)}
                  type="button"
                >
                  -
                </button>
                <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
                  <input
                    className="min-w-0 flex-1 bg-transparent text-right text-xl font-semibold text-[#dee3e7] outline-none"
                    inputMode="decimal"
                    onChange={(event) => setLimitPriceCents(event.target.value)}
                    type="text"
                    value={limitPriceCents}
                  />
                  <span className="text-xl font-semibold text-[#7b8996]">¢</span>
                </div>
                <button
                  className="grid h-10 w-10 place-items-center rounded-xl bg-[#2e3841] text-lg font-semibold text-[#7b8996] transition hover:text-[#dee3e7]"
                  onClick={() => adjustLimitPrice(1)}
                  type="button"
                >
                  +
                </button>
              </div>
            </label>
          ) : null}

          <label className={orderType === "limit" ? "mt-6 block" : "mt-7 block"}>
            <span className="text-base font-semibold text-[#dee3e7]">
              {usesShareInput ? "Shares" : "Amount"}
            </span>
            <div className="mt-2 flex items-center gap-2 border-b border-[#242b32] pb-2">
              {!usesShareInput ? (
                <span className="text-4xl font-semibold text-[#7b8996] sm:text-5xl">$</span>
              ) : null}
              <input
                className="min-w-0 flex-1 bg-transparent text-right text-4xl font-semibold text-[#dee3e7] outline-none sm:text-5xl"
                inputMode="decimal"
                type="text"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            {action === "sell" ? (
              [0.25, 0.5, 0.75].map((value) => (
                <button
                  className="rounded-2xl bg-[#2e3841] px-3 py-2 text-sm font-semibold text-[#7b8996] transition hover:text-[#dee3e7]"
                  key={value}
                  onClick={() => setSellSharePercent(value)}
                  type="button"
                >
                  {Math.round(value * 100)}%
                </button>
              ))
            ) : orderType === "limit" ? (
              [-100, -10, 10, 100].map((value) => (
                <button
                  className="rounded-2xl bg-[#2e3841] px-3 py-2 text-sm font-semibold text-[#7b8996] transition hover:text-[#dee3e7]"
                  key={value}
                  onClick={() => addShareStep(value)}
                  type="button"
                >
                  {value > 0 ? `+${value}` : value}
                </button>
              ))
            ) : (
              [1, 5, 10, 100].map((value) => (
                <button
                  className="rounded-2xl bg-[#2e3841] px-3 py-2 text-sm font-semibold text-[#7b8996] transition hover:text-[#dee3e7]"
                  onClick={() => addQuickAmount(value)}
                  key={value}
                  type="button"
                >
                  +${value}
                </button>
              ))
            )}
            <button
              className="rounded-2xl bg-[#2e3841] px-3 py-2 text-sm font-semibold text-[#7b8996] transition hover:text-[#dee3e7]"
              onClick={setMaxAmount}
              type="button"
            >
              Max
            </button>
          </div>

          {orderType === "limit" ? (
            <div className="mt-6 grid gap-3 border-t border-[#242b32] pt-5">
              <SummaryRow label="Expires" value="Never" />
              {action === "buy" ? (
                <>
                  <SummaryRow label="Total" value={formatUsd(estimatedCost)} />
                  <SummaryRow label="To win" value={formatUsd(Math.max(0, estimatedShares - estimatedCost))} accent />
                </>
              ) : (
                <>
                  <SummaryRow label="You'll receive" value={formatUsd(estimatedProceeds)} accent />
                  <SummaryRow label="Available shares" value={formatShares(selectedSideShares)} />
                </>
              )}
            </div>
          ) : action === "buy" ? (
            <div className="mt-5 flex items-center justify-between rounded-2xl bg-[#15191d] px-4 py-3">
              <span className="text-sm font-semibold text-[#7b8996]">Estimated shares</span>
              <strong className="text-sm font-semibold text-[#dee3e7]">
                {formatShares(estimatedShares)}
              </strong>
            </div>
          ) : (
            <div className="mt-5 grid gap-3 border-t border-[#242b32] pt-5">
              <SummaryRow label="Estimated proceeds" value={formatUsd(estimatedProceeds)} accent />
              <SummaryRow label="Available shares" value={formatShares(selectedSideShares)} />
            </div>
          )}

          <button
            className="mt-4 w-full rounded-2xl bg-[#0093fd] px-5 py-4 text-base font-semibold text-white shadow-[0_4px_0_rgba(0,0,0,0.28)] transition hover:bg-[#26a3fd] disabled:opacity-50"
            disabled={canTrade && !canPlaceTrade}
            onClick={() => {
              if (canTrade) {
                void placeTrade();
              } else {
                goToVerification();
              }
            }}
          >
            {!canTrade
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
                  ? "bg-[#3db468]/10 text-[#a6d2b6]"
                  : tradeMessage.tone === "error"
                    ? "bg-[#cb3131]/10 text-[#daa]"
                    : "bg-[#15191d] text-[#dee3e7]"
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

          <div className="mt-6 rounded-2xl border border-[#242b32] bg-[#15191d] p-4">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-base font-semibold text-[#dee3e7]">Your position</h3>
              <button className="text-sm font-semibold text-[#0093fd]" onClick={resetPortfolio}>
                Reset
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <TicketStat label="Yes shares" value={formatShares(currentPosition?.yesShares ?? 0)} />
              <TicketStat label="No shares" value={formatShares(currentPosition?.noShares ?? 0)} />
              <TicketStat label="Open cost" value={formatUsdt(currentPosition?.totalCost ?? 0)} />
            </div>
          </div>

          <div className="mt-6 border-t border-[#242b32] pt-5">
            <h3 className="text-base font-semibold text-[#dee3e7]">Trade history</h3>
            {marketTrades.length === 0 ? (
              <p className="mt-3 text-sm font-semibold text-[#7b8996]">No trades yet.</p>
            ) : (
              <div className="mt-4 grid gap-3">
                {marketTrades.slice(0, 6).map((trade) => (
                  <div
                    className="grid gap-2 rounded-2xl bg-[#15191d] p-3 text-sm"
                    key={trade.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="font-semibold text-[#dee3e7]">
                        {trade.action === "sell" ? "Sell" : "Buy"}{" "}
                        {trade.side === "yes" ? "Yes" : "No"}
                      </strong>
                      <span className="font-semibold text-[#7b8996]">
                        {formatRelativeTime(trade.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <strong className="font-semibold text-[#dee3e7]">
                        {formatShares(trade.shares)} shares
                      </strong>
                      <span className="font-semibold text-[#7b8996]">
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

function MarketInfoTabs({
  activeTab,
  framed = false,
  market,
  onTabChange,
}: {
  activeTab: DetailTab;
  framed?: boolean;
  market: Market;
  onTabChange: (tab: DetailTab) => void;
}) {
  const paragraphs = splitDescription(market.description);
  const wrapperClass = framed ? `${panel} mt-8 p-5` : "mb-6 mt-8";

  return (
    <section className={wrapperClass}>
      <div className="flex gap-5 text-base font-semibold">
        <button
          className={activeTab === "rules" ? activeTextTabClass : inactiveTextTabClass}
          onClick={() => onTabChange("rules")}
          type="button"
        >
          Rules
        </button>
        <button
          className={activeTab === "context" ? activeTextTabClass : inactiveTextTabClass}
          onClick={() => onTabChange("context")}
          type="button"
        >
          Market Context
        </button>
      </div>

      {activeTab === "rules" ? (
        <div className="mt-5 space-y-5 text-[15px] leading-6 text-[#0e0f11]">
          {paragraphs.map((paragraph, index) => (
            <p className="break-words" key={`${paragraph.slice(0, 24)}-${index}`}>
              {paragraph}
            </p>
          ))}
        </div>
      ) : (
        <div className="mt-5 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
	            <DetailStat label="Volume" value={formatMoney(market.volume_detail?.volume ?? market.volume)} />
            <DetailStat label="Pool" value={formatMoney(market.volume_detail?.liquidity ?? market.liquidity)} />
            <DetailStat label="Opened" value={formatDate(market.dates?.starts_at ?? market.starts_at)} />
            <DetailStat label="Closes" value={formatDate(market.dates?.ends_at ?? market.ends_at)} />
          </div>
          <div className="overflow-hidden rounded-xl border border-[#e6e8ea] bg-white">
            <div className="flex items-center justify-between gap-4 border-b border-[#e6e8ea] px-4 py-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-[#0e0f11]">
                <AlertCircle className="text-[#1f55f5]" size={16} />
                Additional context
              </div>
              <span className="text-xs font-medium text-[#77808d]">
                Updated {formatShortDate(market.starts_at ?? market.ends_at)}
              </span>
            </div>
            <p className="px-4 py-3 text-[13px] leading-6 text-[#77808d]">
	              PulseMarket imports the public event and resolution context, then displays the
              latest market prices, volume, and chart history as they update.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function MarketFaqSection({
  groupMarkets,
  market,
}: {
  groupMarkets: GroupMarket[];
  market: Market;
}) {
  const [openItemId, setOpenItemId] = React.useState<string | null>(null);
  const items = buildMarketFaq(market, groupMarkets);

  return (
    <section className="mt-9 md:mt-10">
      <h2 className="mb-3 text-[20px] font-semibold leading-tight text-[#0e0f11] sm:text-[22px]">
        Frequently Asked Questions
      </h2>
      <div className="market-detail-faq-list">
        {items.map((item) => {
          const isOpen = item.id === openItemId;
          const answerId = `market-faq-answer-${item.id}`;

          return (
            <div key={item.id}>
              <button
                aria-controls={answerId}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-5 py-5 text-left text-[16px] font-semibold leading-snug text-[#0e0f11] transition hover:text-[#4b5563] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#1f55f5]/60 sm:text-[17px] lg:py-6"
                onClick={() => setOpenItemId(isOpen ? null : item.id)}
                type="button"
              >
                <span className="min-w-0 break-words">{item.question}</span>
                <ChevronDown
                  className={`shrink-0 text-[#77808d] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                    isOpen ? "rotate-180 text-[#0e0f11]" : ""
                  }`}
                  size={16}
                />
              </button>

              <div
                className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
                id={answerId}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="max-w-4xl space-y-3 pb-6 pr-8 text-[14px] font-medium leading-6 text-[#77808d] sm:text-[15px]">
                    {item.answer.map((paragraph, index) => (
                      <p className="break-words" key={`${item.id}-${index}`}>
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MarketActivityTabs({
  activeTab,
  activityMarketLabels,
  commentText,
  currentPosition,
  data,
  framed = false,
  isLoading,
  isPostingComment,
  market,
  onCommentTextChange,
  onPostComment,
  onTabChange,
}: {
  activeTab: ActivityTab;
  activityMarketLabels: Record<string, string>;
  commentText: string;
  currentPosition: LocalPosition | undefined;
  data: MarketActivityPayload;
  framed?: boolean;
  isLoading: boolean;
  isPostingComment: boolean;
  market: Market;
  onCommentTextChange: (value: string) => void;
  onPostComment: () => void | Promise<void>;
  onTabChange: (tab: ActivityTab) => void;
}) {
  const wrapperClass = framed ? `${panel} mt-6 p-5` : "mt-12";
  const activityTrades = data.activity.filter(
    (item): item is MarketTradeActivityItem => item.type === "trade",
  );
  const tabs: Array<{ id: ActivityTab; label: string }> = [
    {
      id: "comments",
      label:
        market.comment_count && market.comment_count > 0
          ? `Comments (${market.comment_count})`
          : data.comments.length > 0
            ? `Comments (${data.comments.length})`
            : "Comments",
    },
    { id: "holders", label: "Top Holders" },
    { id: "positions", label: "Positions" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <section className={wrapperClass}>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-[18px] font-bold sm:text-[19px]">
        {tabs.map((tab) => (
	          <button
	            className={
	              activeTab === tab.id
	                ? "text-[#dee3e7] outline-none focus-visible:outline-none"
	                : "text-[#8794a1] outline-none transition hover:text-[#c8d0d8] focus-visible:outline-none"
	            }
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "comments" ? (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-[#dfe3e7] bg-white px-4 py-3 text-[#77808d]">
          <input
            aria-label="Add a comment"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#0e0f11] outline-none placeholder:text-[#77808d]"
            disabled={isPostingComment}
            onChange={(event) => onCommentTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isPostingComment) {
                void onPostComment();
              }
            }}
            placeholder="Add a comment..."
            type="text"
            value={commentText}
          />
          <SmilePlus className="shrink-0" size={18} />
          <button
            className="rounded-[7.2px] bg-[#9bb7ff] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#7fa1ff] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!commentText.trim() || isPostingComment}
            onClick={() => void onPostComment()}
            type="button"
          >
            {isPostingComment ? "Posting" : "Post"}
          </button>
        </div>
      ) : null}

      {activeTab === "activity" ? (
        <div className="mb-2 mt-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <ActivityFilterButton label="All" />
            <ActivityFilterButton label="Min. Amount" />
          </div>
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[#e23939]">
            <span className="relative flex h-2.5 w-2.5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e23939] opacity-85 [animation-duration:1.2s]" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#e23939]" />
            </span>
            Online
          </div>
        </div>
      ) : null}

      <div className={activeTab === "activity" ? "mt-0" : "mt-5"}>
        {isLoading ? (
          <MarketActivitySkeleton rows={activeTab === "comments" ? 3 : 4} />
        ) : null}

        {!isLoading && activeTab === "comments" ? (
          <div className="grid gap-5">
            {data.comments.length > 0 ? (
              data.comments.map((comment) => (
                <CommentRow comment={comment} key={comment.id} />
              ))
            ) : (
              <EmptyActivityState text="No comments yet." />
            )}
          </div>
        ) : null}

        {!isLoading && activeTab === "holders" ? (
          data.topHolders.length > 0 ? (
            <div className="grid gap-3">
              {data.topHolders.map((holder, index) => (
                <HolderRow holder={holder} index={index} key={holder.id} />
              ))}
            </div>
          ) : (
            <EmptyActivityState text="No holders yet." />
          )
        ) : null}

        {!isLoading && activeTab === "positions" ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <TicketStat label="Your Yes shares" value={formatShares(currentPosition?.yesShares ?? 0)} />
              <TicketStat label="Your No shares" value={formatShares(currentPosition?.noShares ?? 0)} />
              <TicketStat label="Your open cost" value={formatUsdt(currentPosition?.totalCost ?? 0)} />
            </div>
            {data.positions.length > 0 ? (
              <div className="grid gap-3">
                {data.positions.map((position) => (
                  <PositionRow position={position} key={position.id} />
                ))}
              </div>
            ) : (
              <EmptyActivityState text="No public positions yet." />
            )}
          </div>
        ) : null}

        {!isLoading && activeTab === "activity" ? (
          activityTrades.length > 0 ? (
            <div className="w-full">
              {activityTrades.slice(0, 40).map((item) => (
                <ActivityRow
                  activityMarketLabels={activityMarketLabels}
                  item={item}
                  market={market}
                  key={`${item.type}-${item.id}`}
                />
              ))}
            </div>
          ) : (
            <EmptyActivityState text="No activity yet." />
          )
        ) : null}
      </div>
    </section>
  );
}

function CommentRow({ comment }: { comment: MarketComment }) {
  return (
    <div className="flex gap-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#f4f5f6] text-sm font-black uppercase text-[#0e0f11]">
        {comment.displayName.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <strong className="text-sm font-semibold text-[#0e0f11]">{comment.displayName}</strong>
          {comment.positionLabel ? (
            <span className="rounded-full bg-[#f4f5f6] px-2 py-0.5 text-xs font-semibold text-[#77808d]">
              {comment.positionLabel}
            </span>
          ) : null}
          <span className="text-sm font-semibold text-[#77808d]">
            {formatRelativeTime(comment.createdAt)}
          </span>
        </div>
        <p className="mt-2 break-words text-base leading-7 text-[#0e0f11]">{comment.body}</p>
      </div>
      <MessageCircle className="mt-1 shrink-0 text-[#77808d]" size={18} />
    </div>
  );
}

function HolderRow({ holder, index }: { holder: MarketHolder; index: number }) {
  const leadingSide = holder.yesShares >= holder.noShares ? "Yes" : "No";

  return (
    <div className="grid gap-3 rounded-xl border border-[#e6e8ea] bg-white px-4 py-3 text-sm sm:grid-cols-[48px_minmax(0,1fr)_140px_120px] sm:items-center">
      <span className="font-semibold text-[#77808d]">#{index + 1}</span>
      <div className="min-w-0">
        <strong className="block truncate text-[#0e0f11]">{holder.displayName}</strong>
        <span className="text-xs font-semibold text-[#77808d]">
          {leadingSide} heavy · updated {formatRelativeTime(holder.updatedAt)}
        </span>
      </div>
      <strong className="text-[#0e0f11]">{formatShares(holder.shares)} shares</strong>
      <span className="font-semibold text-[#77808d]">{formatUsdt(holder.value)}</span>
    </div>
  );
}

function PositionRow({ position }: { position: MarketPublicPosition }) {
  return (
    <div className="grid gap-3 rounded-xl border border-[#e6e8ea] bg-white px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_86px_120px_120px] sm:items-center">
      <div className="min-w-0">
        <strong className="block truncate text-[#0e0f11]">{position.displayName}</strong>
        <span className="text-xs font-semibold text-[#77808d]">
          Updated {formatRelativeTime(position.updatedAt)}
        </span>
      </div>
      <span
        className={`w-fit rounded-full px-2 py-1 text-xs font-bold uppercase ${
          position.side === "yes" ? "bg-[#3db468]/15 text-[#a6d2b6]" : "bg-[#cb3131]/15 text-[#d78282]"
        }`}
      >
        {position.side}
      </span>
      <strong className="text-[#0e0f11]">{formatShares(position.shares)} shares</strong>
      <span className={position.pnl >= 0 ? "font-semibold text-[#a6d2b6]" : "font-semibold text-[#d78282]"}>
        {position.pnl >= 0 ? "+" : ""}
        {formatUsdt(position.pnl)}
      </span>
    </div>
  );
}

function ActivityFilterButton({ label }: { label: string }) {
  return (
    <button
      aria-label={label}
      className="group inline-flex h-10 w-fit shrink-0 items-center gap-2 rounded-full bg-[var(--pm-surface-2)] px-4 text-sm font-semibold text-[var(--pm-text-primary)] transition duration-150 active:scale-[0.97] hover:bg-[var(--pm-surface-3)]"
      type="button"
    >
      {label}
      <ChevronDown className="transition-transform duration-200 group-data-[state=open]:rotate-180" size={12} />
    </button>
  );
}

function ActivityRow({
  activityMarketLabels,
  item,
  market,
}: {
  activityMarketLabels: Record<string, string>;
  item: MarketTradeActivityItem;
  market: Market;
}) {
  const sideLabel = item.side === "yes" ? "Yes" : "No";
  const sideClass = item.side === "yes" ? "text-[#30a159]" : "text-[#e23939]";
  const outcomeLabel = getActivityOutcomeLabel(market, item, activityMarketLabels);
  const actionLabel = item.action === "sell" ? "sold" : "bought";

  return (
    <div className="flex min-h-[60px] w-full min-w-0 items-center border-b border-[var(--pm-border)] py-2">
      <ActivityAvatar seed={`${item.userId}:${item.displayName}`} label={item.displayName} />
      <div className="ml-2 flex min-w-0 flex-1 items-center">
        <div className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-[var(--pm-text-primary)]">
          <strong className="font-semibold text-[var(--pm-text-primary)]">
            {truncateActivityName(item.displayName)}
          </strong>{" "}
          <span>{actionLabel}</span>{" "}
          <strong className={`font-semibold ${sideClass}`}>
            {formatActivityShares(item.shares)} {sideLabel}
          </strong>{" "}
          <span>for</span>{" "}
          <strong className="font-semibold text-[var(--pm-text-primary)]">{outcomeLabel}</strong>{" "}
          <span>at {formatActivityCents(item.price)}</span>{" "}
          <span className="text-[var(--pm-text-secondary)]">({formatActivityMoney(item.amount)})</span>
        </div>
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-2 text-sm font-medium text-[var(--pm-text-secondary)]">
        <span className="whitespace-nowrap">{formatActivityRelativeTime(item.createdAt)}</span>
        <button
          aria-label="Open activity"
          className="flex items-center text-[var(--pm-text-secondary)] transition hover:text-[var(--pm-text-primary)]"
          type="button"
        >
          <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}

function ActivityAvatar({ seed, label }: { seed: string; label: string }) {
  const palette = getActivityAvatarPalette(seed);

  return (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-black uppercase text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      style={{
        background:
          `radial-gradient(circle at 34% 28%, ${palette[0]} 0, transparent 34%), ` +
          `radial-gradient(circle at 72% 70%, ${palette[1]} 0, transparent 42%), ` +
          `linear-gradient(135deg, ${palette[2]}, ${palette[3]})`,
      }}
    >
      {label.trim().slice(0, 1)}
    </span>
  );
}

function getActivityOutcomeLabel(
  market: Market,
  item: MarketTradeActivityItem,
  activityMarketLabels: Record<string, string>,
) {
  return formatMarketText(
    activityMarketLabels[item.marketId] ||
      market.groupItemTitle ||
      market.event_title ||
      market.title ||
      "this market",
  );
}

function truncateActivityName(value: string) {
  const trimmed = value.trim() || "Trader";

  if (trimmed.length <= 18) {
    return trimmed;
  }

  return `${trimmed.slice(0, 15)}...`;
}

function formatActivityShares(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatActivityCents(value: number) {
  return `${(value * 100).toFixed(1)}¢`;
}

function formatActivityMoney(value: number) {
  return `$${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value)}`;
}

function formatActivityRelativeTime(value: string) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "just now";
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function getActivityAvatarPalette(seed: string) {
  const palettes = [
    ["#9b5cf6", "#17c964", "#232a50", "#0d3b35"],
    ["#22c55e", "#f97316", "#0f766e", "#6d28d9"],
    ["#f97316", "#f9d36a", "#111827", "#7c2d12"],
    ["#f472b6", "#86efac", "#64748b", "#f5d0fe"],
    ["#84cc16", "#22d3ee", "#166534", "#65a30d"],
    ["#60a5fa", "#f43f5e", "#1e3a8a", "#0f172a"],
  ];
  const index = hashString(seed) % palettes.length;
  return palettes[index] ?? palettes[0];
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function EmptyActivityState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#dfe3e7] bg-white p-4 text-sm font-semibold text-[#77808d]">
      {text}
    </div>
  );
}

function LegacyMarketActivityTabs({
  activeTab,
  comments,
  commentText,
  currentPosition,
  framed = false,
  market,
  marketTrades,
  onCommentTextChange,
  onPostComment,
  onTabChange,
}: {
  activeTab: ActivityTab;
  comments: LocalComment[];
  commentText: string;
  currentPosition: LocalPosition | undefined;
  framed?: boolean;
  market: Market;
  marketTrades: Trade[];
  onCommentTextChange: (value: string) => void;
  onPostComment: () => void;
  onTabChange: (tab: ActivityTab) => void;
}) {
  const wrapperClass = framed ? `${panel} mt-6 p-5` : "mt-12";
  const tabs: Array<{ id: ActivityTab; label: string }> = [
    {
      id: "comments",
      label: comments.length > 0 ? `Comments (${comments.length})` : "Comments",
    },
    { id: "holders", label: "Top Holders" },
    { id: "positions", label: "Positions" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <section className={wrapperClass}>
      <div className="flex flex-wrap gap-5 text-base font-semibold">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? activeTextTabClass : inactiveTextTabClass}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[#242b32] bg-[#15191d] px-4 py-3 text-[#7b8996]">
        <input
          aria-label="Add a comment"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#dee3e7] outline-none placeholder:text-[#7b8996]"
          onChange={(event) => onCommentTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onPostComment();
            }
          }}
          placeholder="Add a comment..."
          type="text"
          value={commentText}
        />
        <SmilePlus className="shrink-0" size={18} />
        <button
          className="rounded-2xl bg-[#0093fd]/25 px-4 py-2 text-sm font-semibold text-[#0093fd] transition hover:bg-[#0093fd]/35 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!commentText.trim()}
          onClick={onPostComment}
          type="button"
        >
          Post
        </button>
      </div>

      <div className="mt-5">
        {activeTab === "comments" ? (
          <div className="grid gap-5">
            {comments.length > 0 ? (
              comments.map((comment) => (
                <div className="flex gap-4" key={comment.id}>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#242b32] text-sm font-black uppercase text-[#dee3e7]">
                    {comment.author.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <strong className="text-sm font-semibold text-[#dee3e7]">
                        {comment.author}
                      </strong>
                      {comment.positionLabel ? (
                        <span className="rounded-full bg-[#2e3841] px-2 py-0.5 text-xs font-semibold text-[#7b8996]">
                          {comment.positionLabel}
                        </span>
                      ) : null}
                      <span className="text-sm font-semibold text-[#7b8996]">{comment.time}</span>
                    </div>
                    <p className="mt-2 break-words text-base leading-7 text-[#dee3e7]">
                      {comment.text}
                    </p>
                  </div>
                  <MessageCircle className="mt-1 shrink-0 text-[#7b8996]" size={18} />
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-[#242b32] bg-[#15191d] p-4 text-sm font-semibold text-[#7b8996]">
                No comments yet.
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "holders" ? (
          <div className="grid gap-3">
            {buildHolderRows(currentPosition, market).map((holder) => (
              <div
                className="flex items-center justify-between gap-4 rounded-2xl bg-[#15191d] px-4 py-3"
                key={holder.label}
              >
                <span className="min-w-0 truncate text-sm font-semibold text-[#dee3e7]">
                  {holder.label}
                </span>
                <strong className="shrink-0 text-sm font-semibold text-[#7b8996]">
                  {holder.value}
                </strong>
              </div>
            ))}
          </div>
        ) : null}

        {activeTab === "positions" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <TicketStat label="Yes shares" value={formatShares(currentPosition?.yesShares ?? 0)} />
            <TicketStat label="No shares" value={formatShares(currentPosition?.noShares ?? 0)} />
            <TicketStat label="Open cost" value={formatUsdt(currentPosition?.totalCost ?? 0)} />
          </div>
        ) : null}

        {activeTab === "activity" ? (
          marketTrades.length > 0 ? (
            <div className="grid gap-3">
              {marketTrades.slice(0, 8).map((trade) => (
                <div className="grid gap-2 rounded-2xl bg-[#15191d] p-3 text-sm" key={trade.id}>
                  <div className="flex items-center justify-between gap-3">
                    <strong className="font-semibold text-[#dee3e7]">
                      {trade.action === "sell" ? "Sell" : "Buy"}{" "}
                      {trade.side === "yes" ? "Yes" : "No"}
                    </strong>
                    <span className="font-semibold text-[#7b8996]">
                      {formatRelativeTime(trade.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <strong className="font-semibold text-[#dee3e7]">
                      {formatShares(trade.shares)} shares
                    </strong>
                    <span className="font-semibold text-[#7b8996]">
                      {formatUsdt(trade.amount)} @ {formatPercent(trade.price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#242b32] bg-[#15191d] p-4 text-sm font-semibold text-[#7b8996]">
              No activity yet.
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function buildHolderRows(currentPosition: LocalPosition | undefined, market: Market) {
  const userShares = (currentPosition?.yesShares ?? 0) + (currentPosition?.noShares ?? 0);

  return [
    { label: "You", value: `${formatShares(userShares)} shares` },
    { label: "Pool", value: formatMoney(market.liquidity) },
    { label: "Volume", value: formatMoney(market.volume_detail?.volume ?? market.volume) },
  ];
}

function getOutcomeVolume(market: Market, outcomeName: string) {
  const latest = market.history?.price_history.at(-1);

  return latest?.outcomeVolumes?.[outcomeName] ?? 0;
}

function QuotePreview({
  error,
  quote,
  status,
}: {
  error: string | null;
  quote: TradingQuote | null;
  status: "idle" | "loading" | "ready" | "error";
}) {
  if (status === "idle" && !quote) {
    return null;
  }

  if (status === "loading" && !quote) {
    return (
      <div className="rounded-lg border border-[#e6e8ea] bg-[#f7f8fa] px-3 py-2 text-sm font-semibold text-[#77808d]">
        Calculating quote...
      </div>
    );
  }

  if (status === "error" && !quote) {
    return (
      <div className="rounded-lg border border-[#e23939]/20 bg-[#e23939]/10 px-3 py-2 text-sm font-semibold text-[#991b1b]">
        {error ?? "Quote unavailable"}
      </div>
    );
  }

  if (!quote) {
    return null;
  }

  const impact = quote.priceImpact;

  return (
    <div className="grid gap-2 rounded-lg border border-[#e6e8ea] bg-[#f7f8fa] px-3 py-3">
      <QuoteRow label="Current odds" value={formatPercent(quote.currentOdds)} />
      <QuoteRow label="Est. payout" value={formatUsd(quote.estimatedPayout)} tone="green" />
      <QuoteRow label="Est. profit" value={formatUsd(quote.estimatedProfit)} tone={quote.estimatedProfit >= 0 ? "green" : "red"} />
      <QuoteRow label="Fee" value={formatUsd(quote.fee)} />
      <QuoteRow label="Balance after" value={formatUsd(quote.balanceAfterBet)} />
      <QuoteRow label="Pool" value={`${formatUsd(quote.poolBefore)} -> ${formatUsd(quote.poolAfter)}`} />
      <QuoteRow
        label="Price impact"
        value={`${impact >= 0 ? "+" : ""}${formatPercent(impact)}`}
        tone={impact >= 0 ? "green" : "red"}
      />
    </div>
  );
}

function QuoteRow({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "green" | "red";
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs font-semibold">
      <span className="text-[#77808d]">{label}</span>
      <strong
        className={
          tone === "green"
            ? "text-[#30a159]"
            : tone === "red"
              ? "text-[#e23939]"
              : "text-[#0e0f11]"
        }
      >
        {value}
      </strong>
    </div>
  );
}

function SummaryRow({
  accent = false,
  label,
  value,
}: {
  accent?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm font-semibold">
      <span className="text-[#77808d]">{label}</span>
      <strong className={accent ? "text-[#30a159]" : "text-[#0e0f11]"}>{value}</strong>
    </div>
  );
}

function TradeInfoRow({
  label,
  tone = "blue",
  value,
  withInfo = false,
}: {
  label: string;
  tone?: "blue" | "green";
  value: string;
  withInfo?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="flex items-center gap-1.5 text-base font-medium leading-5 text-[#0e0f11]">
        {label}
        {withInfo ? <Info className="text-[#77808d]" size={16} /> : null}
      </p>
      <p
        className={`text-[20px] font-semibold leading-6 ${
          tone === "green" ? "text-[#30a159]" : "text-[#1f55f5]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function TicketStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs font-bold uppercase tracking-wide text-[#77808d]">
        {label}
      </span>
      <strong className="mt-1 block break-words text-sm font-semibold text-[#0e0f11]">{value}</strong>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-xs font-bold uppercase tracking-wide text-[#77808d]">
        {label}
      </span>
      <strong className="mt-1 block break-words text-sm font-semibold text-[#0e0f11]">{value}</strong>
    </div>
  );
}

function getTradeActionLabel(action: "buy" | "sell") {
  return action === "buy" ? "Buy" : "Sell";
}

function getActionDisplayPrice(price: number | null, action: "buy" | "sell") {
  if (price === null) {
    return null;
  }

  if (action === "sell") {
    return Math.max(0.01, price - 0.01);
  }

  return price;
}

function parseLimitPrice(value: string) {
  const cents = Number(value);

  if (!Number.isFinite(cents) || cents <= 0) {
    return null;
  }

  return Math.min(99, cents) / 100;
}

function formatInputNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0.00";
  }

  return `$${value.toFixed(2)}`;
}

function formatEnglishDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function hasDistinctGroupMarketImage(parentMarket: Market, groupMarket: GroupMarket) {
  const groupImage = normalizeImageUrl(getSourceImage(groupMarket));

  if (!groupImage) {
    return false;
  }

  const parentImages = [
    getSourceImage(parentMarket),
    parentMarket.displayImage,
    parentMarket.image,
    parentMarket.icon,
  ]
    .map(normalizeImageUrl)
    .filter((image): image is string => Boolean(image));

  return !parentImages.includes(groupImage);
}

function normalizeImageUrl(value: string | null | undefined) {
  return value?.trim() || null;
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
      "PulseMarket imports the public event context and displays market prices, activity, and chart history for this contract.",
    ];
  }

  return description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function buildMarketFaq(market: Market, groupMarkets: GroupMarket[]): MarketFaqItem[] {
  const title = formatMarketText(market.title).replace(/\s+/g, " ");
  const outcomes = getFaqOutcomes(market, groupMarkets);
  const outcomeCount = outcomes.length > 0 ? outcomes.length : 2;
  const leadingOutcome = outcomes[0] ?? null;
  const secondOutcome = outcomes[1] ?? null;
  const volume = market.volume_detail?.volume ?? market.volume;
  const openedAt = market.dates?.starts_at ?? market.starts_at;
  const rulesPreview = splitDescription(market.description).slice(0, 2);

  const overviewAnswer = groupMarkets.length > 0
    ? [
        `"${title}" is a PulseMarket prediction market based on a public PulseMarket event, with ${outcomeCount} possible outcomes where traders buy and sell shares based on what they believe will happen. ${buildLeadingOutcomeSentence(leadingOutcome, secondOutcome)} Prices reflect crowd-sourced probabilities. ${buildPriceExample(leadingOutcome)}`,
        "These odds shift as traders react to new developments and information. Shares in the correct outcome are redeemable for $1 each upon market resolution.",
      ]
    : [
        `"${title}" is a PulseMarket prediction market based on a public PulseMarket event where traders buy and sell "Yes" or "No" shares based on whether they believe this event will happen. ${buildBinaryProbabilitySentence(outcomes)} ${buildPriceExample(leadingOutcome)}`,
        "The price updates as traders react to new information. Shares in the correct outcome are redeemable for $1 each when the market resolves.",
      ];

  return [
    {
      id: "overview",
      question: `What is the "${title}" prediction market?`,
      answer: overviewAnswer,
    },
    {
      id: "activity",
      question: `How much trading activity has "${title}" generated on PulseMarket?`,
      answer: [
        `As of the latest PulseMarket data, "${title}" has generated ${formatMoney(volume)} in trading volume${openedAt ? ` since the market launched on ${formatDate(openedAt)}` : ""}. This activity reflects participant engagement and helps move the displayed odds.`,
        "You can track price movement, volume, and each tradable outcome directly on this page.",
      ],
    },
    {
      id: "trade",
      question: `How do I trade on "${title}"?`,
      answer: [
        `To trade on "${title}", browse the ${outcomeCount} available outcome${outcomeCount === 1 ? "" : "s"} listed on this page. Each outcome displays a current price representing the market's implied probability.`,
        "Select the outcome you believe is most likely, choose Yes to trade in favor of it or No to trade against it, enter your amount, and place the order. If your chosen outcome is correct when the market resolves, Yes shares pay out $1 each; if it is incorrect, they pay out $0.",
      ],
    },
    {
      id: "odds",
      question: `What are the current odds for "${title}"?`,
      answer: [buildCurrentOddsAnswer(title, outcomes)],
    },
    {
      id: "resolution",
      question: `How will "${title}" be resolved?`,
      answer: [
        `The resolution rules for "${title}" define exactly what needs to happen for each outcome to be declared a winner, including the sources used to determine the result. Review the complete criteria in the Rules section above the comments before trading.`,
        ...rulesPreview,
      ],
    },
  ];
}

function getFaqOutcomes(market: Market, groupMarkets: GroupMarket[]): FaqOutcome[] {
  const outcomes = groupMarkets.length > 0
    ? groupMarkets.map((groupMarket) => ({
        label: formatMarketText(groupMarket.label),
        price: groupMarket.yes_price,
      }))
    : market.outcomes.map((outcome) => ({
        label: formatMarketText(outcome.name),
        price: outcome.price ?? outcome.probability ?? null,
      }));

  return outcomes
    .filter((outcome) => outcome.label.trim())
    .sort((left, right) => (right.price ?? -1) - (left.price ?? -1));
}

function buildLeadingOutcomeSentence(
  leadingOutcome: FaqOutcome | null,
  secondOutcome: FaqOutcome | null,
) {
  if (!leadingOutcome) {
    return "";
  }

  const secondOutcomeText = secondOutcome
    ? `, followed by "${secondOutcome.label}" at ${formatPercent(secondOutcome.price)}`
    : "";

  return `The current leading outcome is "${leadingOutcome.label}" at ${formatPercent(leadingOutcome.price)}${secondOutcomeText}.`;
}

function buildBinaryProbabilitySentence(outcomes: FaqOutcome[]) {
  const yesOutcome = outcomes.find((outcome) => outcome.label.toLowerCase() === "yes") ?? outcomes[0];
  const noOutcome = outcomes.find((outcome) => outcome.label.toLowerCase() === "no") ?? outcomes[1];

  if (!yesOutcome && !noOutcome) {
    return "Prices reflect the market's current crowd-sourced probability.";
  }

  if (yesOutcome && noOutcome) {
    return `The current crowd-sourced probability is ${formatPercent(yesOutcome.price)} for "Yes" and ${formatPercent(noOutcome.price)} for "No".`;
  }

  const visibleOutcome = yesOutcome ?? noOutcome;

  return `The current crowd-sourced probability is ${formatPercent(visibleOutcome?.price ?? null)} for "${visibleOutcome?.label ?? "this outcome"}."`;
}

function buildPriceExample(outcome: FaqOutcome | null) {
  if (!outcome || outcome.price === null) {
    return "Each price represents what the market currently believes is most likely.";
  }

  return `For example, a share priced at ${formatCents(outcome.price)} implies the market collectively assigns roughly a ${formatPercent(outcome.price)} chance to "${outcome.label}".`;
}

function buildCurrentOddsAnswer(title: string, outcomes: FaqOutcome[]) {
  const leadingOutcome = outcomes[0] ?? null;
  const secondOutcome = outcomes[1] ?? null;

  if (!leadingOutcome) {
    return `The current odds for "${title}" will appear here once trading data is available.`;
  }

  const nextClosest = secondOutcome
    ? ` The next closest outcome is "${secondOutcome.label}" at ${formatPercent(secondOutcome.price)}.`
    : "";

  return `The current frontrunner for "${title}" is "${leadingOutcome.label}" at ${formatPercent(leadingOutcome.price)}, meaning the market assigns roughly that probability to the outcome.${nextClosest} These odds update in real time as traders buy and sell shares, so they reflect the latest collective view of what is most likely to happen.`;
}
