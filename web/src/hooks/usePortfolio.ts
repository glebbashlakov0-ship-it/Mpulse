import * as React from "react";
import { loadPortfolio } from "../lib/api";
import { createInitialPortfolio } from "../lib/portfolio";
import type { Portfolio } from "../lib/types";

export function usePortfolio() {
  const [portfolio, setPortfolioState] = React.useState<Portfolio>(() =>
    createInitialPortfolio(),
  );
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = React.useState<string | null>(null);

  const setPortfolio = React.useCallback((nextPortfolio: Portfolio) => {
    setPortfolioState(nextPortfolio);
    setStatus("ready");
    setError(null);
  }, []);

  const refreshPortfolio = React.useCallback(async () => {
    setStatus("loading");
    try {
      const nextPortfolio = await loadPortfolio();
      setPortfolioState(nextPortfolio);
      setStatus("ready");
      setError(null);
      return nextPortfolio;
    } catch (refreshError) {
      setStatus("error");
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not load portfolio",
      );
      throw refreshError;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    loadPortfolio()
      .then((nextPortfolio) => {
        if (!cancelled) {
          setPortfolioState(nextPortfolio);
          setStatus("ready");
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPortfolioState(createInitialPortfolio());
          setStatus("error");
          setError("Could not load portfolio. Showing an empty account.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return [portfolio, setPortfolio, refreshPortfolio, { status, error }] as const;
}
