import * as React from "react";
import { loadMarketDetail } from "../lib/api";
import { withDetailImage } from "../lib/market";
import type { Market } from "../lib/types";

export function useMarketDetail(marketId: string | null, fallbackMarket: Market | null) {
  const [state, setState] = React.useState<{
    status: "idle" | "loading" | "ready" | "error";
    data: Market | null;
  }>({
    status: "idle",
    data: null,
  });

  React.useEffect(() => {
    if (!marketId) {
      setState({ status: "idle", data: null });
      return;
    }

    const controller = new AbortController();
    setState((current) => ({
      status: "loading",
      data:
        current.data?.id === marketId
          ? current.data
          : fallbackMarket?.id === marketId
            ? withDetailImage(fallbackMarket)
            : null,
    }));

    loadMarketDetail(marketId, controller.signal)
      .then((market) => {
        setState({
          status: "ready",
          data: withDetailImage(market, fallbackMarket),
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (fallbackMarket?.id === marketId) {
          setState({
            status: "ready",
            data: withDetailImage(fallbackMarket),
          });
          return;
        }

        setState({ status: "error", data: null });
      });

    return () => controller.abort();
  }, [marketId, fallbackMarket]);

  return state;
}
