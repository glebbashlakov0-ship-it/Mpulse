import { StrictMode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import { HomePage } from "./pages/HomePage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { MarketDetailPage } from "./pages/MarketDetailPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { WalletPage } from "./pages/WalletPage";
import { KYCPage } from "./pages/KYCPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AdminPage } from "./pages/AdminPage";
import { AuthPage } from "./pages/AuthPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { RequestPasswordResetPage } from "./pages/RequestPasswordResetPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { useWatchlist } from "./hooks/useWatchlist";
import {
  defaultMarketFilters,
  getDiscoveryUrl,
  getFiltersFromUrl,
  mergeDiscoveryFilters,
} from "./lib/discovery";
import "./i18n";
import "./styles.css";

declare global {
  interface Window {
    marketPulseRoot?: ReturnType<typeof createRoot>;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, status, logout } = useAuth();
  const watchlist = useWatchlist(user);
  const { i18n } = useTranslation();
  const headerFilters = React.useMemo(() => {
    const categoryMatch = location.pathname.match(/^\/markets\/category\/([^/]+)/);
    const topicMatch = location.pathname.match(/^\/markets\/topic\/([^/]+)/);

    return getFiltersFromUrl({
      searchParams: new URLSearchParams(location.search),
      category: categoryMatch?.[1],
      topic: topicMatch?.[1],
    });
  }, [location.pathname, location.search]);

  // Update document direction based on language
  React.useEffect(() => {
    const isRTL = i18n.language === "ar";
    document.documentElement.dir = isRTL ? "rtl" : "ltr";
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const openAuth = React.useCallback(
    (mode: "login" | "register") => {
      const currentPath = `${location.pathname}${location.search}${location.hash}`;
      const redirect = currentPath === "/auth" ? "/" : currentPath;
      const params = new URLSearchParams({ mode, redirect });
      navigate(`/auth?${params.toString()}`);
    },
    [location.hash, location.pathname, location.search, navigate],
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        query={headerFilters.search}
        filters={headerFilters}
        authStatus={status}
        user={user}
        watchlistCount={watchlist.count}
        onQueryChange={(query) =>
          navigate(getDiscoveryUrl(mergeDiscoveryFilters(headerFilters, { search: query })))
        }
        onPortfolioOpen={() => navigate("/portfolio")}
        onWatchlistOpen={() => navigate("/watchlist")}
        onLoginOpen={() => openAuth("login")}
        onSignupOpen={() => openAuth("register")}
        onProfileOpen={() => navigate("/profile")}
        onAdminOpen={() => navigate("/admin")}
        onPrimaryNavSelect={(item) =>
          navigate(getDiscoveryUrl(mergeDiscoveryFilters(defaultMarketFilters, item.filter)))
        }
        onMoreMarketsOpen={() => navigate("/markets")}
      />
      
      <main className="flex-1">
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                user={user}
                watchlistIds={watchlist.ids}
                onWatchlistToggle={watchlist.toggle}
              />
            }
          />
          <Route
            path="/markets"
            element={
              <HomePage
                user={user}
                watchlistIds={watchlist.ids}
                onWatchlistToggle={watchlist.toggle}
              />
            }
          />
          <Route
            path="/markets/category/:category"
            element={
              <HomePage
                user={user}
                watchlistIds={watchlist.ids}
                onWatchlistToggle={watchlist.toggle}
              />
            }
          />
          <Route
            path="/markets/topic/:topic"
            element={
              <HomePage
                user={user}
                watchlistIds={watchlist.ids}
                onWatchlistToggle={watchlist.toggle}
              />
            }
          />
          <Route
            path="/watchlist"
            element={
              <WatchlistPage
                user={user}
                markets={watchlist.items}
                onWatchlistToggle={watchlist.toggle}
                onClear={watchlist.clear}
              />
            }
          />
          <Route path="/markets/:id" element={<MarketDetailPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/kyc" element={<KYCPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/request-password-reset" element={<RequestPasswordResetPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <SiteFooter />
      <Toaster position="top-right" />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

const appRoot = window.marketPulseRoot ?? createRoot(root);
window.marketPulseRoot = appRoot;

appRoot.render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
