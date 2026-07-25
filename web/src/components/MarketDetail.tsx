import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bookmark,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Heart,
  Link2,
  MessageCircle,
  MoreHorizontal,
} from "lucide-react";
import {
  createTradingQuoteApi,
  loadMarketActivity,
  placeTradeApi,
  postMarketComment,
} from "../lib/api";
import {
  formatCents,
  formatDate,
  formatMoney,
  formatPercent,
  formatRelativeTime,
  formatShares,
  formatShortDate,
  addCoinMicros,
  addDecimalValues,
  coinMicrosToInput,
  compareCoinMicros,
  compareDecimalValues,
  formatCoinMicros,
  isPositiveDecimal,
  multiplyDecimalByRatio,
  parseCoinInputToMicros,
} from "../lib/format";
import { getMarketEyebrowParts, getOutcomeActionLabel, getSourceImage } from "../lib/market";
import { formatMarketText } from "../lib/marketText";
import type {
  LocalPosition,
  Market,
  MarketActivityItem,
  MarketActivityPayload,
  MarketComment,
  MarketHolder,
  Trade,
  TradingQuote,
} from "../lib/types";
import { usePortfolio } from "../hooks/usePortfolio";
import { useCoinAccount } from "../hooks/useCoinAccount";
import { MarketChart } from "./MarketChart";
import { MarketImage, OutcomeAvatar } from "./MarketMedia";
import { MarketActivitySkeleton } from "./MarketSkeleton";

type GroupMarket = NonNullable<Market["group_markets"]>[number];
type DetailTab = "rules" | "context";
type ActivityTab = "comments" | "holders" | "activity";
type MarketTradeActivityItem = Extract<MarketActivityItem, { type: "trade" }>;
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
const emptyMarketActivity: MarketActivityPayload = {
  comments: [],
  topHolders: [],
  activity: [],
};

export function MarketDetail({
  canComment,
  isAuthenticated,
  market: initialMarket,
  detailStatus,
  onBack,
  onDepositRequested,
  onLoginRequested,
}: {
  canComment: boolean;
  isAuthenticated: boolean;
  market: Market;
  detailStatus: "idle" | "loading" | "ready" | "error";
  onBack: () => void;
  onDepositRequested: () => void;
  onLoginRequested: () => void;
}) {
  const [market, setMarket] = React.useState(initialMarket);
  const [side, setSide] = React.useState<"yes" | "no">("yes");
  const [action, setAction] = React.useState<"buy" | "sell">("buy");
  const [amount, setAmount] = React.useState("0");
  const [detailTab, setDetailTab] = React.useState<DetailTab>("rules");
  const [activityTab, setActivityTab] = React.useState<ActivityTab>("comments");
  const [commentText, setCommentText] = React.useState("");
  const [marketActivity, setMarketActivity] =
    React.useState<MarketActivityPayload>(emptyMarketActivity);
  const [marketActivityStatus, setMarketActivityStatus] =
    React.useState<"loading" | "ready" | "error">("loading");
  const [isPostingComment, setIsPostingComment] = React.useState(false);
  const [isPlacingTrade, setIsPlacingTrade] = React.useState(false);
  const [orderType, setOrderType] = React.useState<"market" | "limit">("market");
  const [isOrderTypeMenuOpen, setIsOrderTypeMenuOpen] = React.useState(false);
  const orderTypeTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const orderTypePopoverRef = React.useRef<HTMLDivElement | null>(null);
  const orderTypeOptionRefs = React.useRef<
    Record<"market" | "limit", HTMLButtonElement | null>
  >({
    market: null,
    limit: null,
  });
  const [limitPrice, setLimitPrice] = React.useState("");
  const [quote, setQuote] = React.useState<TradingQuote | null>(null);
  const [quoteStatus, setQuoteStatus] =
    React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [quoteError, setQuoteError] = React.useState<string | null>(null);
  const [tradeMessage, setTradeMessage] = React.useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [isSaved, setIsSaved] = React.useState(false);
  const [portfolio, setPortfolio] = usePortfolio();
  const {
    balance: coinBalance,
    refreshBalance: refreshCoinBalance,
    supportedAssets,
  } = useCoinAccount();
  const depositEnabled =
    supportedAssets?.settlementAssets.some((rail) => rail.depositEnabled) ?? false;
  const groupMarkets = sortGroupMarketsForDetail(market.group_markets ?? []);
  const isGroupedEvent = groupMarkets.length > 1;
  const liveGroupMarkets = groupMarkets.filter(isLiveGroupMarket);
  const resolvedGroupMarkets = groupMarkets.filter((groupMarket) => !isLiveGroupMarket(groupMarket));
  const isTradingClosed =
    market.closed ||
    market.archived ||
    market.status === "closed" ||
    market.status === "expired" ||
    (isGroupedEvent && liveGroupMarkets.length === 0);
  const [showResolvedGroups, setShowResolvedGroups] = React.useState(
    liveGroupMarkets.length === 0 && resolvedGroupMarkets.length > 0,
  );
  const initialSelectedMarketId =
    liveGroupMarkets[0]?.id ??
    groupMarkets[0]?.id ??
    groupMarkets.find((groupMarket) => groupMarket.id === market.canonical_market_id)?.id ??
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
  const currentPosition = portfolio.positions.find(
    (position) => position.marketId === tradeMarket.id,
  );
  const marketTrades = portfolio.trades.filter((trade) => trade.marketId === tradeMarket.id);
  const selectedVariantLabel =
    selectedGroupMarket?.label ?? tradeMarket.groupItemTitle ?? tradeMarket.title;
  const marketDisplayTitle = formatMarketText(market.title);
  const tradeMarketDisplayTitle = formatMarketText(tradeMarket.title);
  const eyebrowParts = getMarketEyebrowParts(market);
  const selectedOutcomeLabel =
    isGroupedEvent
      ? `${formatMarketText(selectedVariantLabel)} ${side === "yes" ? "Yes" : "No"}`
      : side === "yes"
        ? formatMarketText(primaryOutcome?.name) || "Yes"
        : formatMarketText(secondaryOutcome?.name) || "No";
  const selectedPrice = side === "yes"
    ? yes?.price ?? yes?.probability ?? null
    : no?.price ?? no?.probability ?? null;
  const buyAmountCoinMicros = action === "buy" ? parseCoinInputToMicros(amount) : null;
  const hasAvailableCoins = BigInt(coinBalance?.availableCoinMicros ?? "0") > 0n;
  const hasValidAmount =
    action === "buy" ? buyAmountCoinMicros !== null : isPositiveDecimal(amount);
  const limitPriceValue = Number(limitPrice) / 100;
  const hasValidLimitPrice =
    orderType === "market" ||
    (Number.isFinite(limitPriceValue) && limitPriceValue > 0 && limitPriceValue < 1);
  const selectedSideShares =
    side === "yes" ? currentPosition?.yesShares ?? "0" : currentPosition?.noShares ?? "0";
  const displayOutcomes =
    isGroupedEvent
      ? (liveGroupMarkets.length > 0 ? liveGroupMarkets : groupMarkets).map((groupMarket) => ({
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
  }, [market.id]);

  React.useEffect(() => {
    setAmount("0");
    setTradeMessage(null);
    setQuote(null);
    setQuoteStatus("idle");
    setQuoteError(null);
    setLimitPrice("");
    setOrderType("market");
    setIsOrderTypeMenuOpen(false);
  }, [tradeMarket.id]);

  React.useEffect(() => {
    if (!isOrderTypeMenuOpen) {
      return undefined;
    }

    orderTypeOptionRefs.current[orderType]?.focus();

    function closeOrderTypePopoverOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setIsOrderTypeMenuOpen(false);
      orderTypeTriggerRef.current?.focus();
    }

    function closeOrderTypePopoverOnOutsidePointer(event: PointerEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (
        orderTypePopoverRef.current?.contains(event.target) ||
        orderTypeTriggerRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsOrderTypeMenuOpen(false);
    }

    document.addEventListener("keydown", closeOrderTypePopoverOnEscape);
    document.addEventListener("pointerdown", closeOrderTypePopoverOnOutsidePointer);

    return () => {
      document.removeEventListener("keydown", closeOrderTypePopoverOnEscape);
      document.removeEventListener("pointerdown", closeOrderTypePopoverOnOutsidePointer);
    };
  }, [isOrderTypeMenuOpen, orderType]);

  React.useEffect(() => {
    if (!isAuthenticated || !selectedPrice || selectedPrice <= 0 || !hasValidAmount) {
      setQuote(null);
      setQuoteStatus("idle");
      setQuoteError(null);
      return undefined;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setQuoteStatus("loading");
      setQuoteError(null);
      void createTradingQuoteApi({
        marketId: tradeMarket.id,
        side,
        action,
        amountCoinMicros: action === "buy" ? buyAmountCoinMicros ?? undefined : undefined,
        shares: action === "sell" ? amount : undefined,
      })
        .then((nextQuote) => {
          if (!cancelled) {
            setQuote(nextQuote);
            setQuoteStatus("ready");
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setQuote(null);
            setQuoteStatus("error");
            setQuoteError(error instanceof Error ? error.message : "Could not quote this trade.");
          }
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    action,
    amount,
    buyAmountCoinMicros,
    hasValidAmount,
    isAuthenticated,
    selectedPrice,
    side,
    tradeMarket.id,
  ]);

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

  async function copyMarketLink() {
    await copyTextToClipboard(window.location.href);
  }

  function toggleSavedMarket() {
    setIsSaved((current) => !current);
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
      });
      setMarketActivity(nextActivity);
      setMarketActivityStatus("ready");
      setCommentText("");
      setActivityTab("comments");
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Could not post comment.");
    } finally {
      setIsPostingComment(false);
    }
  }

  async function placeTrade() {
    if (!isAuthenticated) {
      onLoginRequested();
      return;
    }

    if (action === "buy" && BigInt(coinBalance?.availableCoinMicros ?? "0") <= 0n) {
      if (depositEnabled) {
        onDepositRequested();
      } else {
        setTradeMessage({
          tone: "error",
          text: "No Available Coins. The external deposit rail is currently unavailable.",
        });
      }
      return;
    }

    if (!selectedPrice || selectedPrice <= 0) {
      setTradeMessage({ tone: "error", text: "Price is not available for this side yet." });
      return;
    }

    if (!hasValidAmount) {
      setTradeMessage({ tone: "error", text: "Enter a valid amount." });
      return;
    }

    if (!hasValidLimitPrice) {
      setTradeMessage({ tone: "error", text: "Enter a limit price between 1¢ and 99¢." });
      return;
    }

    if (
      orderType === "limit" &&
      ((action === "buy" && selectedPrice > limitPriceValue) ||
        (action === "sell" && selectedPrice < limitPriceValue))
    ) {
      setTradeMessage({
        tone: "info",
        text: `The current price is ${formatCents(selectedPrice)}. This limit is not marketable yet, so no order was executed.`,
      });
      return;
    }

    if (
      action === "buy" &&
      buyAmountCoinMicros &&
      compareCoinMicros(buyAmountCoinMicros, coinBalance?.availableCoinMicros ?? "0") === 1
    ) {
      setTradeMessage({ tone: "error", text: "Insufficient balance." });
      return;
    }

    if (
      action === "sell" &&
      compareDecimalValues(amount, selectedSideShares, 6) === 1
    ) {
      setTradeMessage({ tone: "error", text: "Insufficient shares." });
      return;
    }

    setIsPlacingTrade(true);
    setTradeMessage({ tone: "info", text: "Placing order..." });
    try {
      const result = await placeTradeApi({
        marketId: tradeMarket.id,
        side,
        action,
        amountCoinMicros: action === "buy" ? buyAmountCoinMicros ?? undefined : undefined,
        shares: action === "sell" ? amount : undefined,
      });
      setPortfolio(result.portfolio);
      void refreshCoinBalance().catch(() => undefined);
      if (result.market) {
        setMarket(result.market);
      }
      setAmount("0");
      setTradeMessage({
        tone: "success",
        text:
          action === "buy"
            ? `Bought ${formatShares(result.trade.shares)} ${selectedOutcomeLabel} shares for ${formatCoinMicros(result.trade.amountCoinMicros)}.`
            : `Sold ${formatShares(result.trade.shares)} ${selectedOutcomeLabel} shares for ${formatCoinMicros(result.trade.amountCoinMicros)}.`,
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

  function changeTradeAction(nextAction: "buy" | "sell") {
    setAction(nextAction);
    setAmount("0");
    setQuote(null);
    setQuoteStatus("idle");
    setQuoteError(null);
    setTradeMessage(null);
  }

  function selectGroupedOutcome(marketId: string, nextSide: "yes" | "no" = side) {
    if (marketId !== selectedMarketId) {
      setAmount("0");
    }

    setSelectedMarketId(marketId);
    setSide(nextSide);
    setQuote(null);
    setQuoteStatus("idle");
    setQuoteError(null);
    setTradeMessage(null);
  }

  function updateTradeAmount(value: string) {
    const normalized = value.replace(/[^0-9.]/g, "");
    const [whole = "", ...decimalParts] = normalized.split(".");
    const nextAmount = decimalParts.length > 0
      ? `${whole || "0"}.${decimalParts.join("")}`
      : whole;

    setAmount(nextAmount || "0");
    setTradeMessage(null);
  }

  function changeOrderType(nextOrderType: "market" | "limit") {
    setOrderType(nextOrderType);
    setIsOrderTypeMenuOpen(false);
    orderTypeTriggerRef.current?.focus();
    setTradeMessage(null);
    if (nextOrderType === "limit" && selectedPrice) {
      setLimitPrice(String(Math.max(1, Math.min(99, Math.round(selectedPrice * 100)))));
    }
  }

  function addQuickTradeAmount(value: string) {
    const currentMicros = parseCoinInputToMicros(amount, true) ?? "0";
    const incrementMicros = parseCoinInputToMicros(value) ?? "0";
    const nextMicros = addCoinMicros(currentMicros, incrementMicros) ?? currentMicros;
    const maximum = coinBalance?.availableCoinMicros ?? "0";
    const capped = compareCoinMicros(nextMicros, maximum) === 1 ? maximum : nextMicros;

    setAmount(coinMicrosToInput(capped));
    setTradeMessage(null);
  }

  function setSellSharePercent(numerator: bigint, denominator: bigint) {
    setAmount(multiplyDecimalByRatio(selectedSideShares, numerator, denominator, 6) ?? "0");
    setTradeMessage(null);
  }

  function setMaximumTradeAmount() {
    const maximum =
      action === "buy"
        ? coinMicrosToInput(coinBalance?.availableCoinMicros ?? "0")
        : selectedSideShares;
    setAmount(maximum);
    setTradeMessage(null);
  }

  function renderTradeTicket() {
    const ticketPrimaryLabel = isGroupedEvent
      ? formatMarketText(selectedVariantLabel)
      : formatEnglishDate(tradeMarket.dates?.ends_at ?? tradeMarket.ends_at) ?? selectedOutcomeLabel;
    const sideLabel = side === "yes" ? "Yes" : "No";
    const ticketTitle = isGroupedEvent ? marketDisplayTitle : tradeMarketDisplayTitle;
    const ticketImageMarket =
      selectedGroupMarket && !hasDistinctGroupMarketImage(market, selectedGroupMarket)
        ? market
        : tradeMarket;

    return (
      <>
        <div className="market-trade-ticket flex h-full w-full flex-col overflow-hidden rounded-[16px] border border-[var(--pm-border)] bg-[var(--pm-surface-1)] shadow-none">
          <div className="flex items-center gap-3 px-4 pb-2 pt-4">
            <MarketImage market={ticketImageMarket} className="h-12 w-12 min-w-12 rounded-[7px]" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px] font-medium leading-5 text-[var(--pm-text-secondary)]">
                {ticketTitle}
              </span>
              <span className="flex min-w-0 items-center text-base font-semibold leading-5 text-[var(--pm-text-primary)]">
                <span className="min-w-0 truncate">{ticketPrimaryLabel}</span>
                <span className="mx-1.5 shrink-0 text-[var(--pm-text-tertiary)]">·</span>
                <span className={side === "yes" ? "shrink-0 text-[var(--pm-green)]" : "shrink-0 text-[var(--pm-red)]"}>
                  {sideLabel}
                </span>
              </span>
            </div>
          </div>

          <div className="relative flex h-[41px] items-end justify-between border-b border-[var(--pm-border)] px-4">
            <div className="flex h-full items-end gap-4 text-[18px] font-semibold leading-none">
              {(["buy", "sell"] as const).map((nextAction) => (
                <button
                  aria-pressed={action === nextAction}
                  className={`relative h-full bg-transparent pt-0.5 capitalize transition ${
                    action === nextAction
                      ? "text-[var(--pm-text-primary)]"
                      : "text-[var(--pm-text-secondary)] hover:text-[var(--pm-text-primary)]"
                  }`}
                  key={nextAction}
                  onClick={() => changeTradeAction(nextAction)}
                  type="button"
                >
                  {nextAction}
                  {action === nextAction ? (
                    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[var(--pm-text-primary)]" />
                  ) : null}
                </button>
              ))}
            </div>
            <div className="relative flex h-full items-center">
              <button
                ref={orderTypeTriggerRef}
                aria-controls="order-type-popover"
                aria-expanded={isOrderTypeMenuOpen}
                className="flex h-9 items-center gap-1 rounded-lg px-2 text-base font-medium capitalize text-[var(--pm-text-primary)] transition hover:bg-[var(--pm-surface-2)]"
                onClick={() => setIsOrderTypeMenuOpen((current) => !current)}
                type="button"
              >
                {orderType}
                <ChevronDown
                  className={`text-[var(--pm-text-secondary)] transition-transform ${
                    isOrderTypeMenuOpen ? "rotate-180" : ""
                  }`}
                  size={18}
                />
              </button>
              {isOrderTypeMenuOpen ? (
                <div
                  ref={orderTypePopoverRef}
                  className="absolute right-0 top-[38px] z-30 w-40 overflow-hidden rounded-xl border border-[var(--pm-border)] bg-[var(--pm-surface-1)] p-1.5 shadow-[0_14px_34px_rgba(0,0,0,0.22)]"
                  id="order-type-popover"
                >
                  {(["market", "limit"] as const).map((nextOrderType) => (
                    <button
                      ref={(node) => {
                        orderTypeOptionRefs.current[nextOrderType] = node;
                      }}
                      aria-pressed={orderType === nextOrderType}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-semibold capitalize transition ${
                        orderType === nextOrderType
                          ? "bg-[var(--pm-surface-2)] text-[var(--pm-text-primary)]"
                          : "text-[var(--pm-text-secondary)] hover:bg-[var(--pm-surface-2)] hover:text-[var(--pm-text-primary)]"
                      }`}
                      key={nextOrderType}
                      onClick={() => changeOrderType(nextOrderType)}
                      type="button"
                    >
                      {nextOrderType}
                      {orderType === nextOrderType ? (
                        <span className="text-[var(--pm-brand)]">✓</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col px-4 pb-4 pt-5">
            <div className="grid grid-cols-2 gap-3">
              <PressableOutcomeButton
                pressed={side === "yes"}
                tone="yes"
                variant="ticket"
                onClick={() => {
                  setSide("yes");
                  setQuote(null);
                  setTradeMessage(null);
                }}
              >
                <span className="block truncate">Yes {formatCents(yes?.price ?? null)}</span>
              </PressableOutcomeButton>
              <PressableOutcomeButton
                pressed={side === "no"}
                tone="no"
                variant="ticket"
                onClick={() => {
                  setSide("no");
                  setQuote(null);
                  setTradeMessage(null);
                }}
              >
                <span className="block truncate">No {formatCents(no?.price ?? null)}</span>
              </PressableOutcomeButton>
            </div>

            {orderType === "limit" ? (
              <label className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-[var(--pm-border)] bg-[var(--pm-surface-2)] px-3 py-2.5">
                <span className="text-sm font-semibold text-[var(--pm-text-primary)]">
                  Limit price
                </span>
                <span className="flex items-center gap-1 text-lg font-semibold text-[var(--pm-text-primary)]">
                  <input
                    aria-label="Limit price in cents"
                    className="w-14 bg-transparent text-right outline-none"
                    inputMode="decimal"
                    max="99"
                    min="1"
                    onChange={(event) => {
                      setLimitPrice(event.target.value.replace(/[^0-9.]/g, ""));
                      setTradeMessage(null);
                    }}
                    placeholder="50"
                    type="text"
                    value={limitPrice}
                  />
                  ¢
                </span>
              </label>
            ) : null}

            <div className="mt-5 flex min-h-[76px] items-center justify-between gap-3">
              <label className="min-w-0 flex-1" htmlFor="market-trade-amount">
                <span className="block text-[17px] font-medium text-[var(--pm-text-primary)]">
                  {action === "buy" ? "Amount" : "Shares"}
                </span>
              </label>
              <input
                aria-label={action === "buy" ? "Trade amount" : "Shares to sell"}
                className="min-w-0 w-[54%] bg-transparent text-right text-[46px] font-semibold leading-none tracking-[-0.04em] text-[var(--pm-text-tertiary)] outline-none placeholder:text-[var(--pm-text-tertiary)]"
                id="market-trade-amount"
                inputMode="decimal"
                onChange={(event) => updateTradeAmount(event.target.value)}
                placeholder={action === "buy" ? "0 Coins" : "0"}
                type="text"
                value={amount === "0" ? "" : amount}
              />
            </div>

            <div className="mt-0.5 flex justify-end gap-1.5">
              {action === "buy" ? (
                (["1", "5", "10", "100"] as const).map((value) => (
                  <button
                    className="h-[30px] rounded-[9px] bg-[var(--pm-surface-3)] px-2.5 text-xs font-semibold text-[var(--pm-text-secondary)] transition hover:text-[var(--pm-text-primary)]"
                    key={value}
                    onClick={() => addQuickTradeAmount(value)}
                    type="button"
                  >
                    +{value} Coins
                  </button>
                ))
              ) : (
                ([
                  ["25", 1n, 4n],
                  ["50", 1n, 2n],
                  ["75", 3n, 4n],
                ] as const).map(([label, numerator, denominator]) => (
                  <button
                    className="h-[30px] rounded-[9px] bg-[var(--pm-surface-3)] px-2.5 text-xs font-semibold text-[var(--pm-text-secondary)] transition hover:text-[var(--pm-text-primary)]"
                    key={label}
                    onClick={() => setSellSharePercent(numerator, denominator)}
                    type="button"
                  >
                    {label}%
                  </button>
                ))
              )}
              {action === "sell" ? (
                <button
                  className="h-[30px] rounded-[9px] bg-[var(--pm-surface-3)] px-2.5 text-xs font-semibold text-[var(--pm-text-secondary)] transition hover:text-[var(--pm-text-primary)]"
                  onClick={setMaximumTradeAmount}
                  type="button"
                >
                  Max
                </button>
              ) : null}
            </div>

            <div className="mt-4 min-h-[74px] rounded-xl bg-[var(--pm-surface-2)] px-3 py-2.5">
              {!isAuthenticated ? (
                <p className="text-sm font-medium leading-5 text-[var(--pm-text-secondary)]">
                  Log in to see your cash, quote, and potential return.
                </p>
              ) : BigInt(coinBalance?.availableCoinMicros ?? "0") <= 0n && action === "buy" ? (
                <p className="text-sm font-medium leading-5 text-[var(--pm-text-secondary)]">
                  Your Available Coins balance is empty. Deposit availability depends on the
                  supported money rail.
                </p>
              ) : quoteStatus === "loading" ? (
                <p className="text-sm font-medium text-[var(--pm-text-secondary)]">
                  Updating quote…
                </p>
              ) : quote ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <QuoteRow label="Avg. price" value={formatCents(quote.price)} />
                  <QuoteRow label="Shares" value={formatShares(quote.shares)} />
                  <QuoteRow
                    label={action === "buy" ? "Potential return" : "You receive"}
                    value={formatCoinMicros(
                      action === "buy"
                        ? quote.estimatedPayoutCoinMicros
                        : quote.estimatedProceedsCoinMicros,
                    )}
                  />
                  <QuoteRow label="Fee" value={formatCoinMicros(quote.feeCoinMicros)} />
                </div>
              ) : quoteStatus === "error" ? (
                <p className="text-sm font-medium leading-5 text-[var(--pm-red)]">
                  {quoteError ?? "Could not update quote."}
                </p>
              ) : (
                <div className="flex items-center justify-between gap-3 text-sm font-medium text-[var(--pm-text-secondary)]">
                  <span>Available Coins</span>
                  <strong className="text-[var(--pm-text-primary)]">
                    {formatCoinMicros(coinBalance?.availableCoinMicros ?? "0")}
                  </strong>
                </div>
              )}
            </div>

            <button
              className="mt-4 h-12 rounded-[12px] bg-[var(--pm-brand)] text-base font-semibold text-white shadow-[0_5px_0_#0879c8] transition hover:bg-[var(--pm-brand-hover)] active:translate-y-[2px] active:shadow-[0_3px_0_#0879c8] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                isAuthenticated &&
                (action === "buy" && !hasAvailableCoins
                  ? !depositEnabled
                  : isPlacingTrade ||
                    !hasValidAmount ||
                    !selectedPrice ||
                    !hasValidLimitPrice ||
                    quoteStatus === "loading")
              }
              onClick={() => void placeTrade()}
              type="button"
            >
              {!isAuthenticated
                ? "Log in to trade"
                : action === "buy" &&
                    BigInt(coinBalance?.availableCoinMicros ?? "0") <= 0n
                  ? depositEnabled
                    ? "Deposit"
                    : "Deposit unavailable"
                  : isPlacingTrade
                ? "Placing..."
                : action === "buy"
                  ? `${orderType === "limit" ? "Place limit · " : "Buy "}${sideLabel}`
                  : `${orderType === "limit" ? "Place limit · " : "Sell "}${sideLabel}`}
            </button>

            {tradeMessage ? (
              <div
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  tradeMessage.tone === "success"
                    ? "bg-[var(--pm-green-muted)] text-[var(--pm-green)]"
                    : tradeMessage.tone === "error"
                      ? "bg-[var(--pm-red-muted)] text-[var(--pm-red)]"
                      : "bg-[var(--pm-surface-2)] text-[var(--pm-text-secondary)]"
                }`}
              >
                {tradeMessage.text}
              </div>
            ) : null}
          </div>
        </div>

        <p className="mt-5 px-3 text-center text-sm font-medium leading-5 text-[var(--pm-text-secondary)]">
          By trading, you agree to the{" "}
          <a className="underline hover:text-[var(--pm-text-primary)]" href="#terms">
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

            {isTradingClosed ? (
              <div
                className="mb-4 mt-5 flex items-start gap-3 rounded-xl border border-[var(--pm-border)] bg-[var(--pm-surface-2)] px-4 py-3 text-sm font-medium text-[var(--pm-text-secondary)]"
                role="status"
              >
                <AlertCircle className="mt-0.5 shrink-0" size={18} />
                <span>
                  This market is closed and no longer accepts trades. Resolved outcomes are shown below.
                </span>
              </div>
            ) : null}

            <MarketChart
              endsAt={marketEndDate}
              outcomes={displayOutcomes}
              history={market.history}
              selectedOutcomeName={selectedVariantLabel}
            />

            <div
              className="clear-both mt-3 border-t border-[var(--pm-border)]"
              data-orientation="vertical"
            >
              {liveGroupMarkets.map((groupMarket) => {
                const isSelected = groupMarket.id === tradeMarket.id;
                const change = getGroupMarketPriceChange(market, groupMarket);
                const yesPrice = groupMarket.yes_price;
                const noPrice = groupMarket.no_price;
                const showGroupMarketImage = hasDistinctGroupMarketImage(market, groupMarket);

                return (
                  <div
                    className="[&+&]:border-t [&+&]:border-[var(--pm-border)]"
                    data-testid="market-detail-group-row"
                    data-orientation="vertical"
                    data-state="closed"
                    key={groupMarket.id}
                  >
                    <div
                      className="flex w-full flex-1 cursor-pointer items-center justify-between bg-[var(--pm-background)] text-base font-medium leading-none text-[var(--pm-text-primary)] transition-all duration-200"
                      data-orientation="vertical"
                      data-state="closed"
                    >
                      <div
                        className="group relative flex w-full flex-col gap-3 overflow-visible py-2.5 transition"
                        data-orientation="vertical"
                        data-state="closed"
                      >
                        <div
                          className={`pointer-events-none absolute -bottom-px -left-3 -right-3 -top-px rounded-[12px] border transition-colors ${
                            isSelected
                              ? "border-[var(--pm-border-strong)] bg-[var(--pm-surface-2)]"
                              : "border-transparent group-hover:bg-[var(--pm-surface-2)]"
                          }`}
                        />
                        <div className="z-[1] flex min-h-12 w-full flex-col gap-3 md:flex-row md:justify-between">
                          <button
                            aria-label={`Select ${formatMarketText(groupMarket.label)}`}
                            aria-pressed={isSelected}
                            className="z-[1] flex w-full min-w-0 flex-[4] items-center justify-between gap-4 rounded-[10px] text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--pm-brand)]/70 md:w-auto"
                            onClick={() => selectGroupedOutcome(groupMarket.id)}
                            type="button"
                          >
                            <span
                              className={`flex min-w-0 flex-[3] items-center ${
                                showGroupMarketImage ? "gap-4" : "gap-0"
                              }`}
                            >
                              {showGroupMarketImage ? (
                                <MarketImage
                                  market={groupMarket}
                                  className="!h-11 !w-11 !min-w-[44px] !rounded-[9px]"
                                />
                              ) : null}
                              <span className="flex min-w-0 flex-col gap-y-1">
                                <span className="block max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap">
                                  <span className="block max-w-[400px] overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-semibold leading-5 text-[var(--pm-text-primary)] min-[1024px]:max-[1050px]:max-w-[170px] min-[1050px]:max-[1080px]:max-w-[200px] min-[1080px]:max-[1140px]:max-w-[230px] min-[1140px]:max-[1220px]:max-w-[320px]">
                                    {formatMarketText(groupMarket.label)}
                                  </span>
                                </span>
                                <span className="flex min-h-5 items-center gap-1.5 text-[14px] leading-none text-[var(--pm-text-secondary)]">
                                  {formatMoney(groupMarket.volume)} Volume
                                </span>
                              </span>
                            </span>
                            <span className="relative z-10 flex min-w-[104px] flex-1 items-center justify-end pr-1 md:justify-center md:pr-0">
                              <span className="relative flex items-center">
                                <span className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-[var(--pm-text-primary)]">
                                {formatPercent(groupMarket.yes_price)}
                                </span>
                              {change !== null && change !== 0 ? (
                                <span
                                  className={`absolute left-[calc(100%+0.325rem)] top-1/2 hidden -translate-y-1/2 items-center min-[1120px]:flex ${
                                    change > 0 ? "text-[#30a159]" : "text-[#e23939]"
                                  }`}
                                >
                                  <span
                                    className={`mr-1 h-0 w-0 border-x-[5px] border-x-transparent ${
                                      change > 0
                                        ? "border-b-[8px] border-b-current"
                                        : "border-t-[8px] border-t-current"
                                    }`}
                                    aria-hidden="true"
                                  />
                                  <span className="text-xs font-semibold leading-none">
                                    {formatPercent(Math.abs(change))}
                                  </span>
                                </span>
                              ) : null}
                              </span>
                            </span>
                          </button>

                          <div className="z-[1] grid min-w-0 grid-cols-2 gap-2 md:flex md:flex-[3] md:items-center md:justify-end">
                            <PressableOutcomeButton
                              aria-label={`Select Yes for ${formatMarketText(groupMarket.label)} at ${formatCents(yesPrice)}`}
                              pressed={isSelected && side === "yes"}
                              tone="yes"
                              variant="list"
                              onClick={() => selectGroupedOutcome(groupMarket.id, "yes")}
                            >
                              <span className="flex min-w-0 items-center gap-1">
                                <span className="min-w-0 truncate opacity-90">
                                  Yes
                                </span>
                                <span className="shrink-0 text-base">{formatCents(yesPrice)}</span>
                              </span>
                            </PressableOutcomeButton>
                            <PressableOutcomeButton
                              aria-label={`Select No for ${formatMarketText(groupMarket.label)} at ${formatCents(noPrice)}`}
                              pressed={isSelected && side === "no"}
                              tone="no"
                              variant="list"
                              onClick={() => selectGroupedOutcome(groupMarket.id, "no")}
                            >
                              <span className="flex min-w-0 items-center gap-1">
                                <span className="min-w-0 truncate opacity-90">
                                  No
                                </span>
                                <span className="shrink-0 text-base">{formatCents(noPrice)}</span>
                              </span>
                            </PressableOutcomeButton>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {resolvedGroupMarkets.length > 0 ? (
              <>
                <button
                  aria-controls="resolved-group-markets"
                  aria-expanded={showResolvedGroups}
                  className="mb-2 mt-3 flex h-9 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-[var(--pm-text-secondary)] outline-none transition hover:text-[var(--pm-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--pm-brand)]/60"
                  onClick={() => setShowResolvedGroups((current) => !current)}
                  type="button"
                >
                  {showResolvedGroups ? "Hide resolved" : "View resolved"}
                  <ChevronDown
                    className={`transition-transform ${showResolvedGroups ? "rotate-180" : ""}`}
                    size={17}
                  />
                </button>

                {showResolvedGroups ? (
                  <div
                    className="mb-5 border-t border-[var(--pm-border)]"
                    id="resolved-group-markets"
                  >
                    {resolvedGroupMarkets.map((groupMarket) => {
                      const resolvedOutcome = getResolvedGroupMarketOutcome(groupMarket);
                      const isYes = resolvedOutcome?.toLowerCase() === "yes";

                      return (
                        <div
                          className="flex min-h-[74px] items-center justify-between gap-4 border-b border-[var(--pm-border)] py-3"
                          data-testid="market-detail-resolved-group-row"
                          key={groupMarket.id}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[17px] font-semibold leading-5 text-[var(--pm-text-primary)]">
                              {formatMarketText(groupMarket.label)}
                            </div>
                            <div className="mt-1 text-[14px] text-[var(--pm-text-secondary)]">
                              {formatMoney(groupMarket.volume)} Volume
                            </div>
                          </div>

                          {resolvedOutcome ? (
                            <div
                              className={`flex shrink-0 items-center gap-2 text-[17px] font-medium ${
                                isYes ? "text-[#30a159]" : "text-[var(--pm-text-primary)]"
                              }`}
                            >
                              {formatMarketText(resolvedOutcome)}
                              <span
                                aria-hidden="true"
                                className={`grid h-5 w-5 place-items-center rounded-full text-sm font-bold leading-none text-white ${
                                  isYes ? "bg-[#30a159]" : "bg-[#e23939]"
                                }`}
                              >
                                {isYes ? "✓" : "×"}
                              </span>
                            </div>
                          ) : (
                            <div className="shrink-0 text-[15px] font-medium text-[var(--pm-text-secondary)]">
                              Closed
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : null}

            <MarketInfoTabs
              activeTab={detailTab}
              market={market}
              onTabChange={setDetailTab}
            />

            <MarketActivityTabs
              activeTab={activityTab}
              activityMarketLabels={activityMarketLabels}
              canComment={canComment}
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
            {isTradingClosed ? (
              <div className="rounded-[16px] border border-[var(--pm-border)] bg-[var(--pm-surface-1)] p-5">
                <div className="text-lg font-semibold text-[var(--pm-text-primary)]">Market closed</div>
                <p className="mt-2 text-sm leading-6 text-[var(--pm-text-secondary)]">
                  Trading is unavailable because this event has already ended.
                </p>
              </div>
            ) : (
              renderTradeTicket()
            )}
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
              const showGroupMarketImage = hasDistinctGroupMarketImage(market, groupMarket);

              return (
                <div
                  className="market-detail-outcome-row grid min-w-0 gap-3 py-4 transition md:grid-cols-[minmax(0,1fr)_110px_220px] md:items-center"
                  key={groupMarket.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {showGroupMarketImage ? (
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
                    <span className="min-w-0 rounded-[7.2px] bg-[#30a159]/12 px-3 py-3 text-sm font-semibold text-[#30a159]">
                      <span className="block truncate">
                        Yes{" "}
                        {formatCents(groupMarket.yes_price)}
                      </span>
                    </span>
                    <span className="min-w-0 rounded-[7.2px] bg-[#e23939]/10 px-3 py-3 text-sm font-semibold text-[#e23939]">
                      <span className="block truncate">
                        No{" "}
                        {formatCents(groupMarket.no_price)}
                      </span>
                    </span>
                  </div>
                </div>
              );
            }) : displayOutcomes.map((outcome, index) => {
              const price = outcome.price ?? outcome.probability ?? null;

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
                  <span className="min-w-0 rounded-2xl bg-[#30a159]/12 px-4 py-3 text-sm font-semibold text-[#30a159]">
                    <span className="block truncate">
                      {formatCents(price)}
                    </span>
                  </span>
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
            canComment={canComment}
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
          {isTradingClosed ? (
            <div className="rounded-[16px] border border-[var(--pm-border)] bg-[var(--pm-surface-1)] p-5">
              <div className="text-lg font-semibold text-[var(--pm-text-primary)]">Market closed</div>
              <p className="mt-2 text-sm leading-6 text-[var(--pm-text-secondary)]">
                Trading is unavailable because this event has already ended.
              </p>
            </div>
          ) : (
            renderTradeTicket()
          )}
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
  canComment,
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
  canComment: boolean;
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
  const wrapperClass = framed ? `${panel} mt-6 p-5` : "mt-8";
  const activityTrades = data.activity.filter(
    (item): item is MarketTradeActivityItem => item.type === "trade",
  );
  const tabs: Array<{ id: ActivityTab; label: string }> = [
    {
      id: "comments",
      label: data.comments.length > 0 ? `Comments (${data.comments.length})` : "Comments",
    },
    { id: "holders", label: "Top Holders" },
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

      {activeTab === "activity" ? (
        <div className="mb-2 mt-8 flex justify-end">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[#e23939]">
            <span className="relative flex h-2.5 w-2.5 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e23939] opacity-85 [animation-duration:1.2s]" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#e23939]" />
            </span>
            Online
          </div>
        </div>
      ) : null}

      <div className={activeTab === "activity" || activeTab === "comments" ? "mt-0" : "mt-5"}>
        {isLoading ? (
          <MarketActivitySkeleton rows={activeTab === "comments" ? 3 : 4} />
        ) : null}

        {!isLoading && activeTab === "comments" ? (
          <CommentsBoard
            canComment={canComment}
            commentText={commentText}
            comments={data.comments}
            isPostingComment={isPostingComment}
            onCommentTextChange={onCommentTextChange}
            onPostComment={onPostComment}
          />
        ) : null}

        {!isLoading && activeTab === "holders" ? (
          <HoldersBoard holders={data.topHolders} market={market} />
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

function CommentsBoard({
  canComment,
  commentText,
  comments,
  isPostingComment,
  onCommentTextChange,
  onPostComment,
}: {
  canComment: boolean;
  commentText: string;
  comments: MarketComment[];
  isPostingComment: boolean;
  onCommentTextChange: (value: string) => void;
  onPostComment: () => void | Promise<void>;
}) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canComment || !commentText.trim() || isPostingComment) {
      return;
    }

    void onPostComment();
  }

  return (
    <div className="pt-2 lg:pb-4 lg:pt-4">
      <div className="w-full">
        <div id="commentsInner" className="flex w-full flex-col">
          <section data-nosnippet="true">
            <div className="flex items-center pb-4">
              <form className="relative flex w-full flex-col rounded-xl border border-[var(--pm-border)]" onSubmit={handleSubmit}>
                <div className="relative flex items-end">
                  <textarea
                    aria-label="Add a comment"
                    className="h-12 max-h-52 min-h-[48px] w-full resize-none rounded-xl border-none bg-transparent px-3.5 py-3.5 pr-24 text-[14px] leading-5 text-[var(--pm-text-primary)] shadow-none outline-none transition placeholder:text-[var(--pm-text-secondary)] focus:outline-none"
                    disabled={!canComment || isPostingComment}
                    onChange={(event) => onCommentTextChange(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                        event.preventDefault();
                        if (canComment && commentText.trim() && !isPostingComment) {
                          void onPostComment();
                        }
                      }
                    }}
                    placeholder={canComment ? "Add a comment..." : "Sign in to leave a comment."}
                    value={commentText}
                  />
                  <div className="absolute bottom-2 right-2 flex items-center gap-1">
                    <button
                      className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[var(--pm-accent)] px-3.5 text-sm font-semibold text-white transition duration-150 hover:bg-[#7fa1ff] disabled:pointer-events-none disabled:opacity-50"
                      disabled={!canComment || !commentText.trim() || isPostingComment}
                      type="submit"
                    >
                      {isPostingComment ? "Posting" : "Post"}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex gap-4">
                <button
                  aria-label="Sort comments by"
                  aria-expanded="false"
                  aria-haspopup="menu"
                  className="group flex cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-sm font-medium text-[var(--pm-text-primary)] focus-visible:outline-none focus-visible:ring-0"
                  data-state="closed"
                  type="button"
                >
                  <span>Newest</span>
                  <ChevronDown className="transition-transform duration-200 group-data-[state=open]:rotate-180" size={12} />
                </button>
              </div>
            </div>

            <div>
              {comments.length > 0 ? (
                comments.map((comment) => <CommentRow comment={comment} key={comment.id} />)
              ) : (
                <EmptyActivityState plain text="No comments yet." />
              )}
            </div>

          </section>
        </div>
      </div>
    </div>
  );
}

function CommentRow({ comment }: { comment: MarketComment }) {
  const likes = getCommentLikeCount(comment);

  return (
    <article className="comment flex pt-6" id={`comment-${comment.id}`}>
      <div className="flex w-full">
        <CommentAvatar label={comment.displayName} seed={`${comment.userId ?? comment.id}:${comment.displayName}`} />
        <div className="ml-3.5 flex w-[calc(100%-58px)] flex-col whitespace-normal">
          <div className="relative flex w-full items-center justify-between gap-3">
            <div className="flex items-baseline gap-1 overflow-hidden text-ellipsis whitespace-nowrap pr-8">
              <div className="flex items-baseline gap-2">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold text-[var(--pm-text-primary)] hover:underline" title={comment.displayName}>
                  {comment.displayName}
                </span>
                {comment.positionLabel ? <CommentPositionBadge label={comment.positionLabel} /> : null}
              </div>
              <time className="ml-1.5 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-[var(--pm-text-secondary)]" dateTime={comment.createdAt}>
                {formatActivityRelativeTime(comment.createdAt)}
              </time>
            </div>
            <div className="absolute right-0 top-0 flex">
              <button
                aria-label="Comment actions"
                aria-expanded="false"
                aria-haspopup="menu"
                className="flex size-6 min-w-6 cursor-pointer items-center justify-center rounded-sm bg-transparent text-[var(--pm-text-secondary)] outline-none transition-none hover:bg-[var(--pm-surface-2)] active:bg-[var(--pm-surface-2)]"
                data-state="closed"
                type="button"
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          </div>

          <div className="comment-body flex flex-col">
            <div className="mb-2 mt-1 max-w-full text-base font-normal text-[var(--pm-text-primary)]">
              <div className="whitespace-pre-wrap break-words overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:4]">
                {comment.body}
              </div>
            </div>
          </div>

          <div className="-ml-1.5 flex items-center gap-1.5">
            <button className="inline-flex h-6 w-fit cursor-pointer items-center justify-center gap-1 rounded-sm py-1 pl-1 pr-1.5 text-base font-semibold text-[var(--pm-text-secondary)] transition duration-150 hover:bg-[var(--pm-surface-2)] active:scale-[97%]" type="button">
              <Heart size={18} />
              <span className="text-xs text-[var(--pm-text-secondary)]">{likes}</span>
            </button>
            <button className="inline-flex h-6 w-fit cursor-pointer items-center justify-center gap-1 rounded-sm py-1 pl-1.5 pr-1.5 text-base font-semibold text-[var(--pm-text-secondary)] transition duration-150 hover:bg-[var(--pm-surface-2)] active:scale-[97%]" type="button">
              <MessageCircle size={12} />
              <span className="text-xs">Reply</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function CommentAvatar({ label, seed }: { label: string; seed: string }) {
  const palette = getActivityAvatarPalette(seed);

  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 min-w-10 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-black uppercase text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      title={label}
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

function CommentPositionBadge({ label }: { label: string }) {
  const formattedLabel = formatCommentPositionLabel(label);
  const isNo = /\bno\b/i.test(formattedLabel);
  const toneClass = isNo
    ? "bg-red-500/10 text-[#e23939] hover:bg-red-500/20"
    : "bg-green-600/10 text-[#30a159] hover:bg-green-600/20";

  return (
    <span className={`inline-flex h-[22px] items-center rounded-sm px-1.5 text-xs font-semibold ${toneClass}`}>
      {formattedLabel}
    </span>
  );
}

function HoldersBoard({ holders, market }: { holders: MarketHolder[]; market: Market }) {
  const yesHolders = holders
    .filter((holder) => isPositiveDecimal(holder.yesShares))
    .sort(
      (left, right) =>
        compareDecimalValues(right.yesShares, left.yesShares, 6) ?? 0,
    )
    .slice(0, 16);
  const noHolders = holders
    .filter((holder) => isPositiveDecimal(holder.noShares))
    .sort(
      (left, right) =>
        compareDecimalValues(right.noShares, left.noShares, 6) ?? 0,
    )
    .slice(0, 16);

  return (
    <div className="max-lg:min-h-[400px] max-lg:pt-2 lg:min-h-[496px] lg:pb-16 lg:pt-4">
      <div className="w-full">
        <div className="flex w-full flex-col">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MarketDropdownButton
                ariaLabel="Sort markets by"
                className="w-full justify-between md:w-[250px]"
                label={getMarketFilterLabel(market)}
              />
            </div>
          </div>

          <div className="flex min-w-0">
            <HolderColumn holders={yesHolders} side="yes" title="Yes holders" />
            <HolderColumn holders={noHolders} side="no" title="No holders" />
          </div>
        </div>
      </div>
    </div>
  );
}

function HolderColumn({
  holders,
  side,
  title,
}: {
  holders: MarketHolder[];
  side: "yes" | "no";
  title: string;
}) {
  const valueClass = side === "yes" ? "text-[#30a159]" : "text-[#e23939]";

  return (
    <div className={`flex min-w-0 w-1/2 flex-col ${side === "yes" ? "pr-2 lg:pr-5" : "pl-2 lg:pl-5"}`}>
      <div className="flex h-[44px] min-w-0 items-center justify-between border-b border-[var(--pm-border)]">
        <span className="truncate text-base font-semibold text-[var(--pm-text-primary)]">{title}</span>
        <span className="hidden text-[10px] font-medium uppercase tracking-wider text-[var(--pm-text-secondary)] lg:block">
          Shares
        </span>
      </div>
      <div className="flex flex-col">
        {holders.length > 0 ? (
          holders.map((holder) => (
            <HolderRow
              holder={holder}
              key={`${side}-${holder.id}`}
              shares={side === "yes" ? holder.yesShares : holder.noShares}
              valueClass={valueClass}
            />
          ))
        ) : (
          <div className="border-b border-[var(--pm-border)] py-4 text-sm font-medium text-[var(--pm-text-secondary)]">
            No holders yet.
          </div>
        )}
      </div>
    </div>
  );
}

function MarketDropdownButton({
  ariaLabel,
  className = "",
  label,
}: {
  ariaLabel?: string;
  className?: string;
  label: string;
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-expanded="false"
      aria-haspopup="menu"
      className={`group flex h-10 cursor-pointer items-center gap-1 rounded-md border border-[var(--pm-border)] px-4 text-base font-semibold text-[var(--pm-text-primary)] transition duration-150 hover:bg-[var(--pm-surface-2)] active:scale-[97%] focus-visible:outline-none focus-visible:ring-0 ${className}`}
      data-slot="dropdown-menu-trigger"
      data-state="closed"
      type="button"
    >
      <span className="truncate font-medium">{label}</span>
      <ChevronDown className="shrink-0 transition-transform duration-200" size={12} />
    </button>
  );
}

function HolderRow({
  holder,
  shares,
  valueClass,
}: {
  holder: MarketHolder;
  shares: string;
  valueClass: string;
}) {
  return (
    <div className="flex min-h-[44px] w-full min-w-0 border-b border-[var(--pm-border)] max-lg:py-2 lg:h-[44px] lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap text-ellipsis">
        <ActivityAvatar seed={`${holder.userId}:${holder.displayName}`} label={holder.displayName} />
        <div className="ml-4 flex min-w-0 items-center gap-1 overflow-hidden">
          <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-base font-medium text-[var(--pm-text-primary)]">
            {truncateActivityName(holder.displayName)}
          </span>
        </div>
      </div>
      <span className={`relative inline-flex shrink-0 overflow-hidden whitespace-nowrap text-right text-base font-semibold ${valueClass}`}>
        {formatHolderShares(shares)}
      </span>
    </div>
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
          <span className="text-[var(--pm-text-secondary)]">
            ({formatCoinMicros(item.amountCoinMicros)})
          </span>
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

function formatCommentPositionLabel(value: string) {
  return value
    .replace(/\bда\b/gi, "Yes")
    .replace(/\bнет\b/gi, "No")
    .replace(/\byes\b/gi, "Yes")
    .replace(/\bno\b/gi, "No");
}

function getCommentLikeCount(comment: MarketComment) {
  let hash = 0;
  const source = `${comment.id}:${comment.createdAt}`;

  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }

  return hash % 3;
}

function formatActivityShares(value: string) {
  return formatShares(value);
}

function formatHolderShares(value: string) {
  return formatShares(value);
}

function formatActivityCents(value: string) {
  return formatCents(value);
}

function getMarketFilterLabel(market: Market) {
  const groupMarket = market as Market & { label?: string };

  return formatMarketText(
    groupMarket.label ||
      market.groupItemTitle ||
      market.event_title ||
      market.title ||
      "This market",
  );
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

function EmptyActivityState({ plain = false, text }: { plain?: boolean; text: string }) {
  return (
    <div
      className={
        plain
          ? "py-4 text-sm font-semibold text-[#77808d]"
          : "rounded-xl border border-dashed border-[#dfe3e7] bg-white p-4 text-sm font-semibold text-[#77808d]"
      }
    >
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
              <p className="py-4 text-sm font-semibold text-[#7b8996]">
                No comments yet.
              </p>
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
                      {formatCoinMicros(trade.amountCoinMicros)} @ {formatPercent(trade.price)}
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
  const userShares =
    addDecimalValues(
      currentPosition?.yesShares ?? "0",
      currentPosition?.noShares ?? "0",
    ) ?? "0";

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

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <span className="text-[var(--pm-text-secondary)]">{label}</span>
      <strong className="text-right font-semibold text-[var(--pm-text-primary)]">{value}</strong>
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

function PressableOutcomeButton({
  "aria-label": ariaLabel,
  children,
  onClick,
  pressed,
  tone,
  variant,
}: {
  "aria-label"?: string;
  children: React.ReactNode;
  onClick: () => void;
  pressed: boolean;
  tone: "yes" | "no";
  variant: "list" | "ticket";
}) {
  const isYes = tone === "yes";
  const radius = variant === "ticket" ? "rounded-[12px]" : "rounded-[10px]";
  const baseColor = isYes ? "bg-[#237b43]" : "bg-[#982525]";
  const selectedSurface = isYes
    ? "border-[#30a159] bg-[#30a159] text-white"
    : "border-[#e23939] bg-[#e23939] text-white";
  const idleSurface =
    variant === "ticket"
      ? "border-transparent bg-[var(--pm-surface-3)] text-[var(--pm-text-secondary)] group-hover:text-[var(--pm-text-primary)]"
      : isYes
        ? "border-[#30a159]/20 bg-[#30a159]/15 text-[#30a159] group-hover:border-[#30a159]/45 group-hover:bg-[#30a159]/22"
        : "border-[#e23939]/20 bg-[#e23939]/10 text-[#e23939] group-hover:border-[#e23939]/45 group-hover:bg-[#e23939]/16";

  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className={`group relative isolate h-12 w-full min-w-0 overflow-visible bg-transparent text-base font-semibold outline-none focus-visible:ring-2 ${
        isYes
          ? "focus-visible:ring-[#30a159]/45"
          : "focus-visible:ring-[#e23939]/45"
      } ${radius} ${variant === "list" ? "md:w-[140px]" : ""}`}
      onClick={onClick}
      type="button"
    >
      {pressed ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-[3px] z-0 h-12 ${radius} ${baseColor}`}
        />
      ) : null}
      <span
        className={`pointer-events-none absolute inset-0 z-[1] flex items-center justify-center border px-3 py-2 transition-[transform,background-color,border-color,color] duration-100 ${
          pressed ? `${selectedSurface} group-active:translate-y-[3px]` : idleSurface
        } ${radius}`}
      >
        {children}
      </span>
    </button>
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

function getResolvedGroupMarketOutcome(groupMarket: GroupMarket) {
  if (isLiveGroupMarket(groupMarket)) {
    return null;
  }

  return (
    groupMarket.outcomes.find((outcome) => (outcome.price ?? outcome.probability ?? 0) >= 0.999)
      ?.name ?? null
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
  const isClosed =
    market.closed ||
    market.archived ||
    market.status === "closed" ||
    market.status === "expired" ||
    (groupMarkets.length > 0 && groupMarkets.every((groupMarket) => !isLiveGroupMarket(groupMarket)));

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
      question: isClosed ? `Can I still trade on "${title}"?` : `How do I trade on "${title}"?`,
      answer: isClosed
        ? [
            `No. "${title}" is closed and no longer accepts orders. The outcomes shown on this page are final resolution results, not tradable prices.`,
          ]
        : [
            `To trade on "${title}", browse the ${outcomeCount} available outcome${outcomeCount === 1 ? "" : "s"} listed on this page. Each outcome displays a current price representing the market's implied probability.`,
            "Select the outcome you believe is most likely, choose Yes to trade in favor of it or No to trade against it, enter your amount, and place the order. If your chosen outcome is correct when the market resolves, Yes shares pay out $1 each; if it is incorrect, they pay out $0.",
          ],
    },
    {
      id: "odds",
      question: isClosed ? `What was the result of "${title}"?` : `What are the current odds for "${title}"?`,
      answer: isClosed && leadingOutcome
        ? [`The market is resolved. "${leadingOutcome.label}" is the final winning outcome.`]
        : [buildCurrentOddsAnswer(title, outcomes)],
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
