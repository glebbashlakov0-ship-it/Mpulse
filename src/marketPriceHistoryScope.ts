import type { NormalizedMarketDetail } from "./types.js";
import type { MarketPriceHistoryScopeType } from "./marketPriceHistoryRepository.js";

export type MarketPriceHistoryScope = {
  scopeType: MarketPriceHistoryScopeType;
  scopeId: string;
  marketExternalId: string;
};

export function getMarketPriceHistoryScope(market: NormalizedMarketDetail): MarketPriceHistoryScope {
  if ((market.group_markets ?? []).length > 1) {
    return {
      scopeType: "event",
      scopeId: market.event_id ?? market.canonical_event_slug ?? market.event_slug ?? market.id,
      marketExternalId: market.id,
    };
  }

  return {
    scopeType: "market",
    scopeId: market.id,
    marketExternalId: market.id,
  };
}
