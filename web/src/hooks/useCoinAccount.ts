import * as React from "react";
import { loadCoinBalance, loadSupportedMoneyAssets } from "../lib/api";
import type { CoinBalance, SupportedMoneyAssetsPayload } from "../lib/types";
import { useAuth } from "./useAuth";

type CoinAccountStatus = "loading" | "ready" | "error";

type CoinAccountContextValue = {
  balance: CoinBalance | null;
  supportedAssets: SupportedMoneyAssetsPayload | null;
  status: CoinAccountStatus;
  error: string | null;
  refreshBalance: () => Promise<CoinBalance | null>;
};

const CoinAccountContext = React.createContext<CoinAccountContextValue | null>(null);

export function CoinAccountProvider({ children }: React.PropsWithChildren) {
  const { user, status: authStatus } = useAuth();
  const userId = user?.id ?? null;
  const [balance, setBalance] = React.useState<CoinBalance | null>(null);
  const [supportedAssets, setSupportedAssets] =
    React.useState<SupportedMoneyAssetsPayload | null>(null);
  const [railsStatus, setRailsStatus] = React.useState<CoinAccountStatus>("loading");
  const [balanceStatus, setBalanceStatus] = React.useState<CoinAccountStatus>("loading");
  const [railsError, setRailsError] = React.useState<string | null>(null);
  const [balanceError, setBalanceError] = React.useState<string | null>(null);
  const activeUserIdRef = React.useRef<string | null>(userId);
  activeUserIdRef.current = userId;

  React.useEffect(() => {
    const controller = new AbortController();
    setRailsStatus("loading");
    setRailsError(null);

    void loadSupportedMoneyAssets(controller.signal)
      .then((payload) => {
        setSupportedAssets(payload);
        setRailsStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setSupportedAssets(null);
        setRailsStatus("error");
        setRailsError(
          error instanceof Error ? error.message : "Could not load supported money rails",
        );
      });

    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();

    if (authStatus === "loading") {
      setBalanceStatus("loading");
      return () => controller.abort();
    }

    if (authStatus !== "authenticated" || !userId) {
      setBalance(null);
      setBalanceStatus(authStatus === "error" ? "error" : "ready");
      setBalanceError(authStatus === "error" ? "Could not load account session." : null);
      return () => controller.abort();
    }

    const requestedUserId = userId;
    setBalanceStatus("loading");
    setBalanceError(null);
    void loadCoinBalance(controller.signal)
      .then((payload) => {
        if (activeUserIdRef.current !== requestedUserId) {
          return;
        }
        setBalance(payload);
        setBalanceStatus("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted || activeUserIdRef.current !== requestedUserId) {
          return;
        }
        setBalance(null);
        setBalanceStatus("error");
        setBalanceError(error instanceof Error ? error.message : "Could not load Coin balance");
      });

    return () => controller.abort();
  }, [authStatus, userId]);

  const refreshBalance = React.useCallback(async () => {
    const activeUserId = activeUserIdRef.current;
    if (!activeUserId) {
      setBalance(null);
      return null;
    }

    setBalanceStatus("loading");
    setBalanceError(null);
    try {
      const payload = await loadCoinBalance();
      if (activeUserIdRef.current === activeUserId) {
        setBalance(payload);
        setBalanceStatus("ready");
      }
      return payload;
    } catch (error) {
      if (activeUserIdRef.current === activeUserId) {
        setBalanceStatus("error");
        setBalanceError(error instanceof Error ? error.message : "Could not load Coin balance");
      }
      throw error;
    }
  }, []);

  const status: CoinAccountStatus =
    railsStatus === "error" || balanceStatus === "error"
      ? "error"
      : railsStatus === "loading" || balanceStatus === "loading"
        ? "loading"
        : "ready";
  const value = React.useMemo<CoinAccountContextValue>(
    () => ({
      balance,
      supportedAssets,
      status,
      error: balanceError ?? railsError,
      refreshBalance,
    }),
    [balance, balanceError, railsError, refreshBalance, status, supportedAssets],
  );

  return React.createElement(CoinAccountContext.Provider, { value }, children);
}

export function useCoinAccount() {
  const context = React.useContext(CoinAccountContext);
  if (!context) {
    throw new Error("useCoinAccount must be used within CoinAccountProvider.");
  }
  return context;
}
