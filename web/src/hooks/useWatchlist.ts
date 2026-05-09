import * as React from "react";
import { deleteWatchlistMarket, loadWatchlist, saveWatchlistMarket } from "../lib/api";
import type { AuthUser, Market } from "../lib/types";

function getWatchlistStorageKey(user: AuthUser | null) {
  return `market-pulse:watchlist:${user?.id ?? "guest"}`;
}

function readWatchlist(key: string) {
  if (typeof window === "undefined") {
    return [] as Market[];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Market => Boolean(item?.id) && typeof item.id === "string")
      : [];
  } catch {
    return [];
  }
}

export function useWatchlist(user: AuthUser | null) {
  const storageKey = getWatchlistStorageKey(user);
  const [items, setItems] = React.useState<Market[]>(() => readWatchlist(storageKey));

  React.useEffect(() => {
    if (user) {
      let cancelled = false;
      loadWatchlist()
        .then((markets) => {
          if (!cancelled) {
            setItems(markets);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setItems(readWatchlist(storageKey));
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setItems(readWatchlist(storageKey));
  }, [storageKey, user]);

  React.useEffect(() => {
    if (typeof window !== "undefined" && !user) {
      window.localStorage.setItem(storageKey, JSON.stringify(items));
    }
  }, [items, storageKey, user]);

  const ids = React.useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const toggle = React.useCallback((market: Market) => {
    const shouldAdd = !ids.has(market.id);
    setItems((current) => {
      if (current.some((item) => item.id === market.id)) {
        return current.filter((item) => item.id !== market.id);
      } else {
        return [market, ...current].slice(0, 200);
      }
    });
    if (user) {
      void (shouldAdd ? saveWatchlistMarket(market) : deleteWatchlistMarket(market.id)).catch(
        () => loadWatchlist().then(setItems).catch(() => undefined),
      );
    }
  }, [ids, user]);

  const clear = React.useCallback(() => {
    if (user) {
      for (const item of items) {
        void deleteWatchlistMarket(item.id);
      }
    }
    setItems([]);
  }, [items, user]);

  return {
    ids,
    items,
    count: items.length,
    has: React.useCallback((marketId: string) => ids.has(marketId), [ids]),
    toggle,
    clear,
  };
}
