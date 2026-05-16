import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MarketDetail } from "../components/MarketDetail";
import { useMarketDetail } from "../hooks/useMarketDetail";

export function MarketDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const state = useMarketDetail(id ?? "", null);

  if (!id) {
    return (
      <div className="min-h-screen bg-[#0f1318] text-[#edf1f5]">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 xl:px-8">
          <div className="rounded-2xl border border-red-500/35 bg-red-950/35 p-4 text-red-200">
            {t("errors.notFound")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1318] text-[#edf1f5]">
      {state.status === "loading" && (
        <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 xl:px-8">
          <div className="rounded-2xl border border-[#293440] bg-[#171d24] p-12 text-center">
            <p className="text-[#8f9aa8]">{t("common.loading")}</p>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 xl:px-8">
          <div className="rounded-2xl border border-red-500/35 bg-red-950/35 p-4 text-red-200">
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
