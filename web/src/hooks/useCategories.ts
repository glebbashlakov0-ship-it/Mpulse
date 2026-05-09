import * as React from "react";
import { loadCategories } from "../lib/api";
import type { MarketCategory } from "../lib/types";

export function useCategories() {
  const [state, setState] = React.useState<{
    status: "loading" | "ready" | "error";
    data: MarketCategory[];
  }>({
    status: "loading",
    data: [],
  });

  React.useEffect(() => {
    const controller = new AbortController();

    loadCategories(controller.signal)
      .then((categories) => setState({ status: "ready", data: categories }))
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
