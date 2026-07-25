import * as React from "react";
import { loadPortfolio } from "../lib/api";
import { createInitialPortfolio } from "../lib/portfolio";
import type { Portfolio } from "../lib/types";
import { useAuth } from "./useAuth";

type PortfolioState = {
  status: "loading" | "ready" | "error";
  error: string | null;
};

type PortfolioContextValue = readonly [
  Portfolio,
  (nextPortfolio: Portfolio) => void,
  () => Promise<Portfolio>,
  PortfolioState,
];

const PortfolioContext = React.createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const userId = user?.id ?? null;
  const [portfolio, setPortfolioState] = React.useState<Portfolio>(() =>
    createInitialPortfolio(),
  );
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);
  const activeUserIdRef = React.useRef<string | null>(userId);
  activeUserIdRef.current = userId;

  const setPortfolio = React.useCallback((nextPortfolio: Portfolio) => {
    setPortfolioState(nextPortfolio);
    setStatus("ready");
    setError(null);
  }, []);

  const loadPortfolioForUser = React.useCallback(async (requestedUserId: string) => {
    const requestId = ++requestIdRef.current;
    setStatus("loading");
    setError(null);

    try {
      const nextPortfolio = await loadPortfolio();

      if (
        requestId === requestIdRef.current &&
        activeUserIdRef.current === requestedUserId
      ) {
        setPortfolioState(nextPortfolio);
        setStatus("ready");
        setError(null);
      }

      return nextPortfolio;
    } catch (refreshError) {
      if (
        requestId === requestIdRef.current &&
        activeUserIdRef.current === requestedUserId
      ) {
        setPortfolioState(createInitialPortfolio());
        setStatus("error");
        setError(
          refreshError instanceof Error
            ? refreshError.message
            : "Could not load portfolio",
        );
      }

      throw refreshError;
    }
  }, []);

  React.useEffect(() => {
    requestIdRef.current += 1;
    setPortfolioState(createInitialPortfolio());
    setError(null);

    if (authStatus === "loading") {
      setStatus("loading");
      return;
    }

    if (authStatus !== "authenticated" || !userId) {
      setStatus(authStatus === "error" ? "error" : "ready");
      setError(authStatus === "error" ? "Could not load portfolio session." : null);
      return;
    }

    void loadPortfolioForUser(userId).catch(() => undefined);

    return () => {
      requestIdRef.current += 1;
    };
  }, [authStatus, loadPortfolioForUser, userId]);

  const refreshPortfolio = React.useCallback(async () => {
    if (authStatus !== "authenticated" || !userId) {
      const nextPortfolio = createInitialPortfolio();
      setPortfolio(nextPortfolio);
      return nextPortfolio;
    }

    return loadPortfolioForUser(userId);
  }, [authStatus, loadPortfolioForUser, setPortfolio, userId]);

  const contextValue = React.useMemo<PortfolioContextValue>(
    () => [portfolio, setPortfolio, refreshPortfolio, { status, error }] as const,
    [error, portfolio, refreshPortfolio, setPortfolio, status],
  );

  return React.createElement(PortfolioContext.Provider, { value: contextValue }, children);
}

export function usePortfolio() {
  const context = React.useContext(PortfolioContext);

  if (!context) {
    throw new Error("usePortfolio must be used within PortfolioProvider.");
  }

  return context;
}
