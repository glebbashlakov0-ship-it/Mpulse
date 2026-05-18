import { Bookmark, Gift } from "lucide-react";
import type * as React from "react";
import { formatMoney, formatPercent } from "../lib/format";
import { getMarketKind } from "../lib/market";
import type { Market, Outcome } from "../lib/types";
import { MarketImage } from "./MarketMedia";

const tradeButton =
  "inline-flex h-[27px] w-10 items-center justify-center rounded-md text-[13px] font-bold transition hover:text-white";

type CardLayout = "binary" | "multi" | "sports" | "price" | "chance";
type ProbabilityGaugeVariant = "updown" | "chance";
type CardRow = {
  label: string;
  yesPrice: number | null;
  noPrice: number | null;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  status?: string;
  acceptingOrders?: boolean;
};
type SportsTeam = {
  label: string;
  price: number | null;
  market: Market | null;
  image: string | null;
};

export function MarketCard({
  market,
  onOpen,
  isWatched = false,
  onWatchlistToggle,
}: {
  market: Market;
  onOpen: () => void;
  isWatched?: boolean;
  onWatchlistToggle?: () => void;
}) {
  const layout = getCardLayout(market);
  const rows = getCardRows(market);
  const hasGroupedRows = (market.group_markets?.length ?? 0) > 1;
  const isUpDownCard = isUpDownMarket(market);
  const isSportsMatchCard = isSportsMatchMarket(market, layout);
  const isHeadToHeadCard = isHeadToHeadMarket(market, layout, isSportsMatchCard);
  const probabilityGaugeVariant = getMarketProbabilityGaugeVariant(market);
  const shouldShowRows =
    !isUpDownCard &&
    !isSportsMatchCard &&
    !isHeadToHeadCard &&
    rows.length > 0 &&
    (hasGroupedRows || layout === "multi" || layout === "price" || layout === "sports");

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  if (isSportsMatchCard) {
    return (
      <SportsMatchCard
        isWatched={isWatched}
        market={market}
        onKeyDown={handleKeyDown}
        onOpen={onOpen}
        onWatchlistToggle={onWatchlistToggle}
      />
    );
  }

  if (isHeadToHeadCard) {
    return (
      <HeadToHeadCard
        isWatched={isWatched}
        market={market}
        onKeyDown={handleKeyDown}
        onOpen={onOpen}
        onWatchlistToggle={onWatchlistToggle}
      />
    );
  }

  return (
    <article
      className="home-soft-card group/card relative flex h-full min-h-[180px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-[#293440] bg-[#1b2027] pt-3 shadow-md shadow-black/10 outline-none transition hover:-translate-y-px hover:border-[#3b91f6]/45 hover:bg-[#20272f] hover:shadow-black/20 focus-visible:border-[#3b91f6] focus-visible:ring-2 focus-visible:ring-[#3b91f6]/35"
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${market.title}`}
    >
      <div className="relative flex h-[42px] w-full items-start gap-2 px-3">
        <MarketImage market={market} className="h-[38px] w-[38px] min-w-[38px] rounded-md" />
        <div className="flex min-w-0 flex-1 cursor-default justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-h-[36px] flex-col justify-center">
              <h2 className="line-clamp-3 w-fit min-w-0 text-[15px] font-semibold leading-[1.18] text-[#edf1f5] decoration-2 group-hover/card:underline">
                {market.title}
              </h2>
            </div>
          </div>
          {probabilityGaugeVariant ? (
            <MarketProbabilityGauge market={market} variant={probabilityGaugeVariant} />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col justify-end gap-1.5 px-3 pb-2">
        {isUpDownCard ? (
          <UpDownMarketBody market={market} />
        ) : shouldShowRows ? (
          <RowsMarketBody rows={rows} />
        ) : (
          <BinaryMarketBody market={market} />
        )}

        {isUpDownCard ? (
          <FloatingAmount side="left" values={["+ $5", "+ $10"]} />
        ) : null}
        {isUpDownCard ? (
          <FloatingAmount side="right" values={["+ $5"]} />
        ) : null}

        <div className="relative flex w-full items-center text-[13px] font-semibold text-[#8f9aa8]">
          <div className="flex w-full items-center justify-between gap-2 overflow-visible whitespace-nowrap">
            {isUpDownCard ? <LiveFooterLabel label={getFooterLabel(market)} /> : <MarketFooterMeta market={market} />}
            <CardActionIcons
              isWatched={isWatched}
              market={market}
              onWatchlistToggle={onWatchlistToggle}
              showRewards={!isUpDownCard}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function HeadToHeadCard({
  isWatched,
  market,
  onKeyDown,
  onOpen,
  onWatchlistToggle,
}: {
  isWatched: boolean;
  market: Market;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onOpen: () => void;
  onWatchlistToggle?: () => void;
}) {
  const teams = getHeadToHeadTeams(market);
  const first = teams[0] ?? { label: "Team 1", price: null, market: null, image: null };
  const second = teams[1] ?? { label: "Team 2", price: null, market: null, image: null };

  return (
    <article
      className="home-soft-card group/card relative flex h-full min-h-[180px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-[#293440] bg-[#1b2027] pt-3 shadow-md shadow-black/10 outline-none transition hover:-translate-y-px hover:border-[#3b91f6]/45 hover:bg-[#20272f] hover:shadow-black/20 focus-visible:border-[#3b91f6] focus-visible:ring-2 focus-visible:ring-[#3b91f6]/35"
      onClick={onOpen}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${market.title}`}
    >
      <div className="flex w-full flex-col items-center gap-1 px-3">
        <HeadToHeadTeamRow team={first} />
        <HeadToHeadTeamRow team={second} />
      </div>

      <div className="flex flex-col justify-end gap-1.5 px-3 pb-2">
        <div className="flex h-fit items-end justify-between gap-2">
          <TeamChoiceButton label={first.label} color={getTeamColor(first.label, 0)} />
          <TeamChoiceButton label={second.label} color={getTeamColor(second.label, 1)} />
        </div>

        <div className="relative flex w-full items-center text-[13px] font-semibold text-[#8f9aa8]">
          <div className="flex w-full items-center justify-between gap-2 overflow-visible whitespace-nowrap">
            <MarketFooterMeta market={market} />
            <CardActionIcons
              isWatched={isWatched}
              market={market}
              onWatchlistToggle={onWatchlistToggle}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function HeadToHeadTeamRow({ team }: { team: SportsTeam }) {
  return (
    <div className="group flex h-9 w-full items-center justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <TeamMark image={team.image} label={team.label} market={team.market} />
        <p className="truncate text-[16px] font-medium text-[#edf1f5] decoration-2 group-hover:underline">
          {team.label}
        </p>
      </div>
      <p className="shrink-0 whitespace-nowrap text-[22px] font-semibold text-[#edf1f5]">
        {formatPercent(team.price)}
      </p>
    </div>
  );
}

function SportsMatchCard({
  isWatched,
  market,
  onKeyDown,
  onOpen,
  onWatchlistToggle,
}: {
  isWatched: boolean;
  market: Market;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onOpen: () => void;
  onWatchlistToggle?: () => void;
}) {
  const teams = getSportsTeams(market);
  const first = teams[0] ?? { label: "Home", price: null, market: null, image: null };
  const second = teams[1] ?? { label: "Away", price: null, market: null, image: null };

  return (
    <article
      className="home-soft-card group/card relative flex h-full min-h-[180px] cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-[#293440] bg-[#1b2027] pt-3 shadow-md shadow-black/10 outline-none transition hover:-translate-y-px hover:border-[#3b91f6]/45 hover:bg-[#20272f] hover:shadow-black/20 focus-visible:border-[#3b91f6] focus-visible:ring-2 focus-visible:ring-[#3b91f6]/35"
      onClick={onOpen}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${market.title}`}
    >
      <div className="flex w-full flex-col items-center gap-1 px-3">
        <SportsTeamRow team={first} />
        <SportsTeamRow team={second} />
      </div>

      <div className="flex flex-col justify-end gap-1.5 px-3 pb-2">
        <div className="flex h-fit items-center justify-center gap-2">
          <SportsSideButton label={first.label} side="home" />
          <button
            className="flex h-10 w-18 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#293440] px-4 py-2 text-sm font-bold text-[#8f9aa8] transition hover:border-[#8f9aa8]/60 hover:bg-[#20272f] hover:text-[#edf1f5]"
            onClick={(event) => event.stopPropagation()}
            type="button"
          >
            DRAW
          </button>
          <SportsSideButton label={second.label} side="away" />
        </div>

        <div className="relative flex w-full items-center text-[13px] font-semibold text-[#8f9aa8]">
          <div className="flex w-full items-center justify-between gap-2 overflow-visible whitespace-nowrap">
            <MarketFooterMeta market={market} />
            <CardActionIcons
              isWatched={isWatched}
              market={market}
              onWatchlistToggle={onWatchlistToggle}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function SportsTeamRow({
  team,
}: {
  team: SportsTeam;
}) {
  return (
    <div className="group flex h-9 w-full items-center justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <TeamMark image={team.image} label={team.label} market={team.market} />
        <span className="w-4 text-center text-[16px] font-medium text-[#edf1f5]">0</span>
        <span className="h-3 w-0.5 shrink-0 rounded-full bg-[#293440]" />
        <p className="truncate text-[16px] font-medium text-[#edf1f5] decoration-2 group-hover:underline">
          {team.label}
        </p>
      </div>
      <p className="shrink-0 whitespace-nowrap text-[22px] font-semibold text-[#edf1f5]">
        {formatPercent(team.price)}
      </p>
    </div>
  );
}

function TeamMark({
  image,
  label,
  market,
}: {
  image?: string | null;
  label: string;
  market: Market | null;
}) {
  const resolvedImage = image ?? knownTeamImage(label);

  if (resolvedImage) {
    return (
      <img
        alt=""
        className="size-7 shrink-0 rounded-md object-contain"
        loading="lazy"
        src={resolvedImage}
      />
    );
  }

  if (market) {
    return <MarketImage market={market} className="size-7 rounded-md object-contain" />;
  }

  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[#0f1318] text-[11px] font-bold text-[#8f9aa8]">
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function TeamChoiceButton({ color, label }: { color: string; label: string }) {
  return (
    <button
      className="group relative h-10 min-w-0 flex-1 overflow-hidden rounded-lg px-2 text-center text-[16px] font-bold transition hover:text-white"
      onClick={(event) => event.stopPropagation()}
      type="button"
    >
      <span className="relative z-[1] block truncate transition group-hover:text-white" style={{ color }}>
        {shortTeamLabel(label)}
      </span>
      <span
        className="absolute inset-0 z-0 rounded-lg opacity-20 transition group-hover:opacity-100"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

function SportsSideButton({ label, side }: { label: string; side: "home" | "away" }) {
  const color = side === "home" ? "rgb(196, 149, 28)" : "rgb(36, 106, 255)";

  return (
    <button
      className="group relative h-10 min-w-0 flex-1 overflow-hidden rounded-md px-2 text-center text-[16px] font-bold transition hover:text-white"
      onClick={(event) => event.stopPropagation()}
      type="button"
    >
      <span className="relative z-[1] block truncate transition group-hover:text-white" style={{ color }}>
        {label}
      </span>
      <span
        className="absolute inset-0 z-0 rounded-md opacity-20 transition group-hover:opacity-100"
        style={{ backgroundColor: color }}
      />
    </button>
  );
}

function UpDownMarketBody({ market }: { market: Market }) {
  const up = getDirectionalOutcome(market, "up");
  const down = getDirectionalOutcome(market, "down");

  return (
    <div className="flex h-[62px] items-end justify-between gap-2">
      <DirectionalTradeButton label={up?.name ?? "Up"} tone="up" amount="+ $10" />
      <DirectionalTradeButton label={down?.name ?? "Down"} tone="down" amount="+ $5" />
    </div>
  );
}

function BinaryMarketBody({ market }: { market: Market }) {
  const yes = findOutcome(market, "yes") ?? market.outcomes[0] ?? null;
  const no = findOutcome(market, "no") ?? market.outcomes[1] ?? null;

  return (
    <div className="grid h-[70px] grid-cols-2 items-end gap-2">
      <TradeSide label="Yes" outcome={yes} tone="yes" />
      <TradeSide label="No" outcome={no} tone="no" />
    </div>
  );
}

function RowsMarketBody({ rows }: { rows: CardRow[] }) {
  return (
    <div className="relative h-[70px] w-full select-none">
      {rows.slice(0, 2).map((row, index) => (
        <OutcomeRow key={`${row.label}-${index}`} row={row} />
      ))}
    </div>
  );
}

function OutcomeRow({ row }: { row: CardRow }) {
  return (
    <div className="mb-2 flex w-full shrink-0 items-center justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <p className="line-clamp-1 break-all text-[15px] font-medium leading-5 text-[#d8dde3] group-hover/card:underline">
          {row.label}
        </p>
      </div>
      <div className="shrink-0">
        <div className="flex items-center justify-end gap-1">
          <p className="mr-1 text-[15px] font-semibold text-[#edf1f5]">
            {formatPercent(row.yesPrice)}
          </p>
          <MiniTradeButton label="Yes" tone="yes" />
          <MiniTradeButton label="No" tone="no" />
        </div>
      </div>
    </div>
  );
}

function TradeSide({
  label,
  outcome,
  tone,
}: {
  label: "Yes" | "No";
  outcome: Outcome | null;
  tone: "yes" | "no";
}) {
  void outcome;

  return (
    <button
      className={`h-[46px] min-w-0 rounded-lg px-3 text-center text-[15px] font-bold transition hover:brightness-110 ${
        tone === "yes"
          ? "bg-green-500/15 text-green-400 hover:bg-green-600 hover:text-white"
          : "bg-red-500/15 text-red-400 hover:bg-red-500 hover:text-white"
      }`}
      onClick={(event) => event.stopPropagation()}
      type="button"
    >
      {label}
    </button>
  );
}

function DirectionalTradeButton({
  amount,
  label,
  tone,
}: {
  amount: string;
  label: string;
  tone: "up" | "down";
}) {
  return (
    <button
      className={`relative h-10 min-w-0 flex-1 overflow-hidden rounded-md px-2 text-center text-[16px] font-bold transition hover:text-white ${
        tone === "up"
          ? "bg-green-500/15 text-green-400 hover:bg-green-600"
          : "bg-red-500/15 text-red-400 hover:bg-red-500"
      }`}
      onClick={(event) => event.stopPropagation()}
      type="button"
    >
      <span className="block truncate">{label}</span>
      <span
        className={`pointer-events-none absolute top-1/2 hidden -translate-y-1/2 text-[13px] font-bold opacity-90 sm:block ${
          tone === "up" ? "left-4" : "right-4"
        }`}
      >
        {amount}
      </span>
    </button>
  );
}

function MiniTradeButton({ label, tone }: { label: "Yes" | "No"; tone: "yes" | "no" }) {
  return (
    <button
      className={`${tradeButton} ${
        tone === "yes"
          ? "bg-green-500/15 text-green-400 hover:bg-green-600"
          : "bg-red-500/15 text-red-400 hover:bg-red-500"
      }`}
      onClick={(event) => event.stopPropagation()}
      type="button"
    >
      {label}
    </button>
  );
}

function MarketProbabilityGauge({ market, variant }: { market: Market; variant: ProbabilityGaugeVariant }) {
  const display = getProbabilityGaugeDisplay(market, variant);
  const percent = display.value === null ? 0 : Math.round(display.value * 100);
  const paths = getGaugeArcPaths(display.value);
  const stroke = getGaugeStroke(display.value);
  const strokeOpacity = getGaugeStrokeOpacity(display.value);

  return (
    <div className="ml-2 mr-1 flex w-[58px] shrink-0 flex-col items-end justify-center gap-2">
      <div className="flex h-[34px]">
        <svg
          width="58"
          height="34.03579715234098"
          viewBox="-29 -29 58 34.03579715234098"
          className="w-[58px] max-w-[58px] overflow-visible"
          aria-hidden="true"
        >
          <path
            d={paths.track}
            fill="none"
            stroke="#293440"
            strokeLinecap="round"
            strokeWidth="4.5"
          />
          <path
            d={paths.value}
            fill="none"
            stroke={stroke}
            strokeLinecap="round"
            strokeOpacity={strokeOpacity}
            strokeWidth="4.5"
          />
        </svg>
      </div>
      <div className="flex w-full -translate-y-[28px] flex-col items-center">
        <p className="text-center text-[22px] font-medium leading-none text-[#edf1f5]">
          {display.value === null ? "--" : `${percent}%`}
        </p>
        <p className="line-clamp-2 text-center text-[13px] font-semibold leading-tight text-[#8f9aa8]">
          {display.label}
        </p>
      </div>
    </div>
  );
}

export function getProbabilityGaugeDisplay(market: Market, variant: ProbabilityGaugeVariant) {
  const up = getDirectionalOutcome(market, "up");

  if (variant === "updown") {
    return {
      label: up?.name ?? "Up",
      value: getOutcomePrice(up),
    };
  }

  const yes = findOutcome(market, "yes") ?? market.outcomes[0] ?? null;
  const isYesNoMarket =
    market.outcomes.length === 2 &&
    market.outcomes[0]?.name.toLowerCase() === "yes" &&
    market.outcomes[1]?.name.toLowerCase() === "no";

  return {
    label: isYesNoMarket ? "chance" : yes?.name ?? "chance",
    value: getOutcomePrice(yes),
  };
}

export function getGaugeStroke(value: number | null) {
  const percent = getGaugePercent(value);

  if (percent < 30) {
    return "#e23939";
  }

  if (percent < 50) {
    return "#fe9a00";
  }

  return "#30a159";
}

export function getGaugeStrokeOpacity(value: number | null) {
  if (value === null) {
    return 0;
  }

  const percent = getGaugePercent(value);

  return roundGaugeNumber((Math.abs(percent - 50) / 50) * 0.45 + 0.55);
}

export function getGaugeArcPaths(value: number | null) {
  const percent = getGaugePercent(value);
  const valueAngle = Math.round(80 + percent * 2);
  const activeEndAngle =
    percent === 100 ? 280 : Math.min(Math.max(valueAngle - 6, 82), 266);
  const trackStartAngle = Math.max(Math.min(valueAngle + 6, 278), 94);

  return {
    track: describeGaugeArc(trackStartAngle, 280),
    value: describeGaugeArc(80, activeEndAngle),
  };
}

function describeGaugeArc(startAngle: number, endAngle: number) {
  const radius = 29;
  const start = gaugePolarToCartesian(radius, startAngle + 90);
  const end = gaugePolarToCartesian(radius, endAngle + 90);
  const largeArcFlag = endAngle - startAngle < 180 ? 0 : 1;

  return `M ${start.x - 0.001} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function gaugePolarToCartesian(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;

  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians),
  };
}

function roundGaugeNumber(value: number) {
  return Math.round(value * 1000) / 1000;
}

function getGaugePercent(value: number | null) {
  return value === null ? 0 : Math.min(100, Math.max(0, value * 100));
}

function FloatingAmount({ side, values }: { side: "left" | "right"; values: string[] }) {
  return (
    <div
      className={`pointer-events-none absolute bottom-12 z-10 flex flex-col ${
        side === "left" ? "left-5 items-start" : "right-5 items-end"
      }`}
    >
      {values.map((value, index) => (
        <span
          className={`absolute whitespace-nowrap text-[12px] font-semibold ${
            side === "left" ? "text-green-400" : "text-red-400"
          }`}
          key={`${side}-${value}-${index}`}
          style={{
            bottom: `${index * 24}px`,
            opacity: index === 0 ? 0.75 : 0.35,
            transform: `translateY(${-4 - index * 5}px) scale(${0.96 - index * 0.03})`,
          }}
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function LiveFooterLabel({ label }: { label: string }) {
  return (
    <div className="flex min-w-0 flex-row items-center gap-1">
      <div className="relative ml-1 flex h-5 items-center gap-1.5">
        <div className="relative flex items-center justify-center">
          <span className="relative z-10 size-[7px] rounded-full bg-red-500" />
          <span className="absolute -inset-px size-[9px] animate-ping rounded-full bg-red-500 opacity-75" />
        </div>
        <p className="text-[13px] font-semibold uppercase leading-none text-red-500">Live</p>
      </div>
      <span className="mx-px opacity-50">·</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function MarketFooterMeta({ market }: { market: Market }) {
  const items = getMarketFooterItems(market);

  return (
    <div className="flex min-w-0 flex-row items-center gap-1 overflow-hidden">
      {items.map((item, index) => (
        <span className={getFooterItemClassName(index)} key={`${item}-${index}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

function getFooterItemClassName(index: number) {
  const base = "min-w-0 truncate";

  if (index === 0) {
    return base;
  }

  if (index >= 3) {
    return `${base} hidden xl:inline`;
  }

  return `${base} before:mx-1 before:text-[#566272] before:content-['•']`;
}

function CardActionIcons({
  isWatched,
  market,
  onWatchlistToggle,
  showRewards = true,
}: {
  isWatched: boolean;
  market: Market;
  onWatchlistToggle?: () => void;
  showRewards?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center">
      {showRewards && hasMarketRewards(market) ? (
        <IconBadge label="Rewards">
          <Gift size={16} />
        </IconBadge>
      ) : null}
      {onWatchlistToggle ? (
        <button
          className={`relative z-[1] grid h-7 w-7 place-items-center rounded-full transition ${
            isWatched
              ? "bg-[#3b91f6]/20 text-[#3b91f6]"
              : "text-[#8f9aa8] hover:bg-white/5 hover:text-[#edf1f5]"
          }`}
          aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}
          aria-pressed={isWatched}
          onClick={(event) => {
            event.stopPropagation();
            onWatchlistToggle();
          }}
          type="button"
        >
          <Bookmark size={16} fill={isWatched ? "currentColor" : "none"} />
        </button>
      ) : (
        <IconBadge label="Add to favorites">
          <Bookmark size={16} />
        </IconBadge>
      )}
    </div>
  );
}

function SportsFooterLabel({ market }: { market: Market }) {
  return (
    <div className="flex min-w-0 flex-row items-center gap-1">
      <div className="relative ml-1 flex h-5 min-w-0 items-center gap-1.5">
        <div className="relative flex shrink-0 items-center justify-center">
          <span className="relative z-10 size-[7px] rounded-full bg-red-500" />
          <span className="absolute -inset-px size-[9px] animate-ping rounded-full bg-red-500 opacity-75" />
        </div>
        <p className="shrink-0 text-[14px] font-semibold leading-none text-[#edf1f5]">
          {getSportsClockLabel(market)}
        </p>
        <p className="ml-1 truncate text-[#8f9aa8]">
          <span>{formatMoney(market.volume)} </span>Vol.
        </p>
      </div>
      <span className="mx-px opacity-50">·</span>
      <span className="truncate">{getFooterLabel(market)}</span>
    </div>
  );
}

function HeadToHeadFooterLabel({ market }: { market: Market }) {
  return (
    <div className="flex min-w-0 flex-row items-center gap-1">
      <p className="truncate">
        <span>{formatMoney(market.volume)} </span>Vol.
      </p>
      <span className="mx-px opacity-50">·</span>
      <span className="truncate">{getFooterLabel(market)}</span>
      {getMatchTimeLabel(market) ? (
        <>
          <span className="mx-px opacity-50">·</span>
          <span className="shrink-0">{getMatchTimeLabel(market)}</span>
        </>
      ) : null}
    </div>
  );
}

function IconBadge({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      className="grid h-7 w-7 place-items-center rounded-full text-[#8f9aa8] transition hover:bg-white/5 hover:text-[#edf1f5]"
      aria-label={label}
      title={label}
    >
      {children}
    </span>
  );
}

function isHeadToHeadMarket(market: Market, layout: CardLayout, isSportsMatchCard: boolean) {
  if (layout !== "sports" || isSportsMatchCard) {
    return false;
  }

  const text = getMarketSearchText(market);

  if (/\b(manager|appointed|coach|worlds winner|tournament winner|champion|championship|nominee|nomination)\b/.test(text)) {
    return false;
  }

  const teams = getHeadToHeadTeams(market);
  const hasMatchCue = /\b(vs\.?|v\.?|at|game|bo[1357]|match|lol|dota|cs2|counter-strike|esports|indian league)\b/.test(
    text,
  );

  return teams.length >= 2 && hasMatchCue;
}

function isSportsMatchMarket(market: Market, layout: CardLayout) {
  if (layout !== "sports") {
    return false;
  }

  const text = getMarketSearchText(market);

  if (/\b(esports|dota|lol|league of legends|counter-strike|cs2|gaming)\b/.test(text)) {
    return false;
  }

  const teams = getSportsTeams(market);
  const hasDrawMarket =
    market.outcomes.some((outcome) => isDrawLabel(outcome.name)) ||
    (market.group_markets?.some((groupMarket) => isDrawLabel(getGroupMarketLabel(groupMarket))) ?? false);
  const hasMatchCue =
    /\b(vs\.?|v\.?|at|game|1h|2h|la liga|laliga|premier league|champions league|nba|nfl|nhl|mlb|uefa)\b/.test(
      text,
    );
  const looksLikeTournamentWinner =
    /\b(winner|champion|championship|playoffs|nominee|nomination)\b/.test(text) && !hasMatchCue;

  return teams.length >= 2 && hasDrawMarket && hasMatchCue && !looksLikeTournamentWinner;
}

function isUpDownMarket(market: Market) {
  const text = getMarketSearchText(market);
  const outcomeText = market.outcomes.map((outcome) => outcome.name.toLowerCase()).join(" ");

  return (
    /\bup\s+or\s+down\b|\bupdown\b|\bup\/down\b/.test(text) ||
    ((text.includes("bitcoin") || text.includes("btc") || text.includes("crypto")) &&
      outcomeText.includes("up") &&
      outcomeText.includes("down"))
  );
}

export function getMarketProbabilityGaugeVariant(market: Market): ProbabilityGaugeVariant | null {
  const layout = getCardLayout(market);
  const rows = getCardRows(market);
  const hasGroupedRows = (market.group_markets?.length ?? 0) > 1;
  const isUpDownCard = isUpDownMarket(market);
  const isSportsMatchCard = isSportsMatchMarket(market, layout);
  const isHeadToHeadCard = isHeadToHeadMarket(market, layout, isSportsMatchCard);
  const shouldShowRows =
    !isUpDownCard &&
    !isSportsMatchCard &&
    !isHeadToHeadCard &&
    rows.length > 0 &&
    (hasGroupedRows || layout === "multi" || layout === "price" || layout === "sports");

  if (shouldShowRows || isSportsMatchCard || isHeadToHeadCard) {
    return null;
  }

  if (isUpDownCard) {
    return "updown";
  }

  return layout === "binary" || layout === "chance" ? "chance" : null;
}

function getSportsTeams(market: Market): SportsTeam[] {
  const groupedTeams =
    market.group_markets
      ?.filter((groupMarket) => !isDrawLabel(getGroupMarketLabel(groupMarket)))
      .slice(0, 2)
      .map((groupMarket) => ({
        label: cleanTeamLabel(getGroupMarketLabel(groupMarket)),
        price: groupMarket.yes_price,
        market: getTeamImage(groupMarket, market) ? groupMarket : null,
        image: getTeamImage(groupMarket, market),
      })) ?? [];

  if (groupedTeams.length >= 2) {
    return groupedTeams;
  }

  const outcomeTeams = market.outcomes
    .filter((outcome) => !isDrawLabel(outcome.name))
    .slice(0, 2)
    .map((outcome) => ({
      label: cleanTeamLabel(outcome.name),
      price: getOutcomePrice(outcome),
      market: null,
      image: knownTeamImage(outcome.name),
    }));

  if (outcomeTeams.length >= 2 && !outcomeTeams.some((team) => isBinaryOutcomeLabel(team.label))) {
    return outcomeTeams;
  }

  const parsedTeams = parseMatchTeams(market.title);

  if (parsedTeams.length >= 2) {
    return parsedTeams.map((label) => ({
      label,
      price: null,
      market: null,
      image: knownTeamImage(label),
    }));
  }

  return outcomeTeams;
}

function getHeadToHeadTeams(market: Market): SportsTeam[] {
  const outcomeTeams = market.outcomes
    .filter((outcome) => !isDrawLabel(outcome.name))
    .slice(0, 2)
    .map((outcome) => ({
      label: cleanTeamLabel(outcome.name),
      price: getOutcomePrice(outcome),
      market: null,
      image: knownTeamImage(outcome.name),
    }));

  if (outcomeTeams.length >= 2 && !outcomeTeams.some((team) => isBinaryOutcomeLabel(team.label))) {
    return outcomeTeams;
  }

  const parsedTeams = parseMatchTeams(market.title);

  if (parsedTeams.length >= 2) {
    return parsedTeams.map((label) => ({
      label,
      price: null,
      market: null,
      image: knownTeamImage(label),
    }));
  }

  return [];
}

function getTeamImage(teamMarket: Market, parentMarket: Market) {
  const image = teamMarket.displayImage ?? teamMarket.image ?? teamMarket.icon ?? null;
  const parentImage = parentMarket.displayImage ?? parentMarket.image ?? parentMarket.icon ?? null;

  if (!image || image === parentImage) {
    return knownTeamImage(getGroupMarketLabel(teamMarket));
  }

  return image;
}

function knownTeamImage(label: string) {
  const normalized = label.toLowerCase().replace(/\s+cf\b/, "").trim();

  if (normalized === "kiwoom drx" || normalized === "drx") {
    return "https://polymarket-upload.s3.us-east-2.amazonaws.com/team_logos/esports/lol/league-of-legends_drx_126370.png";
  }

  if (normalized === "kt rolster") {
    return "https://polymarket-upload.s3.us-east-2.amazonaws.com/team_logos/esports/lol/league-of-legends_kt%20rolster_63.png";
  }

  if (normalized === "real madrid" || normalized === "real madrid cf") {
    return "https://polymarket-upload.s3.us-east-2.amazonaws.com/Real%20Madrid%20CF-766f4e0266.png";
  }

  if (normalized === "oviedo" || normalized === "real oviedo") {
    return "https://polymarket-upload.s3.us-east-2.amazonaws.com/Real%20Oviedo-bfdc21095c.png";
  }

  return null;
}

function getTeamColor(label: string, index: number) {
  const normalized = label.toLowerCase();

  if (normalized.includes("drx") || normalized.includes("oviedo") || normalized.includes("mumbai")) {
    return "rgb(62, 127, 224)";
  }

  if (
    normalized.includes("kt") ||
    normalized.includes("weibo") ||
    normalized.includes("jd gaming") ||
    normalized.includes("punjab")
  ) {
    return "rgb(255, 66, 82)";
  }

  return index === 0 ? "rgb(62, 127, 224)" : "rgb(196, 28, 28)";
}

function shortTeamLabel(label: string) {
  return label
    .replace(/\bGaming\b/i, "")
    .replace(/\bKings\b/i, "")
    .replace(/\bIndians\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getGroupMarketLabel(groupMarket: Market & { label?: string }) {
  return groupMarket.label || groupMarket.groupItemTitle || groupMarket.title;
}

function cleanTeamLabel(label: string) {
  return label
    .replace(/^(lol|dota\s*2?|cs2|counter-strike)\s*:\s*/i, "")
    .replace(/\s+moneyline$/i, "")
    .replace(/\s+winner$/i, "")
    .replace(/\s+to win$/i, "")
    .replace(/\s+cf$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMatchTeams(title: string) {
  const normalized = title.replace(/\?/g, "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.+?)\s+(?:vs\.?|v\.?|at)\s+(.+?)(?:\s+on\s+|\s+by\s+|$)/i);

  if (!match) {
    return [];
  }

  return [cleanTeamLabel(match[1]), cleanTeamLabel(match[2])].filter(Boolean);
}

function isDrawLabel(label: string) {
  return /^(draw|tie)\b/i.test(label.trim());
}

function isBinaryOutcomeLabel(label: string) {
  return /^(yes|no|up|down)$/i.test(label.trim());
}

function getSportsClockLabel(market: Market) {
  const text = getMarketSearchText(market);

  if (/\b1h\s*-\s*\d+\b/i.test(text)) {
    return text.match(/\b1h\s*-\s*\d+\b/i)?.[0].toUpperCase() ?? "1H - 30";
  }

  if (market.status === "live" || market.dates?.status === "live" || market.active) {
    return "1H - 30";
  }

  return "Game";
}

function getMatchTimeLabel(market: Market) {
  const date = market.starts_at ?? market.ends_at;

  if (!date) {
    return null;
  }

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function getCardLayout(market: Market): CardLayout {
  const text = `${market.category ?? ""} ${market.topics.join(" ")} ${market.title}`.toLowerCase();

  if (text.includes("sports") || text.includes("esports") || /\bvs\.?\b|\bbo[1357]\b/.test(text)) {
    return "sports";
  }

  if (
    text.includes("bitcoin") ||
    text.includes("ethereum") ||
    text.includes("price") ||
    text.includes("above") ||
    text.includes("hit ") ||
    text.includes("oil") ||
    text.includes("gold")
  ) {
    return "price";
  }

  if (market.outcomes.length > 2) {
    return "multi";
  }

  if (text.includes("chance") || text.includes("confirmed") || text.includes("released")) {
    return "chance";
  }

  return "binary";
}

function findOutcome(market: Market, name: string) {
  return market.outcomes.find((outcome) => outcome.name.toLowerCase() === name);
}

function getOutcomePrice(outcome: Outcome | null | undefined) {
  return outcome?.price ?? outcome?.probability ?? null;
}

function getDirectionalOutcome(market: Market, direction: "up" | "down") {
  const matcher =
    direction === "up"
      ? /\b(up|higher|above|yes)\b/i
      : /\b(down|lower|below|no)\b/i;
  const fallbackIndex = direction === "up" ? 0 : 1;

  return market.outcomes.find((outcome) => matcher.test(outcome.name)) ?? market.outcomes[fallbackIndex] ?? null;
}

export function getCardRows(market: Market): CardRow[] {
  const groupRows =
    market.group_markets?.map((groupMarket) => ({
      label: groupMarket.label || groupMarket.groupItemTitle || groupMarket.title,
      yesPrice: groupMarket.yes_price,
      noPrice: groupMarket.no_price,
      active: groupMarket.active,
      closed: groupMarket.closed,
      archived: groupMarket.archived,
      status: groupMarket.status,
      acceptingOrders: groupMarket.trading.accepting_orders,
    })) ?? [];

  if (groupRows.length > 1) {
    return sortPreviewRows(groupRows);
  }

  if (market.outcomes.length > 2) {
    return market.outcomes.map((outcome) => ({
      label: outcome.name,
      yesPrice: getOutcomePrice(outcome),
      noPrice: null,
    }));
  }

  return [];
}

function sortPreviewRows(rows: CardRow[]) {
  return [...rows].sort((left, right) => {
    const leftTradable = isPreviewRowTradable(left) ? 1 : 0;
    const rightTradable = isPreviewRowTradable(right) ? 1 : 0;

    return (
      rightTradable - leftTradable ||
      getPreviewRowPrice(right) - getPreviewRowPrice(left)
    );
  });
}

function isPreviewRowTradable(row: CardRow) {
  return (
    row.active !== false &&
    row.closed !== true &&
    row.archived !== true &&
    row.acceptingOrders !== false &&
    row.status !== "closed" &&
    row.status !== "expired"
  );
}

function getPreviewRowPrice(row: CardRow) {
  return row.yesPrice ?? -1;
}

function getMarketFooterItems(market: Market) {
  const items = [`${formatMoney(market.volume)} Vol.`];
  const label = getFooterLabel(market);

  if (label) {
    items.push(label);
  }

  return items;
}

function hasMarketRewards(market: Market): boolean {
  return Boolean(
    market.rewards?.enabled ||
      market.group_markets?.some((groupMarket) => groupMarket.rewards?.enabled),
  );
}

function getFooterLabel(market: Market) {
  const text = getMarketSearchText(market);

  if (text.includes("lol") || text.includes("league of legends")) {
    return "LoL";
  }

  if (text.includes("dota")) {
    return "Dota 2";
  }

  if (text.includes("cs2") || text.includes("counter-strike")) {
    return "CS2";
  }

  if (text.includes("esports") || text.includes("gaming")) {
    return "Esports";
  }

  if (text.includes("bitcoin") || text.includes("btc")) {
    return "Bitcoin";
  }

  if (text.includes("la liga") || text.includes("la-liga") || text.includes("laliga") || text.includes("real madrid") || text.includes("oviedo")) {
    return "La Liga";
  }

  if (text.includes("premier league") || text.includes("premier-league")) {
    return "Premier League";
  }

  if (text.includes("nba")) {
    return "NBA";
  }

  if (text.includes("basketball")) {
    return "Basketball";
  }

  if (text.includes("nfl")) {
    return "NFL";
  }

  if (text.includes("nhl")) {
    return "NHL";
  }

  if (text.includes("mlb")) {
    return "MLB";
  }

  if (text.includes("soccer")) {
    return "Soccer";
  }

  if (text.includes("tennis")) {
    return "Tennis";
  }

  if (text.includes("cricket")) {
    return "Cricket";
  }

  if (text.includes("golf")) {
    return "Golf";
  }

  return getMarketKind(market);
}

function getMarketSearchText(market: Market) {
  return `${market.title} ${market.category ?? ""} ${market.category_label ?? ""} ${market.topics.join(" ")} ${
    market.event_title ?? ""
  }`.toLowerCase();
}
