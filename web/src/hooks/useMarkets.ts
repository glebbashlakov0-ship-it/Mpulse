import * as React from "react";
import { loadMarkets } from "../lib/api";
import { buildMarketSearchParams, DISCOVERY_PAGE_SIZE } from "../lib/discovery";
import { withUniqueImages } from "../lib/market";
import type { Market, MarketFilters } from "../lib/types";

type MarketsState = {
  status: "loading" | "ready" | "error";
  data: Market[];
  total: number | null;
  nextOffset: number | null;
  message: string | null;
  isLoadingMore: boolean;
};

type MarketsPage = Pick<MarketsState, "data" | "nextOffset" | "total">;

type MarketsPageCacheEntry = {
  promise?: Promise<MarketsPage>;
  updatedAt: number;
  value?: MarketsPage;
};

const marketPageCache = new Map<string, MarketsPageCacheEntry>();
const marketPageCacheMaxAgeMs = 5 * 60 * 1000;
const marketPageRevalidateMs = 30_000;
const marketPageCacheLimit = 80;

function getNextOffset({
  currentOffset,
  received,
  total,
}: {
  currentOffset: number;
  received: number;
  total: number | null;
}) {
  const nextOffset = currentOffset + received;
  return received > 0 && total !== null && nextOffset < total ? nextOffset : null;
}

function getMarketPageCacheKey(params: URLSearchParams) {
  return params.toString();
}

function getOffsetParam(params: URLSearchParams) {
  const parsed = Number(params.get("offset") ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toMarketsPage(params: URLSearchParams, result: Awaited<ReturnType<typeof loadMarkets>>): MarketsPage {
  const currentOffset = getOffsetParam(params);
  const total = result.meta?.total ?? currentOffset + result.data.length;

  return {
    data: withUniqueImages(result.data),
    total,
    nextOffset: getNextOffset({
      currentOffset,
      received: result.data.length,
      total,
    }),
  };
}

function readMarketsPageCache(cacheKey: string) {
  const cached = marketPageCache.get(cacheKey);

  if (!cached?.value || Date.now() - cached.updatedAt > marketPageCacheMaxAgeMs) {
    return null;
  }

  return cached.value;
}

function shouldRevalidateMarketsPage(cacheKey: string) {
  const cached = marketPageCache.get(cacheKey);

  return !cached?.value || Date.now() - cached.updatedAt > marketPageRevalidateMs;
}

function rememberMarketsPage(cacheKey: string, value: MarketsPage) {
  marketPageCache.set(cacheKey, {
    updatedAt: Date.now(),
    value,
  });

  if (marketPageCache.size <= marketPageCacheLimit) {
    return;
  }

  const oldestKey = [...marketPageCache.entries()]
    .sort(([, left], [, right]) => left.updatedAt - right.updatedAt)[0]?.[0];

  if (oldestKey) {
    marketPageCache.delete(oldestKey);
  }
}

function requestMarketsPage(params: URLSearchParams) {
  const cacheKey = getMarketPageCacheKey(params);
  const cached = marketPageCache.get(cacheKey);

  if (cached?.promise) {
    return cached.promise;
  }

  const promise = loadMarkets(params, new AbortController().signal)
    .then((result) => {
      const page = toMarketsPage(params, result);
      rememberMarketsPage(cacheKey, page);
      return page;
    })
    .finally(() => {
      const current = marketPageCache.get(cacheKey);

      if (current?.promise === promise) {
        marketPageCache.set(cacheKey, {
          updatedAt: current.updatedAt,
          value: current.value,
        });
      }
    });

  marketPageCache.set(cacheKey, {
    promise,
    updatedAt: cached?.updatedAt ?? 0,
    value: cached?.value,
  });

  return promise;
}

export function useMarkets(
  filters: MarketFilters,
  { pageSize = DISCOVERY_PAGE_SIZE }: { pageSize?: number } = {},
) {
  const [state, setState] = React.useState<MarketsState>({
    status: "loading",
    data: [],
    total: null,
    nextOffset: null,
    message: null,
    isLoadingMore: false,
  });

  const deferredFilters = React.useDeferredValue(filters);
  const requestIdRef = React.useRef(0);

  React.useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const params = buildMarketSearchParams(deferredFilters, { limit: pageSize });
    const cacheKey = getMarketPageCacheKey(params);
    const cachedPage = readMarketsPageCache(cacheKey);

    if (cachedPage) {
      setState({
        status: "ready",
        data: cachedPage.data,
        total: cachedPage.total,
        nextOffset: cachedPage.nextOffset,
        message: null,
        isLoadingMore: false,
      });
    } else {
      setState((current) => ({
        ...current,
        status: "loading",
        data: [],
        total: null,
        nextOffset: null,
        message: null,
        isLoadingMore: false,
      }));
    }

    if (cachedPage && !shouldRevalidateMarketsPage(cacheKey)) {
      return undefined;
    }

    requestMarketsPage(params)
      .then((page) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setState({
          status: "ready",
          data: page.data,
          total: page.total,
          nextOffset: page.nextOffset,
          message: null,
          isLoadingMore: false,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (requestIdRef.current !== requestId) {
          return;
        }

        setState({
          status: "error",
          data: [],
          total: null,
          nextOffset: null,
          message: error instanceof Error ? error.message : "Could not load markets",
          isLoadingMore: false,
        });
      });

    return undefined;
  }, [deferredFilters, pageSize]);

  const loadMore = React.useCallback(async () => {
    if (state.nextOffset === null || state.isLoadingMore || state.status === "loading") {
      return;
    }

    const requestId = requestIdRef.current;
    const currentOffset = state.nextOffset;
    const params = buildMarketSearchParams(deferredFilters, {
      limit: pageSize,
      offset: currentOffset,
    });

    setState((current) => ({
      ...current,
      isLoadingMore: true,
      message: null,
    }));

    try {
      const result = await requestMarketsPage(params);
      if (requestIdRef.current !== requestId) {
        return;
      }

      setState((current) => ({
        status: "ready",
        data: withUniqueImages([...current.data, ...result.data]),
        total: result.total,
        nextOffset: result.nextOffset,
        message: null,
        isLoadingMore: false,
      }));
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }

      setState((current) => ({
        ...current,
        status: "error",
        message: error instanceof Error ? error.message : "Could not load more markets",
        isLoadingMore: false,
      }));
    }
  }, [deferredFilters, pageSize, state.isLoadingMore, state.nextOffset, state.status]);

  React.useEffect(() => {
    if (state.status !== "ready" || state.nextOffset === null) {
      return undefined;
    }

    const params = buildMarketSearchParams(deferredFilters, {
      limit: pageSize,
      offset: state.nextOffset,
    });
    const cacheKey = getMarketPageCacheKey(params);

    if (!shouldRevalidateMarketsPage(cacheKey)) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      requestMarketsPage(params).catch(() => {
        // Prefetch is opportunistic; the explicit load-more path reports errors.
      });
    }, 150);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [deferredFilters, pageSize, state.nextOffset, state.status]);

  return [state satisfies MarketsState, setState, loadMore] as const;
}
