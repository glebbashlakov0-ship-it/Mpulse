export type PolymarketMarket = {
  id: string;
  question?: string;
  slug?: string;
  description?: string;
  category?: string;
  image?: string;
  icon?: string;
  endDate?: string;
  startDate?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  restricted?: boolean;
  volume?: string | number;
  volumeNum?: number;
  liquidity?: string | number;
  liquidityNum?: number;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
  enableOrderBook?: boolean;
  acceptingOrders?: boolean;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  createdAt?: string;
  updatedAt?: string;
  volume24hr?: string | number;
  commentCount?: number;
  gameStartTime?: string;
  clobRewards?: Array<{ rewardsDailyRate?: number; rewardsAmount?: number }>;
  rewardsMinSize?: string | number;
  rewardsMaxSpread?: string | number;
  holdingRewardsEnabled?: boolean;
  oneDayPriceChange?: number;
  oneHourPriceChange?: number;
  events?: PolymarketEvent[];
  groupItemTitle?: string;
  groupItemThreshold?: string | number;
  groupMarkets?: PolymarketMarket[];
};

export type PolymarketEvent = {
  id: string;
  ticker?: string;
  slug?: string;
  title?: string;
  description?: string;
  category?: string;
  image?: string;
  icon?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  restricted?: boolean;
  volume?: string | number;
  volume24hr?: string | number;
  liquidity?: string | number;
  openInterest?: string | number;
  commentCount?: number;
  competitive?: number;
  markets?: PolymarketMarket[];
  tags?: Array<{ id?: string; label?: string; slug?: string }>;
};

export type PolymarketTag = {
  id?: string | number;
  label?: string;
  slug?: string;
  isCarousel?: boolean;
  forceShow?: boolean;
  forceHide?: boolean;
};

export type PolymarketPriceHistoryPoint = {
  t: number;
  p: number | string;
};

export type PolymarketPriceHistoryResponse = {
  history?: PolymarketPriceHistoryPoint[];
};

export type NormalizedOutcome = {
  name: string;
  price: number | null;
  probability: number | null;
  price_cents: number | null;
  clobTokenId: string | null;
};

export type NormalizedMarketPriceSummary = {
  yes: number | null;
  no: number | null;
  best_bid: number | null;
  best_ask: number | null;
  last_trade: number | null;
  midpoint: number | null;
  spread: number | null;
};

export type NormalizedMarketStatus = "upcoming" | "live" | "closed" | "expired";

export type NormalizedMarketDateSummary = {
  starts_at: string | null;
  ends_at: string | null;
  starts_at_ms: number | null;
  ends_at_ms: number | null;
  status: NormalizedMarketStatus;
  seconds_to_close: number | null;
};

export type NormalizedCategory = {
  id: string;
  slug: string;
  label: string;
  title_ar: string | null;
  description: string | null;
  image: string;
  keywords: string[];
};

export type NormalizedTag = {
  id: string;
  slug: string;
  label: string;
};

export type NormalizedMarketVolumeSummary = {
  volume: number;
  liquidity: number;
};

export type NormalizedRelatedMarket = {
  id: string;
  slug: string | null;
  title: string;
  category: string | null;
  image: string | null;
  icon: string | null;
  volume: number;
  ends_at: string | null;
  probability: number | null;
};

export type NormalizedMarket = {
  id: string;
  slug: string | null;
  title: string;
  title_ar: string | null;
  description: string | null;
  category: string | null;
  category_label: string | null;
  topics: string[];
  image: string | null;
  icon: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: NormalizedMarketStatus;
  active: boolean;
  closed: boolean;
  archived: boolean;
  restricted: boolean;
  volume: number;
  volume_24h?: number;
  liquidity: number;
  comment_count?: number;
  game_start_time?: string | null;
  rewards?: {
    enabled: boolean;
    daily_rate: number;
    holding: boolean;
    min_size: number | null;
    max_spread: number | null;
  };
  outcomes: NormalizedOutcome[];
  trading: {
    order_book_enabled: boolean;
    accepting_orders: boolean;
    best_bid: number | null;
    best_ask: number | null;
    last_trade_price: number | null;
  };
  event_id: string | null;
  event_slug: string | null;
  event_title: string | null;
  groupItemTitle: string | null;
  groupItemThreshold: string | null;
  canonical_market_id: string;
  canonical_event_slug: string | null;
  group_markets?: NormalizedGroupMarket[];
  source: "polymarket";
};

export type NormalizedGroupMarket = NormalizedMarket & {
  label: string;
  yes_price: number | null;
  no_price: number | null;
  clobTokenIds: string[];
};

export type MarketSnapshot = {
  id: string;
  market_id: string;
  captured_at: string;
  prices: NormalizedMarketPriceSummary;
  volume: number;
  liquidity: number;
  source: "polymarket";
  synthetic?: boolean;
};

export type MarketPriceHistoryPoint = {
  timestamp: string;
  yes: number | null;
  no: number | null;
  outcomes?: Array<{ name: string; price: number | null; volume?: number }>;
  outcomeVolumes?: Record<string, number>;
  volume: number;
  liquidity: number;
  synthetic?: boolean;
};

export type NormalizedMarketDetail = NormalizedMarket & {
  prices: NormalizedMarketPriceSummary;
  dates: NormalizedMarketDateSummary;
  volume_detail: NormalizedMarketVolumeSummary;
  related_markets: NormalizedRelatedMarket[];
  history: {
    snapshots: MarketSnapshot[];
    price_history: MarketPriceHistoryPoint[];
    is_synthetic: boolean;
  };
  group_markets: NormalizedGroupMarket[];
};

export type NormalizedEvent = {
  id: string;
  slug: string | null;
  title: string;
  title_ar: string | null;
  description: string | null;
  category: string | null;
  category_label: string | null;
  topics: string[];
  image: string | null;
  icon: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: NormalizedMarketStatus;
  active: boolean;
  closed: boolean;
  archived: boolean;
  restricted: boolean;
  volume: number;
  volume_24h: number;
  liquidity: number;
  open_interest: number;
  tags: Array<{ id: string | null; label: string | null; slug: string | null }>;
  markets: NormalizedMarket[];
  source: "polymarket";
};
