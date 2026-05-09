import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  History,
  ImageOff,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { resetPortfolioApi } from "../lib/api";
import {
  formatCents,
  formatRelativeTime,
  formatShares,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
} from "../lib/format";
import {
  getAveragePositionPrice,
  getPositionMarket,
  getPositionShares,
} from "../lib/market";
import type { Market } from "../lib/types";
import { usePortfolio } from "../hooks/usePortfolio";
import { MarketImage } from "./MarketMedia";

const panel = "rounded-[14px] border border-[#293440] bg-[#171d24]";
const muted = "text-sm font-semibold text-[#8f9aa8]";

export function PortfolioPage({
  markets,
  marketsStatus,
  onBack,
  onOpenMarketId,
}: {
  markets: Market[];
  marketsStatus: "loading" | "ready" | "error";
  onBack: () => void;
  onOpenMarketId: (marketId: string) => void;
}) {
  const [portfolio, setPortfolio, , portfolioState] = usePortfolio();
  const [isResetting, setIsResetting] = React.useState(false);
  const [message, setMessage] = React.useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const summary = portfolio.summary;

  async function resetPortfolio() {
    if (!window.confirm("Reset your portfolio to 10,000 USDT and clear trade history?")) {
      return;
    }

    setIsResetting(true);
    setMessage(null);
    try {
      setPortfolio(await resetPortfolioApi());
      setMessage({ tone: "success", text: "Portfolio reset to 10,000 USDT." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not reset portfolio.",
      });
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1500px] overflow-x-hidden px-4 py-8 md:px-6 xl:px-8">
      <div className="grid gap-6">
        <button
          className="flex w-fit items-center gap-2 rounded-lg border border-[#293440] px-4 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
          All markets
        </button>

        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#3b91f6]">
              Account
            </span>
            <h1 className="mt-2 text-4xl font-semibold tracking-normal text-[#edf1f5]">
              Portfolio
            </h1>
            <p className="mt-2 max-w-2xl text-base font-medium text-[#8f9aa8]">
              Balance, open positions, performance, and trade history.
            </p>
          </div>
          <button
            className="rounded-lg border border-[#293440] px-4 py-3 text-sm font-semibold text-[#edf1f5] transition hover:border-[#d34c45]/60 hover:text-red-300 disabled:opacity-50"
            onClick={resetPortfolio}
            disabled={isResetting}
          >
            {isResetting ? "Resetting..." : "Reset portfolio"}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        {portfolioState.status === "loading" ? (
          <InlineState tone="info" text="Loading portfolio..." />
        ) : null}
        {portfolioState.status === "error" ? (
          <InlineState
            tone="error"
            text={portfolioState.error ?? "Could not load portfolio."}
          />
        ) : null}
        {marketsStatus === "error" ? (
          <InlineState
            tone="error"
            text="Live market prices are unavailable, so portfolio values use the last known prices."
          />
        ) : null}
        {message ? <InlineState tone={message.tone} text={message.text} /> : null}
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PortfolioMetric label="Equity" value={formatUsdt(summary.equity)} />
        <PortfolioMetric label="Cash balance" value={formatUsdt(summary.cash)} />
        <PortfolioMetric label="Positions value" value={formatUsdt(summary.positionValue)} />
        <PortfolioMetric
          label="PnL"
          value={`${formatSignedUsdt(summary.pnl)} (${formatSignedPercent(summary.pnlPercent)})`}
          tone={summary.pnl >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
        <section className={`${panel} p-5`}>
          <PanelHead
            title="Open positions"
            subtitle={`${summary.openPositions} active markets`}
            icon={<Wallet size={22} />}
          />

          {portfolioState.status === "loading" ? (
            <PortfolioSkeleton />
          ) : portfolio.positions.length === 0 ? (
            <EmptyState title="No open positions yet." text="Place a trade from any market to see it here." />
          ) : (
            <div className="mt-4 grid gap-3">
              {portfolio.positions.map((position) => {
                const market = getPositionMarket(position, markets);
                const positionValue = position.currentValue;
                const pnl = position.pnl;
                const shares = getPositionShares(position);

                return (
                  <article
                    className="grid min-w-0 gap-4 rounded-lg border border-[#293440] bg-[#0f1318] p-4 md:grid-cols-[minmax(0,1fr)_110px_130px_120px_auto] md:items-center"
                    key={position.marketId}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {market ? (
                        <MarketImage market={market} />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-[#1d252e] text-[#8f9aa8]">
                          <ImageOff size={20} />
                        </span>
                      )}
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-[#edf1f5]">
                          {position.marketTitle}
                        </strong>
                        <span className="text-sm font-medium text-[#8f9aa8]">
                          {formatShares(shares)} shares · avg{" "}
                          {formatCents(getAveragePositionPrice(position))}
                        </span>
                      </div>
                    </div>
                    <PositionStat label="Yes / No" value={`${formatShares(position.yesShares)} / ${formatShares(position.noShares)}`} />
                    <PositionStat label="Value" value={formatUsdt(positionValue)} />
                    <PositionStat
                      label="PnL"
                      value={formatSignedUsdt(pnl)}
                      tone={pnl >= 0 ? "positive" : "negative"}
                    />
                    <button
                      className="rounded-lg bg-[#1d252e] px-4 py-2 text-sm font-semibold text-[#edf1f5] transition hover:bg-[#293440]"
                      onClick={() => onOpenMarketId(position.marketId)}
                    >
                      Open
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className={`${panel} h-fit p-5`}>
          <PanelHead
            title="Account"
            subtitle={marketsStatus === "ready" ? "Live market prices" : "Loading prices"}
            icon={<TrendingUp size={22} />}
          />
          <div className="mt-4 grid gap-4">
            <PositionStat label="Invested" value={formatUsdt(summary.invested)} />
            <PositionStat label="Available" value={formatUsdt(summary.cash)} />
            <PositionStat label="Total trades" value={String(portfolio.trades.length)} />
          </div>
        </aside>
      </div>

      <section className={`${panel} mt-6 p-5`}>
        <PanelHead
          title="Trade history"
          subtitle="Your latest buys and sells"
          icon={<History size={22} />}
        />

        {portfolioState.status === "loading" ? (
          <PortfolioSkeleton />
        ) : portfolio.trades.length === 0 ? (
          <EmptyState title="No trades yet." text="Your buys and sells will appear here immediately after trading." />
        ) : (
          <div className="mt-4 grid gap-3">
            {portfolio.trades.map((trade) => (
              <article
                className="grid min-w-0 gap-4 rounded-lg border border-[#293440] bg-[#0f1318] p-4 md:grid-cols-[minmax(0,1fr)_130px_120px_90px_90px] md:items-center"
                key={trade.id}
              >
                <div className="min-w-0">
                  <strong className="block text-sm font-semibold text-[#edf1f5]">
                    {trade.action === "sell" ? "Sell" : "Buy"}{" "}
                    {trade.side === "yes" ? "Yes" : "No"}
                  </strong>
                  <span className="block truncate text-sm font-medium text-[#8f9aa8]">
                    {trade.marketTitle}
                  </span>
                </div>
                <PositionStat
                  label={trade.action === "sell" ? "Proceeds" : "Amount"}
                  value={formatUsdt(trade.amount)}
                />
                <PositionStat label="Shares" value={formatShares(trade.shares)} />
                <PositionStat label="Price" value={formatCents(trade.price)} />
                <time className="text-sm font-semibold text-[#8f9aa8]">
                  {formatRelativeTime(trade.createdAt)}
                </time>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function InlineState({ tone, text }: { tone: "success" | "error" | "info"; text: string }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm font-semibold ${
        tone === "success"
          ? "bg-green-500/10 text-green-200"
          : tone === "error"
            ? "bg-red-500/10 text-red-200"
            : "bg-[#171d24] text-[#8f9aa8]"
      }`}
    >
      {tone === "success" ? (
        <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
      ) : tone === "error" ? (
        <AlertCircle className="mt-0.5 shrink-0" size={17} />
      ) : null}
      <span>{text}</span>
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="mt-4 grid gap-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          className="h-24 animate-pulse rounded-lg border border-[#293440] bg-[#0f1318]"
          key={index}
        />
      ))}
    </div>
  );
}

function PortfolioMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className={`${panel} p-5`}>
      <span className={muted}>{label}</span>
      <strong
        className={`mt-3 block text-2xl font-semibold ${
          tone === "positive"
            ? "text-green-400"
            : tone === "negative"
              ? "text-red-400"
              : "text-[#edf1f5]"
        }`}
      >
        {value}
      </strong>
    </div>
  );
}

function PanelHead({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-[#edf1f5]">{title}</h2>
        <span className={muted}>{subtitle}</span>
      </div>
      <div className="text-[#8f9aa8]">{icon}</div>
    </div>
  );
}

function PositionStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div>
      <span className="block text-xs font-bold uppercase tracking-wide text-[#8f9aa8]">
        {label}
      </span>
      <strong
        className={`mt-1 block text-sm font-semibold ${
          tone === "positive"
            ? "text-green-400"
            : tone === "negative"
              ? "text-red-400"
              : "text-[#edf1f5]"
        }`}
      >
        {value}
      </strong>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-[#293440] bg-[#0f1318] p-8 text-center">
      <strong className="block text-base font-semibold text-[#edf1f5]">{title}</strong>
      <span className="mt-2 block text-sm font-medium text-[#8f9aa8]">{text}</span>
    </div>
  );
}
