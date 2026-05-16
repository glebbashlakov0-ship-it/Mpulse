import * as React from "react";
import { loadTags } from "../lib/api";
import type { MarketTag } from "../lib/types";

export function useMarketTags() {
  const [state, setState] = React.useState<{
    status: "loading" | "ready" | "error";
    data: MarketTag[];
  }>({
    status: "loading",
    data: [],
  });

  React.useEffect(() => {
    const controller = new AbortController();

    loadTags(controller.signal)
      .then((tags) => setState({ status: "ready", data: tags }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState({ status: "error", data: [] });
      });

    return () => controller.abort();
  }, []);

  return state;
}
