import * as React from "react";
import { useLocation, useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { MarketDetail } from "../components/MarketDetail";
import { MarketDetailSkeleton } from "../components/MarketSkeleton";
import { useAuth } from "../hooks/useAuth";
import { useMarketDetail } from "../hooks/useMarketDetail";
import type { Market } from "../lib/types";

export function MarketDetailPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const fallbackMarket = getFallbackMarket(location.state);
  const state = useMarketDetail(id ?? "", fallbackMarket);

  if (!id) {
    return (
      <div className="min-h-screen bg-[var(--pm-background)] text-[var(--pm-text-primary)]">
        <div className="mx-auto w-full max-w-[1350px] px-4 py-8 lg:px-6">
          <div className="rounded-xl border border-[#e23939]/25 bg-[#e23939]/10 p-4 text-[#991b1b]">
            {t("errors.notFound")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--pm-background)] text-[var(--pm-text-primary)]">
      {state.status === "loading" && (
        <MarketDetailSkeleton />
      )}

      {state.status === "error" && (
        <div className="mx-auto w-full max-w-[1350px] px-4 py-8 lg:px-6">
          <div className="rounded-xl border border-[#e23939]/25 bg-[#e23939]/10 p-4 text-[#991b1b]">
            {t("errors.generic")}
          </div>
        </div>
      )}

      {state.status === "ready" && state.data && (
        <MarketDetail
          canComment={Boolean(user)}
          isAuthenticated={Boolean(user)}
          market={state.data}
          detailStatus={state.status}
          onBack={() => navigate("/")}
          onDepositRequested={() => navigate("/wallet?action=deposit")}
          onLoginRequested={() => navigate("/auth?mode=login")}
        />
      )}
    </div>
  );
}

function getFallbackMarket(state: unknown): Market | null {
  if (
    state &&
    typeof state === "object" &&
    "market" in state &&
    state.market &&
    typeof state.market === "object" &&
    "id" in state.market &&
    typeof state.market.id === "string"
  ) {
    return state.market as Market;
  }

  return null;
}
