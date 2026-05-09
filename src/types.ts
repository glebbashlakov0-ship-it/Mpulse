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
  oneDayPriceChange?: number;
  oneHourPriceChange?: number;
  events?: PolymarketEvent[];
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
  markets?: PolymarketMarket[];
  tags?: Array<{ id?: string; label?: string; slug?: string }>;
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
  liquidity: number;
  outcomes: NormalizedOutcome[];
  trading: {
    order_book_enabled: boolean;
    accepting_orders: boolean;
    best_bid: number | null;
    best_ask: number | null;
    last_trade_price: number | null;
  };
  source: "polymarket";
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
