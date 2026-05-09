import type { PolymarketMarket } from "./types.js";

export type MarketVisibilityRule = {
  id: string;
  action: "hide";
  scope: "keyword" | "category" | "country" | "legal_risk";
  value: string;
  reason: string | null;
  active: boolean;
};

export function buildKeywordVisibilityRules(blockedTerms: string[]): MarketVisibilityRule[] {
  return blockedTerms.map((term) => ({
    id: `keyword:${term}`,
    action: "hide",
    scope: "keyword",
    value: term.toLowerCase(),
    reason: "Blocked for local visibility policy.",
    active: true,
  }));
}

export function isMarketVisible(
  market: Pick<PolymarketMarket, "question" | "description" | "category">,
  rules: MarketVisibilityRule[],
) {
  const text = `${market.category ?? ""} ${market.question ?? ""} ${market.description ?? ""}`.toLowerCase();

  return !rules.some((rule) => {
    if (!rule.active || rule.action !== "hide") {
      return false;
    }

    if (rule.scope === "keyword") {
      return text.includes(rule.value);
    }

    if (rule.scope === "category") {
      return (market.category ?? "").toLowerCase() === rule.value;
    }

    return false;
  });
}
