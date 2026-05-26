import { Bookmark } from "lucide-react";
import * as React from "react";
import { formatMoney } from "../lib/format";
import { getMarketKind } from "../lib/market";
import type { Market, Outcome } from "../lib/types";
import { MarketImage } from "./MarketMedia";

const tradeButton =
  "inline-flex h-[27px] w-10 items-center justify-center rounded-[5.2px] px-3.5 text-[13px] font-medium leading-4 tracking-[-0.1px] transition duration-150";

const matchChoiceAccentPalette = [
  "#2296ff",
  "#ff3f72",
  "#35f0d0",
  "#f4bd3f",
  "#a56eff",
  "#30d158",
  "#ff8a3d",
  "#00c2a8",
  "#e255ff",
  "#7bdc35",
];

const matchChoiceAccentOverrides: Record<string, string> = {
  "afc bournemouth": "#991616",
  "baltimore orioles": "#c04000",
  "bodo/glimt": "#4c4c4c",
  "bodø/glimt": "#4c4c4c",
  bournemouth: "#991616",
  forest: "#aa1830",
  orioles: "#c04000",
  rays: "#0f4b9c",
  rosenborg: "#4c4c4c",
  "t machac": "#c02121",
  "t. machac": "#c02121",
  "tampa bay rays": "#0f4b9c",
  "z bergs": "#e0bf3e",
  "z. bergs": "#e0bf3e",
};

const polymarketUploadBase = "https://polymarket-upload.s3.us-east-2.amazonaws.com";

const nbaTeamCodes: Record<string, string> = {
  "atlanta hawks": "ATL",
  hawks: "ATL",
  "boston celtics": "BOS",
  celtics: "BOS",
  "brooklyn nets": "BKN",
  nets: "BKN",
  "charlotte hornets": "CHA",
  hornets: "CHA",
  "chicago bulls": "CHI",
  bulls: "CHI",
  "cleveland cavaliers": "CLE",
  cavaliers: "CLE",
  "dallas mavericks": "DAL",
  mavericks: "DAL",
  "denver nuggets": "DEN",
  nuggets: "DEN",
  "detroit pistons": "DET",
  pistons: "DET",
  "golden state warriors": "GSW",
  warriors: "GSW",
  "houston rockets": "HOU",
  rockets: "HOU",
  "indiana pacers": "IND",
  pacers: "IND",
  "los angeles clippers": "LAC",
  clippers: "LAC",
  "la clippers": "LAC",
  "los angeles lakers": "LAL",
  lakers: "LAL",
  "memphis grizzlies": "MEM",
  grizzlies: "MEM",
  "miami heat": "MIA",
  heat: "MIA",
  "milwaukee bucks": "MIL",
  bucks: "MIL",
  "minnesota timberwolves": "MIN",
  timberwolves: "MIN",
  "new orleans pelicans": "NOP",
  pelicans: "NOP",
  "new york knicks": "NYK",
  knicks: "NYK",
  "oklahoma city thunder": "OKC",
  thunder: "OKC",
  "orlando magic": "ORL",
  magic: "ORL",
  "philadelphia 76ers": "PHI",
  "76ers": "PHI",
  sixers: "PHI",
  "phoenix suns": "PHX",
  suns: "PHX",
  "portland trail blazers": "POR",
  blazers: "POR",
  "sacramento kings": "SAC",
  kings: "SAC",
  "san antonio spurs": "SAS",
  spurs: "SAS",
  "toronto raptors": "TOR",
  raptors: "TOR",
  "utah jazz": "UTA",
  jazz: "UTA",
  "washington wizards": "WAS",
  wizards: "WAS",
};

const mlbTeamCodes: Record<string, string> = {
  "arizona diamondbacks": "ARI",
  diamondbacks: "ARI",
  "atlanta braves": "ATL",
  braves: "ATL",
  "baltimore orioles": "BAL",
  orioles: "BAL",
  "boston red sox": "BOS",
  "red sox": "BOS",
  "chicago cubs": "CHC",
  cubs: "CHC",
  "chicago white sox": "CWS",
  "white sox": "CWS",
  "cincinnati reds": "CIN",
  reds: "CIN",
  "cleveland guardians": "CLE",
  guardians: "CLE",
  "colorado rockies": "COL",
  rockies: "COL",
  "detroit tigers": "DET",
  tigers: "DET",
  "houston astros": "HOU",
  astros: "HOU",
  "kansas city royals": "KC",
  royals: "KC",
  "los angeles angels": "LAA",
  angels: "LAA",
  "los angeles dodgers": "LAD",
  dodgers: "LAD",
  "miami marlins": "MIA",
  marlins: "MIA",
  "milwaukee brewers": "MIL",
  brewers: "MIL",
  "minnesota twins": "MIN",
  twins: "MIN",
  "new york mets": "NYM",
  mets: "NYM",
  "new york yankees": "NYY",
  yankees: "NYY",
  "athletics": "ATH",
  "oakland athletics": "ATH",
  "philadelphia phillies": "PHI",
  phillies: "PHI",
  "pittsburgh pirates": "PIT",
  pirates: "PIT",
  "san diego padres": "SD",
  padres: "SD",
  "san francisco giants": "SF",
  giants: "SF",
  "seattle mariners": "SEA",
  mariners: "SEA",
  "st louis cardinals": "STL",
  "saint louis cardinals": "STL",
  cardinals: "STL",
  "tampa bay rays": "TB",
  rays: "TB",
  "texas rangers": "TEX",
  rangers: "TEX",
  "toronto blue jays": "TOR",
  "blue jays": "TOR",
  "washington nationals": "WSH",
  nationals: "WSH",
};

const lolTeamLogos: Record<string, string> = {
  "dplus kia": `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_dplus%20kia_132531.png`,
  drx: `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_drx_126370.png`,
  "g2 esports": `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_g2%20esports_88.png`,
  "hanwha life esports": `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_hanwha%20life%20esports_2883.png`,
  "kiwoom drx": `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_drx_126370.png`,
  "kt rolster": `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_kt%20rolster_63.png`,
  los: `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_los_133796.png`,
  loud: `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_loud_128313.png`,
  "movistar koi": `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_movistar%20koi_126536.png`,
  "nongshim red force": `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_nongshim%20red%20force_128217.png`,
  t1: `${polymarketUploadBase}/team_logos/esports/lol/league-of-legends_t1_126061.png`,
};

const polymarketCardShell =
  "group/card relative flex h-full min-h-[180px] cursor-pointer flex-col justify-between overflow-hidden rounded-[15.2px] border border-[var(--pm-border)] bg-[var(--pm-surface-1)] pt-3 text-[var(--pm-text-primary)] shadow-[0_8px_16px_rgba(0,0,0,0.04)] outline-none transition duration-150 hover:-translate-y-px hover:bg-[var(--pm-surface-2)] hover:shadow-[0_8px_16px_rgba(0,0,0,0.08)] focus-visible:border-[var(--pm-brand)] focus-visible:ring-1 focus-visible:ring-[var(--pm-brand)]";

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
type MatchScoreDisplay = {
  hasExplicitScore: boolean;
  scores: [string, string];
};

export function MarketCard({
  imagePriority = "auto",
  imageLoading = "lazy",
  market,
  onOpen,
  isWatched = false,
  onWatchlistToggle,
}: {
  imagePriority?: "auto" | "high" | "low";
  imageLoading?: "eager" | "lazy";
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
      className={polymarketCardShell}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${market.title}`}
    >
      <div className="relative flex h-[42px] w-full items-start gap-2 px-3">
        <MarketImage
          market={market}
          className="h-[38px] w-[38px] min-w-[38px] rounded-md"
          fetchPriority={imagePriority}
          loading={imageLoading}
        />
        <div className="flex min-w-0 flex-1 cursor-default justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-h-[36px] flex-col justify-center">
              <h2 className="line-clamp-3 w-fit min-w-0 text-[15px] font-semibold leading-[1.18] tracking-[-0.09px] text-[var(--pm-text-primary)] decoration-2 group-hover/card:underline">
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

        <div className="relative flex w-full items-center text-[13px] font-medium leading-4 tracking-[-0.1px] text-[var(--pm-text-secondary)]">
          <div className="flex w-full items-center justify-between gap-2 overflow-visible whitespace-nowrap">
            {isUpDownCard ? <LiveFooterLabel label={getFooterLabel(market)} /> : <MarketFooterMeta market={market} />}
            <CardActionIcons
              isWatched={isWatched}
              onWatchlistToggle={onWatchlistToggle}
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
    <MatchCard
      first={first}
      isWatched={isWatched}
      market={market}
      onKeyDown={onKeyDown}
      onOpen={onOpen}
      onWatchlistToggle={onWatchlistToggle}
      second={second}
      variant="headToHead"
    />
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
    <MatchCard
      first={first}
      isWatched={isWatched}
      market={market}
      onKeyDown={onKeyDown}
      onOpen={onOpen}
      onWatchlistToggle={onWatchlistToggle}
      second={second}
      variant="threeWay"
    />
  );
}

function MatchCard({
  first,
  isWatched,
  market,
  onKeyDown,
  onOpen,
  onWatchlistToggle,
  second,
  variant,
}: {
  first: SportsTeam;
  isWatched: boolean;
  market: Market;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onOpen: () => void;
  onWatchlistToggle?: () => void;
  second: SportsTeam;
  variant: "headToHead" | "threeWay";
}) {
  const scoreDisplay = getMatchScoreDisplay(market, first.label, second.label);
  const shouldShowScoreRows = scoreDisplay.hasExplicitScore;
  const firstAccent = getMatchChoiceAccent(first.label, 0);
  const secondAccent = getMatchChoiceAccent(second.label, 1, [firstAccent]);

  return (
    <article
      className={polymarketCardShell}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Open ${market.title}`}
    >
      <div className="flex w-full flex-col items-center gap-1 px-3">
        {shouldShowScoreRows ? (
          <>
            <MatchTeamRow score={scoreDisplay.scores[0]} team={first} />
            <MatchTeamRow score={scoreDisplay.scores[1]} team={second} />
          </>
        ) : (
          <>
            <HeadToHeadTeamRow team={first} />
            <HeadToHeadTeamRow team={second} />
          </>
        )}
      </div>

      <div className="flex flex-col justify-end gap-1.5 px-3 pb-2">
        <div
          className={
            variant === "threeWay"
              ? "flex h-fit items-center justify-center gap-2"
              : "flex h-fit items-end justify-between gap-2"
          }
        >
          {variant === "threeWay" ? (
            <>
              <MatchChoiceButton accent={firstAccent} label={first.label} onSelect={onOpen} />
              <MatchDrawButton onSelect={onOpen} />
              <MatchChoiceButton accent={secondAccent} label={second.label} onSelect={onOpen} />
            </>
          ) : (
            <>
              <MatchChoiceButton accent={firstAccent} label={first.label} onSelect={onOpen} />
              <MatchChoiceButton accent={secondAccent} label={second.label} onSelect={onOpen} />
            </>
          )}
        </div>

        <div className="relative flex w-full items-center text-[13px] font-medium leading-4 tracking-[-0.1px] text-[var(--pm-text-secondary)]">
          <div className="flex w-full items-center justify-between gap-2 overflow-visible whitespace-nowrap">
            {shouldShowScoreRows ? (
              <MatchFooterMeta market={market} variant={variant} />
            ) : (
              <HeadToHeadFooterMeta market={market} />
            )}
            <CardActionIcons
              isWatched={isWatched}
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
    <div className="group flex h-9 w-full items-center">
      <div className="flex w-full min-w-0 items-center gap-2">
        <TeamMark image={team.image} label={team.label} market={team.market} />
        <p className="truncate text-[16px] font-medium leading-5 tracking-[-0.09px] text-[var(--pm-text-primary)] decoration-2 group-hover:underline">
          {team.label}
        </p>
      </div>
    </div>
  );
}

function MatchTeamRow({
  score,
  team,
}: {
  score: string;
  team: SportsTeam;
}) {
  return (
    <div className="group flex h-9 w-full items-center">
      <div className="flex w-full min-w-0 items-center gap-2">
        <TeamMark image={team.image} label={team.label} market={team.market} />
        <span className="w-4 shrink-0 text-center text-[16px] font-medium tracking-[-0.09px] text-[var(--pm-text-primary)]">
          {score}
        </span>
        <span className="h-3 w-0.5 shrink-0 rounded-full bg-[var(--pm-border)]" />
        <p className="truncate text-[16px] font-medium leading-5 tracking-[-0.09px] text-[var(--pm-text-primary)] decoration-2 group-hover:underline">
          {team.label}
        </p>
      </div>
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
  const [failedImage, setFailedImage] = React.useState<string | null>(null);

  if (resolvedImage && failedImage !== resolvedImage) {
    return (
      <img
        alt=""
        className="size-7 shrink-0 rounded-sm object-contain"
        loading="lazy"
        onError={() => setFailedImage(resolvedImage)}
        src={resolvedImage}
      />
    );
  }

  if (market) {
    return <MarketImage market={market} className="size-7 rounded-sm object-contain" />;
  }

  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-[var(--pm-surface-2)] text-[11px] font-bold text-[var(--pm-text-secondary)]">
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

function MatchChoiceButton({
  accent,
  label,
  onSelect,
}: {
  accent: string;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      className="group relative inline-flex h-10 min-w-0 w-10 flex-1 cursor-pointer items-center justify-center overflow-hidden rounded-sm px-2 text-center text-[16px] font-semibold tracking-[-0.09px] transition duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--pm-brand)]"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      style={{ "--match-choice-color": accent } as React.CSSProperties}
      type="button"
    >
      <span className="relative z-[1] flex min-w-0 items-center gap-x-1.5">
        <span className="block min-w-0 truncate text-[var(--match-choice-color)] transition duration-150 group-hover:!text-white">
          {label}
        </span>
      </span>
      <span className="absolute inset-0 z-0 rounded-sm bg-[var(--match-choice-color)] opacity-10 transition duration-150 group-hover:opacity-100" />
    </button>
  );
}

function MatchDrawButton({ onSelect }: { onSelect: () => void }) {
  return (
    <button
      className="inline-flex h-10 min-w-0 w-[72px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm border border-[var(--pm-border)] bg-transparent px-4 text-center text-[14px] font-semibold tracking-[-0.09px] text-[var(--pm-text-secondary)] transition duration-150 active:scale-[0.97] hover:bg-[var(--pm-surface-2)] hover:text-[var(--pm-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--pm-brand)]"
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      type="button"
    >
      DRAW
    </button>
  );
}

function getMatchChoiceAccent(label: string, index: number, usedAccents: string[] = []) {
  const normalized = normalizeMatchChoiceLabel(label) || `choice-${index}`;
  const override = matchChoiceAccentOverrides[normalized];

  if (override) {
    return override;
  }

  let paletteIndex =
    (getStableHash(normalized) + index * 3) % matchChoiceAccentPalette.length;
  let accent = matchChoiceAccentPalette[paletteIndex];
  let attempts = 0;

  while (usedAccents.includes(accent) && attempts < matchChoiceAccentPalette.length) {
    paletteIndex = (paletteIndex + 1) % matchChoiceAccentPalette.length;
    accent = matchChoiceAccentPalette[paletteIndex];
    attempts += 1;
  }

  return accent;
}

function normalizeMatchChoiceLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ");
}

function getStableHash(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function getMatchScoreDisplay(market: Market, firstLabel: string, secondLabel: string): MatchScoreDisplay {
  const text = normalizeScoreText(
    [
      market.title,
      market.event_title,
      market.groupItemTitle,
      ...(market.group_markets?.map((groupMarket) => getGroupMarketLabel(groupMarket)) ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const first = getScoreLabelVariants(firstLabel);
  const second = getScoreLabelVariants(secondLabel);
  const compactScore = findCompactScoreBetweenTeams(text, first, second);

  if (compactScore) {
    return { hasExplicitScore: true, scores: compactScore };
  }

  const firstScore = findScoreAfterTeam(text, first);
  const secondScore = findScoreAfterTeam(text, second);

  return {
    hasExplicitScore: Boolean(firstScore && secondScore),
    scores: [firstScore ?? "0", secondScore ?? "0"],
  };
}

function findCompactScoreBetweenTeams(
  text: string,
  firstLabels: string[],
  secondLabels: string[],
): [string, string] | null {
  for (const first of firstLabels) {
    for (const second of secondLabels) {
      const pattern = new RegExp(
        `(?:^|\\b)${escapeRegExp(first)}(?:\\b|$)\\s+(\\d{1,2})\\s*[-:]\\s*(\\d{1,2})\\s+(?:${escapeRegExp(second)})(?:\\b|$)`,
      );
      const match = text.match(pattern);

      if (match) {
        return [match[1], match[2]];
      }
    }
  }

  return null;
}

function findScoreAfterTeam(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(
      new RegExp(`(?:^|\\b)${escapeRegExp(label)}(?:\\b|$)\\s+(\\d{1,2})(?!\\d)`),
    );

    if (match) {
      return match[1];
    }
  }

  return null;
}

function getScoreLabelVariants(label: string) {
  const normalized = normalizeScoreText(cleanTeamLabel(label));
  const words = normalized.split(" ").filter(Boolean);
  const variants = [normalized];

  if (words.length > 1) {
    variants.push(words.slice(-2).join(" "));
    variants.push(words.at(-1) ?? normalized);
  }

  return [...new Set(variants.filter(Boolean))];
}

function normalizeScoreText(value: string) {
  return value
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'\-: ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function UpDownMarketBody({ market }: { market: Market }) {
  const up = getDirectionalOutcome(market, "up");
  const down = getDirectionalOutcome(market, "down");

  return (
    <div className="flex h-[62px] items-end justify-between gap-2">
      <DirectionalTradeButton label={up?.name ?? "Up"} tone="up" />
      <DirectionalTradeButton label={down?.name ?? "Down"} tone="down" />
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
        <p className="line-clamp-1 break-all text-[14px] font-medium leading-5 tracking-[-0.09px] text-[var(--pm-text-primary)] group-hover/card:underline">
          {row.label}
        </p>
      </div>
      <div className="shrink-0">
        <div className="flex items-center justify-end gap-1">
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
      className={`h-[46px] min-w-0 rounded-sm px-3 text-center text-[15px] font-semibold tracking-[-0.09px] transition hover:brightness-105 ${
        tone === "yes"
          ? "bg-[#30a159]/15 text-[#30a159] hover:bg-[#30a159] hover:text-white"
          : "bg-[#e23939]/10 text-[#e23939] hover:bg-[#e23939] hover:text-white"
      }`}
      onClick={(event) => event.stopPropagation()}
      type="button"
    >
      {label}
    </button>
  );
}

function DirectionalTradeButton({ label, tone }: { label: string; tone: "up" | "down" }) {
  return (
    <button
      className={`relative h-10 min-w-0 flex-1 overflow-hidden rounded-sm px-2 text-center text-[16px] font-semibold tracking-[-0.09px] transition hover:text-white ${
        tone === "up"
          ? "bg-[#30a159]/15 text-[#30a159] hover:bg-[#30a159]"
          : "bg-[#e23939]/10 text-[#e23939] hover:bg-[#e23939]"
      }`}
      onClick={(event) => event.stopPropagation()}
      type="button"
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}

function MiniTradeButton({ label, tone }: { label: "Yes" | "No"; tone: "yes" | "no" }) {
  return (
    <button
      className={`${tradeButton} ${
        tone === "yes"
          ? "bg-[#30a159]/15 text-[#30a159] hover:bg-[#30a159] hover:text-white"
          : "bg-[#e23939]/10 text-[#e23939] hover:bg-[#e23939] hover:text-white"
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
            stroke="var(--pm-border)"
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
        <p className="text-center text-[22px] font-medium leading-none tracking-[-0.18px] text-[var(--pm-text-primary)]">
          {display.value === null ? "--" : `${percent}%`}
        </p>
        <p className="line-clamp-2 text-center text-[13px] font-semibold leading-tight tracking-[-0.1px] text-[var(--pm-text-secondary)]">
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
    return "#f7d022";
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

function LiveFooterLabel({ label }: { label: string }) {
  return (
    <div className="flex min-w-0 flex-row items-center gap-1">
      <div className="relative ml-1 flex h-5 items-center gap-1.5">
        <div className="relative flex items-center justify-center">
          <span className="relative z-10 size-[7px] rounded-full bg-[#e23939]" />
          <span className="absolute -inset-px size-[9px] animate-ping rounded-full bg-[#e23939] opacity-75" />
        </div>
        <p className="text-[13px] font-semibold uppercase leading-none tracking-[-0.1px] text-[#e23939]">Активные</p>
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

  return `${base} before:mx-1 before:text-[#a6adb7] before:content-['·']`;
}

function CardActionIcons({
  isWatched,
  onWatchlistToggle,
}: {
  isWatched: boolean;
  onWatchlistToggle?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      {onWatchlistToggle ? (
        <button
          className={`relative z-[1] grid h-7 w-7 place-items-center rounded-full transition ${
            isWatched
              ? "bg-[var(--pm-brand-muted)] text-[var(--pm-brand)]"
              : "text-[var(--pm-text-secondary)] hover:bg-[var(--pm-surface-2)] hover:text-[var(--pm-text-primary)]"
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

function MatchFooterMeta({
  market,
  variant,
}: {
  market: Market;
  variant: "headToHead" | "threeWay";
}) {
  const label = getFooterLabel(market);

  return (
    <div className="flex min-w-0 flex-row items-center gap-1 overflow-hidden">
      <div className="relative ml-1 flex h-5 shrink-0 items-center gap-1.5">
        <div className="relative flex items-center justify-center">
          <span className="relative z-10 size-[7px] rounded-full bg-[#e43b43]" />
          <span className="absolute -inset-px size-[9px] animate-ping rounded-full bg-[#e43b43] opacity-75" />
        </div>
        <span className="shrink-0 text-[14px] font-semibold leading-none tracking-[-0.09px] text-[var(--pm-text-primary)]">
          {getMatchClockLabel(market, variant)}
        </span>
      </div>
      <span className="min-w-0 truncate text-[var(--pm-text-secondary)]">
        {formatMoney(market.volume)} Vol.
      </span>
      {label ? (
        <>
          <span className="mx-px shrink-0 opacity-50">·</span>
          <span className="min-w-0 truncate">{label}</span>
        </>
      ) : null}
    </div>
  );
}

function HeadToHeadFooterMeta({ market }: { market: Market }) {
  const items = getHeadToHeadFooterItems(market);

  return (
    <div className="flex min-w-0 flex-row items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item, index) => (
        <React.Fragment key={`${item.value}-${index}`}>
          {index > 0 ? <span className="mx-px shrink-0 opacity-50">·</span> : null}
          {item.kind === "league" ? (
            <span className="shrink-0 text-[var(--pm-text-secondary)] transition hover:text-[var(--pm-text-primary)]">
              {item.value}
            </span>
          ) : (
            <span className="shrink-0 text-[var(--pm-text-secondary)]">
              {item.value}
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function IconBadge({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      className="grid h-7 w-7 place-items-center rounded-full text-[var(--pm-text-secondary)] transition hover:bg-[var(--pm-surface-2)] hover:text-[var(--pm-text-primary)]"
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
  const hasMatchCue =
    /\b(vs\.?|v\.?|at|game|bo[1357]|match|lol|dota|cs2|counter-strike|esports|indian league|mlb|nba|nfl|nhl|atp|wta)\b/.test(
      text,
    ) ||
    /\b(?:top|bot|bottom)\s+(?:extra|\d{1,2})\b/.test(text) ||
    /\b\d{1,2}\s*[-:]\s*\d{1,2}\b/.test(text);

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
  void market;

  return null;
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
  const normalized = label
    .toLowerCase()
    .replace(/\s+(cf|fc)\b/, "")
    .replace(/\./g, "")
    .trim();

  const lolLogo = lolTeamLogos[normalized];

  if (lolLogo) {
    return lolLogo;
  }

  const nbaCode = nbaTeamCodes[normalized];

  if (nbaCode) {
    return `${polymarketUploadBase}/NBA+Team+Logos/${nbaCode}.png`;
  }

  const mlbCode = mlbTeamCodes[normalized];

  if (mlbCode) {
    return `${polymarketUploadBase}/MLB+Team+Logos/${mlbCode}.png`;
  }

  if (normalized === "rosenborg") {
    return `${polymarketUploadBase}/team_logos/soccer/nor/nor1_rbk_90000831.png`;
  }

  if (normalized === "bodø/glimt" || normalized === "bodo/glimt" || normalized === "fk bodø/glimt") {
    return `${polymarketUploadBase}/FK%20Bod%C3%B8%2FGlimt-63354af4b3.png`;
  }

  if (normalized === "real madrid" || normalized === "real madrid cf") {
    return `${polymarketUploadBase}/Real%20Madrid%20CF-766f4e0266.png`;
  }

  if (normalized === "oviedo" || normalized === "real oviedo") {
    return `${polymarketUploadBase}/Real%20Oviedo-bfdc21095c.png`;
  }

  if (normalized === "team spirit") {
    return "https://commons.wikimedia.org/wiki/Special:FilePath/Team_Spirit_new_em.svg";
  }

  if (normalized === "aurora" || normalized === "aurora gaming") {
    return "https://commons.wikimedia.org/wiki/Special:FilePath/Aurora_Gaming_logo.svg";
  }

  if (normalized === "palace" || normalized === "crystal palace") {
    return "https://upload.wikimedia.org/wikipedia/en/a/a2/Crystal_Palace_FC_logo_%282022%29.svg";
  }

  if (normalized === "arsenal") {
    return "https://upload.wikimedia.org/wikipedia/en/5/53/Arsenal_FC.svg";
  }

  return null;
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
  return /^(yes|no|up|down|over|under|odd|even|o\/?u|both|neither)$/i.test(label.trim());
}

function getMatchClockLabel(market: Market, variant: "headToHead" | "threeWay") {
  const text = getMarketSearchText(market);
  const period = text.match(/\b([12]h)\s*[-–]\s*(\d{1,3})\s*'?/i);

  if (period) {
    return `${period[1].toUpperCase()} - ${period[2]}'`;
  }

  const baseballExtra = text.match(/\b(bot|bottom|top)\s+extra\b/i);

  if (baseballExtra) {
    return `${getBaseballHalfLabel(baseballExtra[1])} Extra`;
  }

  const baseballInning = text.match(/\b(bot|bottom|top)\s+(\d{1,2})\b/i);

  if (baseballInning) {
    return `${getBaseballHalfLabel(baseballInning[1])} ${baseballInning[2]}`;
  }

  const game = text.match(/\b(?:game|map)\s*(\d+)\b/i);

  if (game) {
    return `Игра ${game[1]}`;
  }

  if (variant === "headToHead" || /\b(esports|dota|lol|league of legends|counter-strike|cs2|gaming)\b/.test(text)) {
    return "Игра 1";
  }

  if (market.status === "live" || market.dates?.status === "live" || market.active) {
    return "1H - 45'";
  }

  return "Game";
}

function getBaseballHalfLabel(value: string) {
  return value.toLowerCase().startsWith("top") ? "Top" : "Bot";
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

function getHeadToHeadFooterItems(market: Market) {
  const items: Array<{ kind: "date" | "league" | "volume"; value: string }> = [
    { kind: "volume", value: `${formatMoney(market.volume)} Vol.` },
  ];
  const label = getFooterLabel(market);
  const startLabel = getMarketStartFooterLabel(market);

  if (label) {
    items.push({ kind: "league", value: label });
  }

  if (startLabel) {
    items.push({ kind: "date", value: startLabel });
  }

  return items;
}

function getMarketStartFooterLabel(market: Market) {
  const value = market.game_start_time ?? market.starts_at ?? market.ends_at;

  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const month = new Intl.DateTimeFormat("ru", { month: "short" })
    .format(parsed)
    .replace(".", "");
  const day = new Intl.DateTimeFormat("ru", { day: "numeric" }).format(parsed);
  const time = new Intl.DateTimeFormat("ru", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(parsed);

  return `${month} ${day}, ${time}`;
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

  if (text.includes("epl") || text.includes("premier league") || text.includes("premier-league")) {
    return "EPL";
  }

  if (
    text.includes("norway eliteserien") ||
    text.includes("eliteserien") ||
    text.includes("nor-rbk") ||
    text.includes("rbk-bog")
  ) {
    return "Norway Eliteserien";
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

  if (text.includes("atp")) {
    return "ATP";
  }

  if (text.includes("wta")) {
    return "WTA";
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
  return `${market.title} ${market.slug ?? ""} ${market.category ?? ""} ${market.category_label ?? ""} ${market.topics.join(" ")} ${
    market.event_title ?? ""
  } ${market.event_slug ?? ""} ${market.canonical_event_slug ?? ""} ${market.groupItemTitle ?? ""}`.toLowerCase();
}
