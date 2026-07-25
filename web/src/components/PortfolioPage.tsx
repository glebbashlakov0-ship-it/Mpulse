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
import {
  formatCents,
  formatCoinMicros,
  formatRelativeTime,
  formatShares,
  formatSignedCoinMicros,
  formatSignedPercent,
} from "../lib/format";
import {
  getAveragePositionPrice,
  getPositionMarket,
  getPositionShares,
} from "../lib/market";
import type { Market } from "../lib/types";
import { usePortfolio } from "../hooks/usePortfolio";
import { MarketImage } from "./MarketMedia";

const panel = "rounded-3xl border border-[#242b32] bg-[#1e2428]";
const muted = "text-sm font-semibold text-[#7b8996]";

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
  const [portfolio, , , portfolioState] = usePortfolio();
  const summary = portfolio.summary;

  return (
    <section className="mx-auto w-full max-w-[1500px] overflow-x-hidden px-4 py-8 md:px-6 xl:px-8">
      <div className="grid gap-6">
        <button
          className="flex w-fit items-center gap-2 rounded-2xl border border-[#242b32] px-4 py-2 text-sm font-semibold text-[#7b8996] transition hover:border-[#0093fd]/50 hover:text-[#dee3e7]"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
          All markets
        </button>

        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#0093fd]">
              Account
            </span>
            <h1 className="mt-2 text-4xl font-semibold tracking-normal text-[#dee3e7]">
              Portfolio
            </h1>
            <p className="mt-2 max-w-2xl text-base font-medium text-[#7b8996]">
              Balance, open positions, performance, and trade history.
            </p>
          </div>
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
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PortfolioMetric label="Equity" value={formatCoinMicros(summary.equityCoinMicros)} />
        <PortfolioMetric
          label="Available Coins"
          value={formatCoinMicros(summary.availableCoinMicros)}
        />
        <PortfolioMetric
          label="Positions value"
          value={formatCoinMicros(summary.positionValueCoinMicros)}
        />
        <PortfolioMetric
          label="Total PnL"
          value={`${formatSignedCoinMicros(summary.pnlCoinMicros)} (${formatSignedPercent(summary.pnlPercent ?? "0")})`}
          tone={BigInt(summary.pnlCoinMicros) >= 0n ? "positive" : "negative"}
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
                const positionValue = position.currentValueCoinMicros;
                const pnl = position.pnlCoinMicros;
                const shares = getPositionShares(position);

                return (
                  <article
                    className="grid min-w-0 gap-4 rounded-2xl border border-[#242b32] bg-[#15191d] p-4 md:grid-cols-[minmax(0,1fr)_110px_130px_120px_auto] md:items-center"
                    key={position.marketId}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {market ? (
                        <MarketImage market={market} />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#2e3841] text-[#7b8996]">
                          <ImageOff size={20} />
                        </span>
                      )}
                      <div className="min-w-0">
                        <strong className="block truncate text-sm font-semibold text-[#dee3e7]">
                          {position.marketTitle}
                        </strong>
                        <span className="text-sm font-medium text-[#7b8996]">
                          {formatShares(shares)} shares · avg{" "}
                          {formatCents(getAveragePositionPrice(position))}
                        </span>
                      </div>
                    </div>
                    <PositionStat label="Yes / No" value={`${formatShares(position.yesShares)} / ${formatShares(position.noShares)}`} />
                    <PositionStat label="Value" value={formatCoinMicros(positionValue)} />
                    <PositionStat
                      label="PnL"
                      value={formatSignedCoinMicros(pnl)}
                      tone={BigInt(pnl) >= 0n ? "positive" : "negative"}
                    />
                    <button
                      className="rounded-2xl bg-[#2e3841] px-4 py-2 text-sm font-semibold text-[#dee3e7] transition hover:bg-[#242b32]"
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
            <PositionStat label="Invested" value={formatCoinMicros(summary.investedCoinMicros)} />
            <PositionStat label="Available" value={formatCoinMicros(summary.availableCoinMicros)} />
            <PositionStat label="Reserved" value={formatCoinMicros(summary.reservedCoinMicros)} />
            <PositionStat
              label="Unrealized PnL"
              value={formatSignedCoinMicros(summary.unrealizedPnlCoinMicros)}
              tone={BigInt(summary.unrealizedPnlCoinMicros) >= 0n ? "positive" : "negative"}
            />
            <PositionStat
              label="Realized PnL"
              value={formatSignedCoinMicros(summary.realizedPnlCoinMicros)}
              tone={BigInt(summary.realizedPnlCoinMicros) >= 0n ? "positive" : "negative"}
            />
            <PositionStat label="Total trades" value={String(portfolio.trades.length)} />
          </div>
        </aside>
      </div>

      <section className={`${panel} mt-6 p-5`}>
        <PanelHead
          title="Settlement history"
          subtitle="Resolved payouts and refunds"
          icon={<CheckCircle2 size={22} />}
        />

        {(portfolio.settlements ?? []).length === 0 ? (
          <EmptyState title="No settlements yet." text="Resolved markets and refunds will appear here." />
        ) : (
          <div className="mt-4 grid gap-3">
            {(portfolio.settlements ?? []).map((settlement) => (
              <article
                className="grid min-w-0 gap-4 rounded-2xl border border-[#242b32] bg-[#15191d] p-4 md:grid-cols-[minmax(0,1fr)_120px_120px_120px_120px] md:items-center"
                key={settlement.id}
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold text-[#dee3e7]">
                    {settlement.marketId ?? "Market settlement"}
                  </strong>
                  <span className="block text-sm font-medium text-[#7b8996]">
                    {settlement.kind ?? "settlement"} · {settlement.side ?? "n/a"}
                  </span>
                </div>
                <PositionStat
                  label="Stake"
                  value={formatCoinMicros(settlement.originalStakeCoinMicros)}
                />
                <PositionStat
                  label="Payout"
                  value={formatCoinMicros(settlement.payoutCoinMicros)}
                />
                <PositionStat
                  label="Realized"
                  value={formatSignedCoinMicros(settlement.profitCoinMicros)}
                  tone={BigInt(settlement.profitCoinMicros) >= 0n ? "positive" : "negative"}
                />
                <time className="text-sm font-semibold text-[#7b8996]">
                  {formatRelativeTime(settlement.createdAt)}
                </time>
              </article>
            ))}
          </div>
        )}
      </section>

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
                className="grid min-w-0 gap-4 rounded-2xl border border-[#242b32] bg-[#15191d] p-4 md:grid-cols-[minmax(0,1fr)_130px_120px_90px_90px] md:items-center"
                key={trade.id}
              >
                <div className="min-w-0">
                  <strong className="block text-sm font-semibold text-[#dee3e7]">
                    {trade.action === "sell" ? "Sell" : "Buy"}{" "}
                    {trade.side === "yes" ? "Yes" : "No"}
                  </strong>
                  <span className="block truncate text-sm font-medium text-[#7b8996]">
                    {trade.marketTitle}
                  </span>
                </div>
                <PositionStat
                  label={trade.action === "sell" ? "Proceeds" : "Amount"}
                  value={formatCoinMicros(trade.amountCoinMicros)}
                />
                <PositionStat label="Shares" value={formatShares(trade.shares)} />
                <PositionStat label="Price" value={formatCents(trade.price)} />
                <time className="text-sm font-semibold text-[#7b8996]">
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
      className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
        tone === "success"
          ? "bg-[#3db468]/10 text-[#a6d2b6]"
          : tone === "error"
            ? "bg-[#cb3131]/10 text-[#daa]"
            : "bg-[#1e2428] text-[#7b8996]"
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
          className="h-24 animate-pulse rounded-2xl border border-[#242b32] bg-[#15191d]"
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
            ? "text-[#5fbe82]"
            : tone === "negative"
              ? "text-[#d05959]"
              : "text-[#dee3e7]"
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
        <h2 className="text-xl font-semibold text-[#dee3e7]">{title}</h2>
        <span className={muted}>{subtitle}</span>
      </div>
      <div className="text-[#7b8996]">{icon}</div>
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
      <span className="block text-xs font-bold uppercase tracking-wide text-[#7b8996]">
        {label}
      </span>
      <strong
        className={`mt-1 block text-sm font-semibold ${
          tone === "positive"
            ? "text-[#5fbe82]"
            : tone === "negative"
              ? "text-[#d05959]"
              : "text-[#dee3e7]"
        }`}
      >
        {value}
      </strong>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-[#242b32] bg-[#15191d] p-8 text-center">
      <strong className="block text-base font-semibold text-[#dee3e7]">{title}</strong>
      <span className="mt-2 block text-sm font-medium text-[#7b8996]">{text}</span>
    </div>
  );
}
