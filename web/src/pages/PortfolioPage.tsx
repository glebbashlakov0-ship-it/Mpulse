import * as React from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { PortfolioPage as PortfolioComponent } from "../components/PortfolioPage";
import { useMarkets } from "../hooks/useMarkets";

const defaultFilters = {
  search: "",
  category: "",
  topic: "all" as const,
  sort: "trending" as const,
  status: "live" as const,
  minVolume: "",
  maxVolume: "",
  closingAfter: "",
  closingBefore: "",
};

export function PortfolioPage() {
  const navigate = useNavigate();
  const [marketsState] = useMarkets(defaultFilters);

  return (
    <PortfolioComponent
      markets={marketsState.data}
      marketsStatus={marketsState.status}
      onBack={() => navigate("/")}
      onOpenMarketId={(marketId) => navigate(`/markets/${marketId}`)}
    />
  );
}
