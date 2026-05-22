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
      <div className="min-h-screen bg-[#15191d] text-[#dee3e7]">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 xl:px-8">
          <div className="rounded-2xl border border-[#cb3131]/35 bg-[#330707]/35 p-4 text-[#daa]">
            {t("errors.notFound")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#15191d] text-[#dee3e7]">
      {state.status === "loading" && (
        <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 xl:px-8">
          <div className="rounded-2xl border border-[#242b32] bg-[#1e2428] p-12 text-center">
            <p className="text-[#7b8996]">{t("common.loading")}</p>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 xl:px-8">
          <div className="rounded-2xl border border-[#cb3131]/35 bg-[#330707]/35 p-4 text-[#daa]">
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
