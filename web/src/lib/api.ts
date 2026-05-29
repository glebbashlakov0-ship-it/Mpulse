import type {
  ApiListResponse,
  ApiResponse,
  AdminAuditPayload,
  AdminEventActivitySeedResult,
  AdminLedgerSeedActivityResult,
  AdminOddsOverrideResult,
  AdminPanelSessionPayload,
  AdminSeedOddsResult,
  AdminSettlementResult,
  AdminUsersPayload,
  AdminWithdrawalsPayload,
  ComplianceEligibilityPayload,
  ComplianceMePayload,
  CreateDepositIntentPayload,
  CreateWithdrawalPayload,
  LedgerCreditPayload,
  AuthSessionInfo,
  AuthUser,
  HiddenMarketRule,
  LedgerBalancePayload,
  LedgerEntriesPayload,
  Market,
  MarketActivityPayload,
  MarketCategory,
  MarketTag,
  PlatformActivityPayload,
  Portfolio,
  TradingQuote,
  Trade,
  MyWalletPayload,
  TwoFactorSetup,
  TwoFactorStatus,
  UserSettings,
  WalletDepositsPayload,
  WithdrawalRequestsPayload,
} from "./types";

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { error?: { message?: string }; message?: string };
    return payload.error?.message ?? payload.message ?? fallback;
  } catch {
    return fallback;
  }
}

let csrfTokenPromise: Promise<string> | null = null;
let adminCsrfTokenPromise: Promise<string> | null = null;

async function loadCsrfToken(forceRefresh = false) {
  if (!csrfTokenPromise || forceRefresh) {
    csrfTokenPromise = globalThis
      .fetch("/api/auth/csrf", {
        credentials: "same-origin",
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readApiError(response, "Could not prepare secure request"));
        }

        const payload = (await response.json()) as ApiResponse<{ csrfToken: string }>;
        return payload.data.csrfToken;
      });
  }

  return csrfTokenPromise;
}

function isUnsafeMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  if (!isUnsafeMethod(method)) {
    return globalThis.fetch(input, init);
  }

  const headers = new Headers(init.headers);
  headers.set("X-CSRF-Token", await loadCsrfToken());
  const response = await globalThis.fetch(input, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers,
  });

  if (response.status !== 403) {
    return response;
  }

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("X-CSRF-Token", await loadCsrfToken(true));
  return globalThis.fetch(input, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers: retryHeaders,
  });
}

async function loadAdminCsrfToken(forceRefresh = false) {
  if (!adminCsrfTokenPromise || forceRefresh) {
    adminCsrfTokenPromise = globalThis
      .fetch("/api/admin/csrf", {
        credentials: "same-origin",
      })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readApiError(response, "Could not prepare admin request"));
        }

        const payload = (await response.json()) as ApiResponse<{ csrfToken: string }>;
        return payload.data.csrfToken;
      });
  }

  return adminCsrfTokenPromise;
}

async function adminApiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  if (!isUnsafeMethod(method)) {
    return globalThis.fetch(input, init);
  }

  const headers = new Headers(init.headers);
  headers.set("X-CSRF-Token", await loadAdminCsrfToken());
  const response = await globalThis.fetch(input, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers,
  });

  if (response.status !== 403) {
    return response;
  }

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("X-CSRF-Token", await loadAdminCsrfToken(true));
  return globalThis.fetch(input, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers: retryHeaders,
  });
}

function createIdempotencyKey(prefix: string) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${prefix}-${id}`;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10000,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const externalSignal = init.signal;
  const abortFromExternalSignal = () => controller.abort();

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  try {
    return await apiFetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut && error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

export async function loadPortfolio() {
  const response = await apiFetch("/api/trading/positions", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Could not load portfolio");
  }

  const payload = (await response.json()) as ApiResponse<Portfolio>;
  return payload.data;
}

export async function resetPortfolioApi() {
  const response = await apiFetch("/api/portfolio/reset", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Could not reset portfolio");
  }

  const payload = (await response.json()) as ApiResponse<Portfolio>;
  return payload.data;
}

export async function placeTradeApi({
  marketId,
  side,
  action,
  amount,
  shares,
}: {
  marketId: string;
  side: "yes" | "no";
  action?: "buy" | "sell";
  amount?: number;
  shares?: number;
}) {
  const idempotencyKey =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await apiFetch("/api/trading/orders", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ marketId, side, action: action ?? "buy", amount, shares }),
  });
  const payload = (await response.json()) as
    | ApiResponse<{
        ok: true;
        trade: Trade;
        portfolio: Portfolio;
        market: Market | null;
        idempotent: boolean;
      }>
    | { error?: { message?: string }; message?: string };

  if (!response.ok || !("data" in payload)) {
    const errorPayload = payload as { error?: { message?: string }; message?: string };
    throw new Error(
      errorPayload.message ?? errorPayload.error?.message ?? "Could not place trade",
    );
  }

  return payload.data;
}

export async function createTradingQuoteApi({
  marketId,
  side,
  action,
  amount,
  shares,
}: {
  marketId: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  amount?: number;
  shares?: number;
}) {
  const response = await apiFetch("/api/trading/quote", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ marketId, side, action, amount, shares }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not quote trade"));
  }

  const payload = (await response.json()) as ApiResponse<TradingQuote>;
  return payload.data;
}

export async function loadCurrentUser() {
  const response = await fetchWithTimeout("/api/auth/session", {
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load current user"));
  }

  const payload = (await response.json()) as ApiResponse<{ user: AuthUser | null }>;
  return payload.data.user;
}

export async function lookupAuthEmail(email: string) {
  const response = await fetchWithTimeout("/api/auth/lookup", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not check email"));
  }

  const payload = (await response.json()) as ApiResponse<{ exists: boolean }>;
  return payload.data.exists;
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName: string;
}) {
  const response = await apiFetch("/api/auth/register", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not create account"));
  }

  const payload = (await response.json()) as ApiResponse<{ user: AuthUser }>;
  return payload.data.user;
}

export async function loginUser(input: { email: string; password: string; twoFactorCode?: string }) {
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not log in"));
  }

  const payload = (await response.json()) as ApiResponse<{ user: AuthUser }>;
  return payload.data.user;
}

export async function verifyEmailToken(token: string) {
  const response = await apiFetch("/api/auth/verify-email", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Verification failed"));
  }
  const payload = (await response.json()) as ApiResponse<{ success: true }>;
  return payload.data;
}

export async function resendVerificationEmail() {
  const response = await apiFetch("/api/auth/resend-verification", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not send verification email"));
  }
}

export async function requestPasswordReset(email: string) {
  const response = await apiFetch("/api/auth/request-password-reset", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not request password reset"));
  }
  const payload = (await response.json()) as ApiResponse<{ success: true; message: string }>;
  return payload.data;
}

export async function resetPassword(input: { token: string; password: string }) {
  const response = await apiFetch("/api/auth/reset-password", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not reset password"));
  }
}

export async function loadAuthSessions() {
  const response = await apiFetch("/api/auth/sessions", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load sessions"));
  }
  const payload = (await response.json()) as ApiResponse<{ sessions: AuthSessionInfo[] }>;
  return payload.data.sessions;
}

export async function revokeAuthSession(id: string) {
  const response = await apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not revoke session"));
  }
}

export async function revokeOtherAuthSessions() {
  const response = await apiFetch("/api/auth/sessions/revoke-others", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not revoke sessions"));
  }
}

export async function revokeAllAuthSessions() {
  const response = await apiFetch("/api/auth/sessions/revoke-all", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not log out all devices"));
  }
}

export async function loadTwoFactorStatus() {
  const response = await apiFetch("/api/auth/2fa", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load 2FA status"));
  }
  const payload = (await response.json()) as ApiResponse<TwoFactorStatus>;
  return payload.data;
}

export async function startTwoFactorSetup() {
  const response = await apiFetch("/api/auth/2fa/setup", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not start 2FA setup"));
  }
  const payload = (await response.json()) as ApiResponse<TwoFactorSetup>;
  return payload.data;
}

export async function confirmTwoFactorSetup(code: string) {
  const response = await apiFetch("/api/auth/2fa/confirm", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not enable 2FA"));
  }
  const payload = (await response.json()) as ApiResponse<TwoFactorStatus>;
  return payload.data;
}

export async function disableTwoFactor(code: string) {
  const response = await apiFetch("/api/auth/2fa/disable", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not disable 2FA"));
  }
  const payload = (await response.json()) as ApiResponse<TwoFactorStatus>;
  return payload.data;
}

export async function regenerateTwoFactorBackupCodes(code: string) {
  const response = await apiFetch("/api/auth/2fa/backup-codes/regenerate", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not regenerate backup codes"));
  }
  const payload = (await response.json()) as ApiResponse<{
    backupCodes: string[];
    status: TwoFactorStatus;
  }>;
  return payload.data;
}

export async function logoutUser() {
  const response = await apiFetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not log out"));
  }
}

export async function updateMySettings(settings: Partial<UserSettings>) {
  const response = await apiFetch("/api/users/me/settings", {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not update settings"));
  }

  const payload = (await response.json()) as ApiResponse<{ user: AuthUser }>;
  return payload.data.user;
}

export async function loadMarketDetail(marketId: string, signal: AbortSignal) {
  const response = await apiFetch(`/api/markets/${encodeURIComponent(marketId)}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error("Market detail request failed");
  }

  const payload = (await response.json()) as ApiResponse<Market>;
  return payload.data;
}

export async function loadMarketActivity(
  marketId: string,
  signal: AbortSignal,
  marketIds: string[] = [],
) {
  const query = new URLSearchParams();
  if (marketIds.length > 1) {
    query.set("marketIds", marketIds.join(","));
  }
  const endpoint = `/api/markets/${encodeURIComponent(marketId)}/activity${
    query.size > 0 ? `?${query.toString()}` : ""
  }`;
  const response = await apiFetch(endpoint, {
    signal,
  });
  if (!response.ok) {
    throw new Error("Market activity request failed");
  }

  const payload = (await response.json()) as ApiResponse<MarketActivityPayload>;
  return payload.data;
}

export async function postMarketComment({
  body,
  marketId,
  positionLabel,
}: {
  body: string;
  marketId: string;
  positionLabel?: string | null;
}) {
  const response = await apiFetch(`/api/markets/${encodeURIComponent(marketId)}/comments`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body, positionLabel }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not post comment"));
  }

  const payload = (await response.json()) as ApiResponse<MarketActivityPayload>;
  return payload.data;
}

export async function loadMarkets(params: URLSearchParams, signal: AbortSignal) {
  const response = await apiFetch(`/api/markets?${params.toString()}`, {
    signal,
  });
  if (!response.ok) {
    throw new Error("Markets request failed");
  }

  const payload = (await response.json()) as ApiListResponse<Market[]>;
  return {
    data: payload.data,
    meta: payload.meta ?? null,
  };
}

export async function loadCategories(signal: AbortSignal) {
  const response = await apiFetch("/api/categories", { signal });
  if (!response.ok) {
    throw new Error("Categories request failed");
  }

  const payload = (await response.json()) as ApiResponse<MarketCategory[]>;
  return payload.data;
}

export async function loadTags(signal: AbortSignal) {
  const response = await apiFetch("/api/tags", { signal });
  if (!response.ok) {
    throw new Error("Tags request failed");
  }

  const payload = (await response.json()) as ApiResponse<MarketTag[]>;
  return payload.data;
}

export async function loadMyWallet() {
  const response = await apiFetch("/api/wallets/me", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load wallet"));
  }

  const payload = (await response.json()) as ApiResponse<MyWalletPayload>;
  return payload.data;
}

export async function createDepositIntent(input: {
  expectedAmount: number;
  memo?: string | null;
  reference?: string | null;
}) {
  const response = await apiFetch("/api/wallets/deposit-intents", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not create deposit instructions"));
  }

  const payload = (await response.json()) as ApiResponse<CreateDepositIntentPayload>;
  return payload.data;
}

export async function loadWalletDeposits() {
  const response = await apiFetch("/api/wallets/deposits", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load wallet deposits"));
  }

  const payload = (await response.json()) as ApiResponse<WalletDepositsPayload>;
  return payload.data;
}

export async function loadWithdrawalRequests() {
  const response = await apiFetch("/api/wallets/withdrawal-requests", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load withdrawal requests"));
  }

  const payload = (await response.json()) as ApiResponse<WithdrawalRequestsPayload>;
  return payload.data;
}

export async function createWithdrawalRequest(input: {
  amount: number;
  destinationAddress: string;
  idempotencyKey?: string;
}) {
  const idempotencyKey = input.idempotencyKey ?? createIdempotencyKey("withdrawal");
  const response = await apiFetch("/api/wallets/withdrawal-requests", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      asset: "USDT",
      network: "TRON",
      amount: input.amount,
      destinationAddress: input.destinationAddress,
      manualReview: true,
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not create withdrawal request"));
  }

  const payload = (await response.json()) as ApiResponse<CreateWithdrawalPayload>;
  return payload.data;
}

export async function loadComplianceProfile(signal?: AbortSignal) {
  const response = await fetchWithTimeout("/api/compliance/me", {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load verification profile"));
  }

  const payload = (await response.json()) as ApiResponse<ComplianceMePayload>;
  return payload.data;
}

export async function loadComplianceEligibility(signal?: AbortSignal) {
  const response = await fetchWithTimeout("/api/compliance/eligibility", {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load trading eligibility"));
  }

  const payload = (await response.json()) as ApiResponse<ComplianceEligibilityPayload>;
  return payload.data;
}

export async function updateComplianceProfile(input: {
  countryCode: string | null;
  dateOfBirth: string | null;
}) {
  const response = await apiFetch("/api/compliance/me", {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not update verification profile"));
  }

  const payload = (await response.json()) as ApiResponse<ComplianceMePayload>;
  return payload.data;
}

export async function acceptLegalAcknowledgements() {
  const response = await apiFetch("/api/compliance/accept-terms", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      termsVersion: "1.0.0",
      privacyVersion: "1.0.0",
      riskDisclosureVersion: "1.0.0",
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not save acknowledgements"));
  }

  const payload = (await response.json()) as ApiResponse<
    Pick<ComplianceMePayload, "legalConsents" | "acceptedVersions">
  >;
  return payload.data;
}

export async function loadLedgerBalance() {
  const response = await apiFetch("/api/ledger/balance?asset=USDT", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load ledger balance"));
  }

  const payload = (await response.json()) as ApiResponse<LedgerBalancePayload>;
  return payload.data;
}

export async function loadLedgerEntries(limit = 50) {
  const response = await apiFetch(`/api/ledger/entries?asset=USDT&limit=${encodeURIComponent(limit)}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load ledger entries"));
  }

  const payload = (await response.json()) as ApiResponse<LedgerEntriesPayload>;
  return payload.data;
}

export async function createLedgerCreditApi(amount: number, idempotencyKey = createIdempotencyKey("ledger-credit")) {
  const response = await apiFetch("/api/ledger/credits", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      amount,
      metadata: {
        source: "wallet_page",
      },
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not update balance"));
  }

  const payload = (await response.json()) as ApiResponse<LedgerCreditPayload>;
  return payload.data;
}

export async function loadWatchlist() {
  const response = await apiFetch("/api/watchlist", {
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load watchlist"));
  }
  const payload = (await response.json()) as ApiResponse<{ markets: Market[] }>;
  return payload.data.markets;
}

export async function saveWatchlistMarket(market: Market) {
  const response = await apiFetch(`/api/watchlist/${encodeURIComponent(market.id)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ market }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not update watchlist"));
  }
}

export async function deleteWatchlistMarket(marketId: string) {
  const response = await apiFetch(`/api/watchlist/${encodeURIComponent(marketId)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not update watchlist"));
  }
}

export async function loadAdminUsers(signal: AbortSignal) {
  const response = await adminApiFetch("/api/admin/users", {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load admin users"));
  }

  const payload = (await response.json()) as ApiResponse<AdminUsersPayload>;
  return payload.data;
}

export async function loadAdminPanelSession(signal?: AbortSignal) {
  const response = await adminApiFetch("/api/admin/session", {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load admin session"));
  }

  const payload = (await response.json()) as ApiResponse<AdminPanelSessionPayload>;
  return payload.data;
}

export async function loginAdminPanel(input: { username: string; password: string }) {
  const response = await adminApiFetch("/api/admin/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not sign in"));
  }

  const payload = (await response.json()) as ApiResponse<AdminPanelSessionPayload>;
  return payload.data;
}

export async function logoutAdminPanel() {
  const response = await adminApiFetch("/api/admin/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not sign out"));
  }

  const payload = (await response.json()) as ApiResponse<AdminPanelSessionPayload>;
  return payload.data;
}

export async function loadAdminAuditLogs(signal: AbortSignal) {
  const response = await adminApiFetch("/api/admin/audit-logs", {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load admin audit logs"));
  }

  const payload = (await response.json()) as ApiResponse<AdminAuditPayload>;
  return payload.data;
}

export async function loadAdminWithdrawals(signal: AbortSignal) {
  const response = await adminApiFetch("/api/admin/wallet-withdrawals", {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load admin withdrawals"));
  }

  const payload = (await response.json()) as ApiResponse<AdminWithdrawalsPayload>;
  return payload.data;
}

export async function rejectAdminWithdrawal(id: string) {
  const response = await adminApiFetch(`/api/admin/wallet-withdrawals/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not reject withdrawal"));
  }

  const payload = (await response.json()) as ApiResponse<{
    withdrawalRequest: AdminWithdrawalsPayload["withdrawalRequests"][number];
    realTransferBlocked: true;
    mode: "wallet_review_only";
  }>;
  return payload.data;
}

export async function hideAdminMarket(id: string, reason: HiddenMarketRule["reason"]) {
  const response = await adminApiFetch(`/api/admin/markets/${encodeURIComponent(id)}/hide`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not hide market"));
  }

  const payload = (await response.json()) as ApiResponse<{
    hiddenMarkets: HiddenMarketRule[];
    realTransferBlocked: true;
    mode: "wallet_review_only";
  }>;
  return payload.data;
}

export async function unhideAdminMarket(id: string) {
  const response = await adminApiFetch(`/api/admin/markets/${encodeURIComponent(id)}/unhide`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not unhide market"));
  }

  const payload = (await response.json()) as ApiResponse<{
    hiddenMarkets: HiddenMarketRule[];
    realTransferBlocked: true;
    mode: "wallet_review_only";
  }>;
  return payload.data;
}

export async function resolveAdminMarket(input: {
  marketId: string;
  winningSide: "yes" | "no";
}) {
  const response = await adminApiFetch(`/api/admin/markets/${encodeURIComponent(input.marketId)}/resolve`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": createIdempotencyKey("settlement"),
    },
    body: JSON.stringify({ winningSide: input.winningSide }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not resolve market"));
  }

  const payload = (await response.json()) as ApiResponse<AdminSettlementResult>;
  return payload.data;
}

export async function cancelAdminMarket(marketId: string) {
  const response = await adminApiFetch(`/api/admin/markets/${encodeURIComponent(marketId)}/cancel`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": createIdempotencyKey("settlement-cancel"),
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not cancel market"));
  }

  const payload = (await response.json()) as ApiResponse<AdminSettlementResult>;
  return payload.data;
}

export async function seedAdminMarketOddsHistory(input: {
  marketId: string;
  force?: boolean;
  points?: number;
  volatility?: number;
}) {
  const response = await adminApiFetch(
    `/api/admin/markets/${encodeURIComponent(input.marketId)}/seed-odds-history`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        force: input.force,
        points: input.points,
        volatility: input.volatility,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not seed market odds"));
  }

  const payload = (await response.json()) as ApiResponse<AdminSeedOddsResult>;
  return payload.data;
}

export async function overrideAdminMarketOdds(input: {
  marketId: string;
  outcomes: Array<{ name: string; price: number }>;
  reason?: string;
}) {
  const response = await adminApiFetch(`/api/admin/markets/${encodeURIComponent(input.marketId)}/odds`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      outcomes: input.outcomes,
      reason: input.reason,
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not override market odds"));
  }

  const payload = (await response.json()) as ApiResponse<AdminOddsOverrideResult>;
  return payload.data;
}

export async function seedAdminLedgerActivity(input: {
  userIds: string[];
  kind: "deposit" | "payment";
  amountMin: number;
  amountMax: number;
  count: number;
  startAt: string;
  endAt: string;
  publicActivity: boolean;
}) {
  const response = await adminApiFetch("/api/admin/ledger/seed-activity", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not seed ledger activity"));
  }

  const payload = (await response.json()) as ApiResponse<AdminLedgerSeedActivityResult>;
  return payload.data;
}

export async function seedAdminEventActivity(input: {
  batchId?: string;
  marketIds: string[];
  filters: { status: "live" | "upcoming" | "closed" | "expired"; limit: number };
  userIds: string[];
  betsPerEventMin: number;
  betsPerEventMax: number;
  betAmountMin: number;
  betAmountMax: number;
  depositAmountMin: number;
  depositAmountMax: number;
  depositBufferMultiplier: number;
  startAt: string;
  endAt: string;
  publicActivity: boolean;
  force: boolean;
}) {
  const response = await adminApiFetch("/api/admin/markets/seed-event-activity", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not seed event activity"));
  }

  const payload = (await response.json()) as ApiResponse<AdminEventActivitySeedResult>;
  return payload.data;
}

export async function loadPlatformActivity(limit = 30, signal?: AbortSignal) {
  const response = await apiFetch(`/api/platform/activity?limit=${encodeURIComponent(String(limit))}`, {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, "Could not load platform activity"));
  }

  const payload = (await response.json()) as ApiResponse<PlatformActivityPayload>;
  return payload.data;
}
