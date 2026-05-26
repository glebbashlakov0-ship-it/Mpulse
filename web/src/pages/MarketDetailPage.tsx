import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MarketDetail } from "../components/MarketDetail";
import { MarketDetailSkeleton } from "../components/MarketSkeleton";
import { useMarketDetail } from "../hooks/useMarketDetail";

export function MarketDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const state = useMarketDetail(id ?? "", null);

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
          market={state.data}
          detailStatus={state.status}
          onBack={() => navigate("/")}
        />
      )}
    </div>
  );
}
