import { StrictMode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { AuthModal } from "./components/AuthModal";
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

function RootApp() {
  const location = useLocation();

  if (location.pathname === "/admin" || location.pathname.startsWith("/admin/")) {
    return (
      <>
        <Routes>
          <Route path="/admin/*" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        <Toaster position="top-right" />
      </>
    );
  }

  return (
    <AuthProvider>
      <PublicApp />
    </AuthProvider>
  );
}

function PublicApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, status, login, register } = useAuth();
  const watchlist = useWatchlist(user);
  const { i18n } = useTranslation();
  const [authModalMode, setAuthModalMode] = React.useState<"login" | "register" | null>(null);
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

  React.useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  React.useLayoutEffect(() => {
    if (location.hash) {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.hash, location.pathname, location.search]);

  const openAuth = React.useCallback(
    (mode: "login" | "register") => {
      setAuthModalMode(mode);
    },
    [],
  );
  const closeAuth = React.useCallback(() => setAuthModalMode(null), []);
  const promptSignup = React.useCallback(() => setAuthModalMode("register"), []);
  const navigateFromHeader = React.useCallback(
    (to: string) => {
      navigate(to);
    },
    [navigate],
  );

  React.useEffect(() => {
    if (user && authModalMode) {
      setAuthModalMode(null);
    }
  }, [authModalMode, user]);

  React.useEffect(() => {
    if (!location.hash) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [location.hash]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        query={headerFilters.search}
        filters={headerFilters}
        authStatus={status}
        user={user}
        onQueryChange={(query) =>
          navigate(getDiscoveryUrl(mergeDiscoveryFilters(headerFilters, { search: query })))
        }
        onPortfolioOpen={() => navigate("/portfolio")}
        onLoginOpen={() => openAuth("login")}
        onSignupOpen={() => openAuth("register")}
        onProfileOpen={() => navigate("/profile")}
        onAdminOpen={() => navigate("/admin")}
        onMenuNavigate={navigateFromHeader}
        onPrimaryNavSelect={(item) =>
          navigate(getDiscoveryUrl(mergeDiscoveryFilters(defaultMarketFilters, item.filter)))
        }
      />
      
      <main className="flex-1">
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                user={user}
                watchlistIds={watchlist.ids}
                watchlistMarkets={watchlist.items}
                onWatchlistToggle={watchlist.toggle}
                onSignupPrompt={promptSignup}
              />
            }
          />
          <Route path="/markets/:id" element={<MarketDetailPage />} />
          <Route
            path="/markets"
            element={
              <HomePage
                user={user}
                watchlistIds={watchlist.ids}
                watchlistMarkets={watchlist.items}
                onWatchlistToggle={watchlist.toggle}
                onSignupPrompt={promptSignup}
              />
            }
          />
          <Route
            path="/markets/category/:category"
            element={
              <HomePage
                user={user}
                watchlistIds={watchlist.ids}
                watchlistMarkets={watchlist.items}
                onWatchlistToggle={watchlist.toggle}
                onSignupPrompt={promptSignup}
              />
            }
          />
          <Route
            path="/markets/topic/:topic"
            element={
              <HomePage
                user={user}
                watchlistIds={watchlist.ids}
                watchlistMarkets={watchlist.items}
                onWatchlistToggle={watchlist.toggle}
                onSignupPrompt={promptSignup}
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
      {authModalMode ? (
        <AuthModal
          mode={authModalMode}
          onModeChange={setAuthModalMode}
          onClose={closeAuth}
          onLogin={login}
          onRegister={register}
          onAuthenticated={closeAuth}
        />
      ) : null}
    </div>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

const savedTheme = window.localStorage.getItem("pulse-theme") === "light" ? "light" : "dark";
document.documentElement.dataset.theme = savedTheme;
document.documentElement.style.colorScheme = savedTheme;

const appRoot = window.marketPulseRoot ?? createRoot(root);
window.marketPulseRoot = appRoot;

appRoot.render(
  <StrictMode>
    <BrowserRouter>
      <RootApp />
    </BrowserRouter>
  </StrictMode>,
);
