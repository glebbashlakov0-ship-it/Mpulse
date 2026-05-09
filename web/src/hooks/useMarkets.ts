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
    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const params = buildMarketSearchParams(deferredFilters, { limit: pageSize });

    setState((current) => ({
      ...current,
      status: "loading",
      data: [],
      total: null,
      nextOffset: null,
      message: null,
      isLoadingMore: false,
    }));

    loadMarkets(params, controller.signal)
      .then((result) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        const total = result.meta?.total ?? result.data.length;
        setState({
          status: "ready",
          data: withUniqueImages(result.data),
          total,
          nextOffset: getNextOffset({
            currentOffset: 0,
            received: result.data.length,
            total,
          }),
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

    return () => controller.abort();
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
      const result = await loadMarkets(params, new AbortController().signal);
      if (requestIdRef.current !== requestId) {
        return;
      }

      setState((current) => ({
        status: "ready",
        data: withUniqueImages([...current.data, ...result.data]),
        total: result.meta?.total ?? current.total,
        nextOffset: getNextOffset({
          currentOffset,
          received: result.data.length,
          total: result.meta?.total ?? current.total,
        }),
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

  return [state satisfies MarketsState, setState, loadMore] as const;
}
