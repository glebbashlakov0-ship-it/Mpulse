import { getFallbackImage, getLastResortImage, getRelatedMarketDisplayImage } from "../lib/market";
import type { Market, Outcome, RelatedMarket } from "../lib/types";

export function MarketImage({
  market,
  className = "",
}: {
  market: Market;
  className?: string;
}) {
  return (
    <img
      alt=""
      className={`h-12 w-12 shrink-0 rounded-lg object-cover ${className}`}
      loading="lazy"
      src={market.displayImage ?? getFallbackImage(market)}
      onError={(event) => {
        const image = event.currentTarget;

        if (image.dataset.fallbackApplied === "true") {
          return;
        }

        image.dataset.fallbackApplied = "true";
        image.src = getLastResortImage(market);
      }}
    />
  );
}

export function OutcomeAvatar({
  market,
  outcome,
  index,
}: {
  market: Market;
  outcome: Outcome;
  index: number;
}) {
  return (
    <img
      alt=""
      className="h-12 w-12 shrink-0 rounded-lg object-cover"
      loading="lazy"
      src={getOutcomeImage(market, outcome, index)}
      onError={(event) => {
        const image = event.currentTarget;

        if (image.dataset.fallbackApplied === "true") {
          return;
        }

        image.dataset.fallbackApplied = "true";
        image.src = getLastResortImage({
          ...market,
          id: `${market.id}-${outcome.name}-${index}`,
        });
      }}
    />
  );
}

export function RelatedMarketImage({
  relatedMarket,
  className = "",
}: {
  relatedMarket: RelatedMarket;
  className?: string;
}) {
  return (
    <img
      alt=""
      className={`h-12 w-12 shrink-0 rounded-lg object-cover ${className}`}
      loading="lazy"
      src={getRelatedMarketDisplayImage(relatedMarket)}
      onError={(event) => {
        const image = event.currentTarget;

        if (image.dataset.fallbackApplied === "true") {
          return;
        }

        image.dataset.fallbackApplied = "true";
        image.src = getLastResortImage(relatedMarket);
      }}
    />
  );
}

function getOutcomeImage(market: Market, _outcome: Outcome, index: number) {
  if (index === 0) {
    return market.displayImage ?? getFallbackImage(market);
  }

  return getFallbackImage(market);
}
