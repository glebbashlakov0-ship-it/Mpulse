import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { MarketDetail } from "../components/MarketDetail";
import { useMarketDetail } from "../hooks/useMarketDetail";

export function MarketDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const state = useMarketDetail(id ?? "", null);

  if (!id) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {t("errors.notFound")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <button
          onClick={() => navigate("/")}
          className="mb-6 flex items-center gap-2 text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="size-5" />
          {t("market.back")}
        </button>

        {state.status === "loading" && (
          <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-500">{t("common.loading")}</p>
          </div>
        )}

        {state.status === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {t("errors.generic")}
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
    </div>
  );
}
