import { Activity, Ban, EyeOff, LogOut, RefreshCw, Save, ShieldCheck, Undo2, Wallet } from "lucide-react";
import * as React from "react";
import {
  cancelAdminMarket,
  hideAdminMarket,
  loadAdminAuditLogs,
  loadAdminPanelSession,
  loadAdminUsers,
  loadAdminWithdrawals,
  loginAdminPanel,
  logoutAdminPanel,
  overrideAdminMarketOdds,
  rejectAdminWithdrawal,
  resolveAdminMarket,
  seedAdminEventActivity,
  seedAdminLedgerActivity,
  seedAdminMarketOddsHistory,
  unhideAdminMarket,
} from "../lib/api";
import { formatPercent, formatUsdt } from "../lib/format";
import type {
  AdminAuditPayload,
  AdminEventActivitySeedResult,
  AdminLedgerSeedActivityResult,
  AdminSeedOddsResult,
  AdminSettlementResult,
  AdminUsersPayload,
  AdminWithdrawalsPayload,
  HiddenMarketRule,
} from "../lib/types";

const adminReasons = ["legal_risk", "compliance", "sensitive_topic", "manual_review"] as const;

export function AdminPage() {
  const [adminSession, setAdminSession] = React.useState<{
    username: string;
    role: "super_admin";
    expiresAt: string;
  } | null>(null);
  const [sessionStatus, setSessionStatus] =
    React.useState<"loading" | "guest" | "authenticated" | "error">("loading");
  const [loginUsername, setLoginUsername] = React.useState("");
  const [loginPassword, setLoginPassword] = React.useState("");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = React.useState(false);
  const isAdmin = Boolean(adminSession);
  const canManageFinance = adminSession?.role === "super_admin";
  const [users, setUsers] = React.useState<AdminUsersPayload | null>(null);
  const [audit, setAudit] = React.useState<AdminAuditPayload | null>(null);
  const [withdrawals, setWithdrawals] = React.useState<AdminWithdrawalsPayload | null>(null);
  const [marketId, setMarketId] = React.useState("");
  const [settlementMarketId, setSettlementMarketId] = React.useState("");
  const [winningSide, setWinningSide] = React.useState<"yes" | "no">("yes");
  const [settlementResult, setSettlementResult] =
    React.useState<AdminSettlementResult | null>(null);
  const [reason, setReason] = React.useState<HiddenMarketRule["reason"]>("manual_review");
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const [oddsMarketId, setOddsMarketId] = React.useState("");
  const [seedForce, setSeedForce] = React.useState(false);
  const [seedPoints, setSeedPoints] = React.useState("260");
  const [seedVolatility, setSeedVolatility] = React.useState("0.12");
  const [seedResult, setSeedResult] = React.useState<AdminSeedOddsResult | null>(null);
  const [overrideOutcomes, setOverrideOutcomes] = React.useState<Array<{ name: string; percent: string }>>([]);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [financeUserIds, setFinanceUserIds] = React.useState<string[]>([]);
  const [financeKind, setFinanceKind] = React.useState<"deposit" | "payment">("deposit");
  const [financeAmountMin, setFinanceAmountMin] = React.useState("25");
  const [financeAmountMax, setFinanceAmountMax] = React.useState("250");
  const [financeCount, setFinanceCount] = React.useState("12");
  const [financeStartAt, setFinanceStartAt] = React.useState(() => toDatetimeLocal(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [financeEndAt, setFinanceEndAt] = React.useState(() => toDatetimeLocal(Date.now()));
  const [financePublicActivity, setFinancePublicActivity] = React.useState(true);
  const [financeResult, setFinanceResult] = React.useState<AdminLedgerSeedActivityResult | null>(null);
  const [eventMarketIds, setEventMarketIds] = React.useState("");
  const [eventFilterStatus, setEventFilterStatus] = React.useState<"live" | "upcoming" | "closed" | "expired">("live");
  const [eventFilterLimit, setEventFilterLimit] = React.useState("50");
  const [eventUserIds, setEventUserIds] = React.useState<string[]>([]);
  const [eventBetsMin, setEventBetsMin] = React.useState("8");
  const [eventBetsMax, setEventBetsMax] = React.useState("24");
  const [eventBetAmountMin, setEventBetAmountMin] = React.useState("5");
  const [eventBetAmountMax, setEventBetAmountMax] = React.useState("150");
  const [eventDepositMin, setEventDepositMin] = React.useState("50");
  const [eventDepositMax, setEventDepositMax] = React.useState("1200");
  const [eventDepositBuffer, setEventDepositBuffer] = React.useState("1.35");
  const [eventStartAt, setEventStartAt] = React.useState(() => toDatetimeLocal(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [eventEndAt, setEventEndAt] = React.useState(() => toDatetimeLocal(Date.now()));
  const [eventPublicActivity, setEventPublicActivity] = React.useState(true);
  const [eventForce, setEventForce] = React.useState(false);
  const [eventResult, setEventResult] = React.useState<AdminEventActivitySeedResult | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    loadAdminPanelSession(controller.signal)
      .then((session) => {
        setAdminSession(session.admin);
        setSessionStatus(session.authenticated ? "authenticated" : "guest");
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setSessionStatus("error");
        setLoginError(error instanceof Error ? error.message : "Could not load admin session");
      });

    return () => controller.abort();
  }, []);

  const refresh = React.useCallback(async () => {
    if (!isAdmin) {
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setMessage(null);
    try {
      const [nextUsers, nextAudit, nextWithdrawals] = await Promise.all([
        loadAdminUsers(controller.signal),
        loadAdminAuditLogs(controller.signal),
        loadAdminWithdrawals(controller.signal),
      ]);
      setUsers(nextUsers);
      setAudit(nextAudit);
      setWithdrawals(nextWithdrawals);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not load admin data");
    }

    return () => controller.abort();
  }, [isAdmin]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submitAdminLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    setLoginSubmitting(true);
    try {
      const session = await loginAdminPanel({
        username: loginUsername,
        password: loginPassword,
      });
      setAdminSession(session.admin);
      setSessionStatus(session.authenticated ? "authenticated" : "guest");
      setLoginPassword("");
    } catch (error) {
      setSessionStatus("guest");
      setLoginError(error instanceof Error ? error.message : "Could not sign in");
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function signOutAdmin() {
    setMessage(null);
    try {
      await logoutAdminPanel();
      setAdminSession(null);
      setUsers(null);
      setAudit(null);
      setWithdrawals(null);
      setSessionStatus("guest");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign out");
    }
  }

  async function rejectWithdrawal(id: string) {
    setMessage(null);
    try {
      await rejectAdminWithdrawal(id);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reject withdrawal");
    }
  }

  async function hideMarket() {
    if (!marketId.trim()) {
      setMessage("Market id is required.");
      return;
    }

    setMessage(null);
    try {
      const result = await hideAdminMarket(marketId.trim(), reason);
      setAudit((current) => current ? { ...current, hiddenMarkets: result.hiddenMarkets } : current);
      setMarketId("");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not hide market");
    }
  }

  async function unhideMarket(id: string) {
    setMessage(null);
    try {
      const result = await unhideAdminMarket(id);
      setAudit((current) => current ? { ...current, hiddenMarkets: result.hiddenMarkets } : current);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not unhide market");
    }
  }

  async function resolveMarket() {
    if (!settlementMarketId.trim()) {
      setMessage("Market id is required.");
      return;
    }

    setMessage(null);
    try {
      const result = await resolveAdminMarket({
        marketId: settlementMarketId.trim(),
        winningSide,
      });
      setSettlementResult(result);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not resolve market");
    }
  }

  async function cancelMarket() {
    if (!settlementMarketId.trim()) {
      setMessage("Market id is required.");
      return;
    }

    setMessage(null);
    try {
      const result = await cancelAdminMarket(settlementMarketId.trim());
      setSettlementResult(result);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel market");
    }
  }

  async function seedOddsHistory() {
    if (!oddsMarketId.trim()) {
      setMessage("Market id is required.");
      return;
    }

    setMessage(null);
    try {
      const result = await seedAdminMarketOddsHistory({
        marketId: oddsMarketId.trim(),
        force: seedForce,
        points: Number(seedPoints),
        volatility: Number(seedVolatility),
      });
      setSeedResult(result);
      setOverrideOutcomes(
        result.outcomes.map((outcome) => ({
          name: outcome.name,
          percent: outcome.price === null ? "" : String(Math.round(outcome.price * 10000) / 100),
        })),
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not seed market odds");
    }
  }

  async function saveOddsOverride() {
    if (!oddsMarketId.trim()) {
      setMessage("Market id is required.");
      return;
    }

    setMessage(null);
    try {
      const result = await overrideAdminMarketOdds({
        marketId: oddsMarketId.trim(),
        reason: overrideReason,
        outcomes: overrideOutcomes.map((outcome) => ({
          name: outcome.name,
          price: Number(outcome.percent) / 100,
        })),
      });
      setSeedResult((current) =>
        current
          ? {
              ...current,
              created: true,
              outcomes: result.outcomes,
              latestPoint: {
                id: result.point.id,
                capturedAt: result.point.capturedAt,
                volume: current.latestPoint?.volume ?? 0,
                liquidity: current.latestPoint?.liquidity ?? 0,
                source: result.point.source,
              },
            }
          : null,
      );
      setOverrideOutcomes(
        result.outcomes.map((outcome) => ({
          name: outcome.name,
          percent: outcome.price === null ? "" : String(Math.round(outcome.price * 10000) / 100),
        })),
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not override market odds");
    }
  }

  async function generateFinanceActivity() {
    if (financeUserIds.length === 0) {
      setMessage("Select at least one user.");
      return;
    }

    setMessage(null);
    try {
      const result = await seedAdminLedgerActivity({
        userIds: financeUserIds,
        kind: financeKind,
        amountMin: Number(financeAmountMin),
        amountMax: Number(financeAmountMax),
        count: Number(financeCount),
        startAt: new Date(financeStartAt).toISOString(),
        endAt: new Date(financeEndAt).toISOString(),
        publicActivity: financePublicActivity,
      });
      setFinanceResult(result);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate finance activity");
    }
  }

  async function generateEventActivity() {
    if (eventUserIds.length === 0) {
      setMessage("Select at least one user.");
      return;
    }

    const marketIds = eventMarketIds
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);

    setMessage(null);
    try {
      const result = await seedAdminEventActivity({
        marketIds,
        filters: {
          status: eventFilterStatus,
          limit: Number(eventFilterLimit),
        },
        userIds: eventUserIds,
        betsPerEventMin: Number(eventBetsMin),
        betsPerEventMax: Number(eventBetsMax),
        betAmountMin: Number(eventBetAmountMin),
        betAmountMax: Number(eventBetAmountMax),
        depositAmountMin: Number(eventDepositMin),
        depositAmountMax: Number(eventDepositMax),
        depositBufferMultiplier: Number(eventDepositBuffer),
        startAt: new Date(eventStartAt).toISOString(),
        endAt: new Date(eventEndAt).toISOString(),
        publicActivity: eventPublicActivity,
        force: eventForce,
      });
      setEventResult(result);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not seed event activity");
    }
  }

  function toggleFinanceUser(userId: string) {
    setFinanceUserIds((current) =>
      current.includes(userId)
        ? current.filter((candidate) => candidate !== userId)
        : [...current, userId],
    );
  }

  function toggleEventUser(userId: string) {
    setEventUserIds((current) =>
      current.includes(userId)
        ? current.filter((candidate) => candidate !== userId)
        : [...current, userId],
    );
  }

  if (sessionStatus === "loading") {
    return (
      <AdminLoginShell>
        <div className="rounded-lg border border-[#242b32] bg-[#171c20] px-6 py-5 text-sm font-semibold text-[#7b8996] shadow-2xl">
          Checking admin session...
        </div>
      </AdminLoginShell>
    );
  }

  if (!isAdmin) {
    return (
      <AdminLoginShell>
        <form
          className="w-full max-w-[360px] rounded-lg border border-[#242b32] bg-[#171c20] p-5 shadow-2xl"
          onSubmit={(event) => void submitAdminLogin(event)}
        >
          <h1 className="text-xl font-semibold tracking-normal text-[#dee3e7]">Admin</h1>
          <div className="mt-5 grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-[#7b8996]">Login</span>
              <input
                autoComplete="username"
                autoFocus
                className="h-11 rounded-md border border-[#242b32] bg-[#101418] px-3 text-sm font-semibold text-[#dee3e7] outline-none transition focus:border-[#0093fd]"
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-[#7b8996]">Password</span>
              <input
                autoComplete="current-password"
                className="h-11 rounded-md border border-[#242b32] bg-[#101418] px-3 text-sm font-semibold text-[#dee3e7] outline-none transition focus:border-[#0093fd]"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
            </label>
          </div>
          {loginError ? (
            <div className="mt-4 rounded-md border border-[#63323b] bg-[#24171a] px-3 py-2 text-sm font-semibold text-[#e09aa4]">
              {loginError}
            </div>
          ) : null}
          <button
            className="mt-5 flex h-11 w-full items-center justify-center rounded-md bg-[#0093fd] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
            disabled={loginSubmitting || !loginUsername.trim() || !loginPassword}
            type="submit"
          >
            {loginSubmitting ? "Signing in..." : "Log in"}
          </button>
        </form>
      </AdminLoginShell>
    );
  }

  return (
    <AdminShell title="Admin">
      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm font-semibold text-[#7b8996]">
        <span className="flex items-center gap-2 text-[#dee3e7]">
          <ShieldCheck size={18} />
          {adminSession?.username} · {adminSession?.role}
        </span>
        <button
          className="flex h-9 items-center gap-2 rounded-xl border border-[#242b32] px-3 text-sm font-semibold text-[#dee3e7] transition hover:border-[#0093fd]/70"
          onClick={() => void signOutAdmin()}
          type="button"
        >
          <LogOut size={15} />
          Logout
        </button>
        <span>Withdrawal requests are reviewed before processing.</span>
        {status === "loading" ? <span>Loading...</span> : null}
        {message ? <span className="text-[#d78282]">{message}</span> : null}
      </div>

      <section className="grid gap-4 lg:grid-cols-5">
        <Metric label="Users" value={String(users?.users.length ?? 0)} />
        {Object.entries(users?.summary ?? {}).map(([role, count]) => (
          <Metric key={role} label={role.replace("_", " ")} value={String(count)} />
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Odds & Charts">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_96px_110px]">
            <input
              className="h-12 min-w-0 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              placeholder="Market id"
              value={oddsMarketId}
              onChange={(event) => setOddsMarketId(event.target.value)}
            />
            <input
              className="h-12 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              min={12}
              max={720}
              type="number"
              value={seedPoints}
              onChange={(event) => setSeedPoints(event.target.value)}
            />
            <input
              className="h-12 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              min={0}
              max={0.35}
              step={0.01}
              type="number"
              value={seedVolatility}
              onChange={(event) => setSeedVolatility(event.target.value)}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[#7b8996]">
              <input
                checked={seedForce}
                className="size-4 accent-[#0093fd]"
                onChange={(event) => setSeedForce(event.target.checked)}
                type="checkbox"
              />
              Force regenerate
            </label>
            <button
              className="flex h-11 items-center gap-2 rounded-xl bg-[#0093fd] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManageFinance}
              onClick={() => void seedOddsHistory()}
              type="button"
            >
              <RefreshCw size={16} />
              Seed
            </button>
          </div>

          <div className="mt-4 grid max-h-[360px] gap-2 overflow-y-auto pr-1">
            {overrideOutcomes.length === 0 ? (
              <EmptyState text="Seed or load a market to edit outcomes." />
            ) : (
              overrideOutcomes.map((outcome, index) => (
                <div
                  className="grid gap-2 rounded-xl border border-[#242b32] bg-[#15191d] p-3 sm:grid-cols-[minmax(0,1fr)_120px]"
                  key={`${outcome.name}-${index}`}
                >
                  <span className="min-w-0 truncate text-sm font-semibold text-[#dee3e7]">
                    {outcome.name}
                  </span>
                  <label className="relative">
                    <input
                      className="h-10 w-full rounded-lg border border-[#242b32] bg-[#1e2428] px-3 pr-8 text-sm font-semibold text-[#dee3e7] outline-none"
                      min={0}
                      max={100}
                      step={0.01}
                      type="number"
                      value={outcome.percent}
                      onChange={(event) =>
                        setOverrideOutcomes((current) =>
                          current.map((candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, percent: event.target.value }
                              : candidate,
                          ),
                        )
                      }
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#7b8996]">
                      %
                    </span>
                  </label>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className="h-11 min-w-0 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              placeholder="Override reason"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
            />
            <button
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#30a159] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManageFinance || overrideOutcomes.length === 0}
              onClick={() => void saveOddsOverride()}
              type="button"
            >
              <Save size={16} />
              Save override
            </button>
          </div>

          {seedResult ? (
            <SummaryBox>
              <span>
                {seedResult.created ? "Created" : "Loaded"} {seedResult.pointCount} points for{" "}
                {seedResult.scope.scopeType} {seedResult.scope.scopeId}.
              </span>
              <span>
                Latest: {seedResult.outcomes.slice(0, 4).map((outcome) =>
                  `${outcome.name} ${formatPercent(outcome.price)}`
                ).join(" · ")}
              </span>
            </SummaryBox>
          ) : null}
        </Panel>

        <Panel title="Finance Activity">
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className="h-12 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              value={financeKind}
              onChange={(event) => setFinanceKind(event.target.value as "deposit" | "payment")}
            >
              <option value="deposit">Deposit</option>
              <option value="payment">Payment</option>
            </select>
            <label className="flex h-12 items-center gap-2 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#7b8996]">
              <input
                checked={financePublicActivity}
                className="size-4 accent-[#0093fd]"
                onChange={(event) => setFinancePublicActivity(event.target.checked)}
                type="checkbox"
              />
              Public activity
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <NumberField label="Min" value={financeAmountMin} onChange={setFinanceAmountMin} />
            <NumberField label="Max" value={financeAmountMax} onChange={setFinanceAmountMax} />
            <NumberField label="Count" value={financeCount} onChange={setFinanceCount} />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              className="h-12 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              type="datetime-local"
              value={financeStartAt}
              onChange={(event) => setFinanceStartAt(event.target.value)}
            />
            <input
              className="h-12 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              type="datetime-local"
              value={financeEndAt}
              onChange={(event) => setFinanceEndAt(event.target.value)}
            />
          </div>

          <div className="mt-4 grid max-h-[220px] gap-2 overflow-y-auto pr-1">
            {(users?.users ?? []).length === 0 ? (
              <EmptyState text="No users loaded." />
            ) : (
              users?.users.slice(0, 40).map((item) => (
                <label
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#242b32] bg-[#15191d] p-3 text-sm font-semibold text-[#dee3e7]"
                  key={item.id}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.displayName}</span>
                    <span className="block truncate text-xs text-[#7b8996]">{item.email}</span>
                  </span>
                  <input
                    checked={financeUserIds.includes(item.id)}
                    className="size-4 accent-[#0093fd]"
                    onChange={() => toggleFinanceUser(item.id)}
                    type="checkbox"
                  />
                </label>
              ))
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              className="flex h-11 items-center gap-2 rounded-xl border border-[#242b32] px-4 text-sm font-semibold text-[#dee3e7]"
              onClick={() => setFinanceUserIds((users?.users ?? []).slice(0, 5).map((item) => item.id))}
              type="button"
            >
              <Activity size={16} />
              Select first 5
            </button>
            <button
              className="flex h-11 items-center gap-2 rounded-xl bg-[#0093fd] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManageFinance}
              onClick={() => void generateFinanceActivity()}
              type="button"
            >
              <Wallet size={16} />
              Generate
            </button>
          </div>

          {financeResult ? (
            <SummaryBox>
              <span>
                Created {financeResult.summary.created} / {financeResult.summary.requested}
                {" "}entries. Skipped {financeResult.summary.skipped}, errors {financeResult.summary.errors}.
              </span>
              {financeResult.skipped.length > 0 ? (
                <span>{financeResult.skipped.length} payments skipped for insufficient balance.</span>
              ) : null}
            </SummaryBox>
          ) : null}
        </Panel>

        <Panel title="Seed Event Activity">
          <textarea
            className="min-h-24 w-full resize-y rounded-xl border border-[#242b32] bg-[#15191d] px-3 py-3 text-sm font-semibold text-[#dee3e7] outline-none"
            placeholder="Market ids, comma or newline separated"
            value={eventMarketIds}
            onChange={(event) => setEventMarketIds(event.target.value)}
          />

          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_120px]">
            <select
              className="h-12 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              value={eventFilterStatus}
              onChange={(event) => setEventFilterStatus(event.target.value as typeof eventFilterStatus)}
            >
              <option value="live">Live</option>
              <option value="upcoming">Upcoming</option>
              <option value="closed">Closed</option>
              <option value="expired">Expired</option>
            </select>
            <NumberField label="Limit" value={eventFilterLimit} onChange={setEventFilterLimit} />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <NumberField label="Bets min" value={eventBetsMin} onChange={setEventBetsMin} />
            <NumberField label="Bets max" value={eventBetsMax} onChange={setEventBetsMax} />
            <NumberField label="Bet min" value={eventBetAmountMin} onChange={setEventBetAmountMin} />
            <NumberField label="Bet max" value={eventBetAmountMax} onChange={setEventBetAmountMax} />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <NumberField label="Deposit min" value={eventDepositMin} onChange={setEventDepositMin} />
            <NumberField label="Deposit max" value={eventDepositMax} onChange={setEventDepositMax} />
            <NumberField label="Buffer" value={eventDepositBuffer} onChange={setEventDepositBuffer} step="0.05" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              className="h-12 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              type="datetime-local"
              value={eventStartAt}
              onChange={(event) => setEventStartAt(event.target.value)}
            />
            <input
              className="h-12 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              type="datetime-local"
              value={eventEndAt}
              onChange={(event) => setEventEndAt(event.target.value)}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-3">
            <label className="flex h-11 items-center gap-2 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#7b8996]">
              <input
                checked={eventPublicActivity}
                className="size-4 accent-[#0093fd]"
                onChange={(event) => setEventPublicActivity(event.target.checked)}
                type="checkbox"
              />
              Public activity
            </label>
            <label className="flex h-11 items-center gap-2 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#7b8996]">
              <input
                checked={eventForce}
                className="size-4 accent-[#0093fd]"
                onChange={(event) => setEventForce(event.target.checked)}
                type="checkbox"
              />
              Force
            </label>
          </div>

          <div className="mt-4 grid max-h-[220px] gap-2 overflow-y-auto pr-1">
            {(users?.users ?? []).length === 0 ? (
              <EmptyState text="No users loaded." />
            ) : (
              users?.users.slice(0, 40).map((item) => (
                <label
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#242b32] bg-[#15191d] p-3 text-sm font-semibold text-[#dee3e7]"
                  key={item.id}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{item.displayName}</span>
                    <span className="block truncate text-xs text-[#7b8996]">{item.email}</span>
                  </span>
                  <input
                    checked={eventUserIds.includes(item.id)}
                    className="size-4 accent-[#0093fd]"
                    onChange={() => toggleEventUser(item.id)}
                    type="checkbox"
                  />
                </label>
              ))
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              className="flex h-11 items-center gap-2 rounded-xl border border-[#242b32] px-4 text-sm font-semibold text-[#dee3e7]"
              onClick={() => setEventUserIds((users?.users ?? []).slice(0, 5).map((item) => item.id))}
              type="button"
            >
              <Activity size={16} />
              Select first 5
            </button>
            <button
              className="flex h-11 items-center gap-2 rounded-xl bg-[#0093fd] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!canManageFinance}
              onClick={() => void generateEventActivity()}
              type="button"
            >
              <Activity size={16} />
              Generate batch
            </button>
          </div>

          {eventResult ? (
            <SummaryBox>
              <span>
                Events {eventResult.summary.eventsProcessed}, trades {eventResult.summary.tradesCreated}
                {" "}of {eventResult.summary.plannedTrades}, deposits {eventResult.summary.depositsCreated}.
              </span>
              <span>
                Skipped {eventResult.summary.skipped}, errors {eventResult.summary.errors}.
              </span>
            </SummaryBox>
          ) : null}
        </Panel>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Withdrawal requests">
          <div className="grid gap-3">
            {(withdrawals?.withdrawalRequests ?? []).length === 0 ? (
              <EmptyState text="No withdrawal requests." />
            ) : (
              withdrawals?.withdrawalRequests.map((request) => (
                <div
                  className="rounded-2xl border border-[#242b32] bg-[#15191d] p-4"
                  key={request.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <strong className="block text-sm text-[#dee3e7]">
                        {request.amount} {request.asset} on {request.network}
                      </strong>
                      <span className="mt-1 block break-all text-xs font-medium text-[#7b8996]">
                        {request.destinationAddress}
                      </span>
                    </div>
                    <span className="rounded-full bg-[#1e2428] px-3 py-1 text-xs font-bold text-[#dee3e7]">
                      {request.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-[#7b8996]">
                    <span>
                      {request.realTransferBlocked
                        ? "Transfer unavailable"
                        : "Ready for review"}
                    </span>
                    <button
                      className="flex items-center gap-2 rounded-2xl border border-[#242b32] px-3 py-2 text-[#d78282] transition hover:border-[#d78282]/70"
                      disabled={request.status === "rejected"}
                      onClick={() => void rejectWithdrawal(request.id)}
                      type="button"
                    >
                      <Ban size={15} />
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Market settlement">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <input
              className="h-12 min-w-0 rounded-2xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              placeholder="Market id"
              value={settlementMarketId}
              onChange={(event) => setSettlementMarketId(event.target.value)}
            />
            <select
              className="h-12 rounded-2xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              value={winningSide}
              onChange={(event) => setWinningSide(event.target.value as "yes" | "no")}
            >
              <option value="yes">Yes wins</option>
              <option value="no">No wins</option>
            </select>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#30a159] px-4 text-sm font-semibold text-white"
              onClick={() => void resolveMarket()}
              type="button"
            >
              Resolve
            </button>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#242b32] px-4 text-sm font-semibold text-[#dee3e7]"
              onClick={() => void cancelMarket()}
              type="button"
            >
              Cancel / refund
            </button>
          </div>

          {settlementResult ? (
            <div className="mt-4 grid gap-3 rounded-2xl border border-[#242b32] bg-[#15191d] p-4 text-sm font-semibold text-[#7b8996]">
              <strong className="text-[#dee3e7]">
                {settlementResult.settlement.status} · {settlementResult.settlement.marketId}
              </strong>
              <span>Total pool: {formatUsdt(settlementResult.settlement.totalPool)}</span>
              <span>Platform fee: {formatUsdt(settlementResult.settlement.platformFee)}</span>
              <span>Payout total: {formatUsdt(settlementResult.balancing.payoutTotal)}</span>
              <span>
                Balancing check: {settlementResult.balancing.balanced ? "balanced" : "mismatch"}
              </span>
              <span>Payout rows: {settlementResult.payouts.length}</span>
            </div>
          ) : null}
        </Panel>

        <Panel title="Market moderation">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <input
              className="h-12 min-w-0 rounded-2xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              placeholder="Market id"
              value={marketId}
              onChange={(event) => setMarketId(event.target.value)}
            />
            <select
              className="h-12 rounded-2xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
              value={reason}
              onChange={(event) => setReason(event.target.value as HiddenMarketRule["reason"])}
            >
              {adminReasons.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <button
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#0093fd] px-4 text-sm font-semibold text-white"
              onClick={() => void hideMarket()}
              type="button"
            >
              <EyeOff size={17} />
              Hide
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            {(audit?.hiddenMarkets ?? []).length === 0 ? (
              <EmptyState text="No hidden markets in memory." />
            ) : (
              audit?.hiddenMarkets.map((rule) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#242b32] bg-[#15191d] p-4"
                  key={rule.id}
                >
                  <div>
                    <strong className="block text-sm text-[#dee3e7]">{rule.marketId}</strong>
                    <span className="mt-1 block text-xs font-semibold text-[#7b8996]">
                      {rule.reason}
                    </span>
                  </div>
                  <button
                    className="flex items-center gap-2 rounded-2xl border border-[#242b32] px-3 py-2 text-sm font-semibold text-[#dee3e7] transition hover:border-[#0093fd]/70"
                    onClick={() => void unhideMarket(rule.marketId)}
                    type="button"
                  >
                    <Undo2 size={15} />
                    Unhide
                  </button>
                </div>
              ))
            )}
          </div>
        </Panel>
      </section>

      <Panel title="Audit logs" className="mt-6">
        <div className="grid gap-2">
          {(audit?.auditLogs ?? []).length === 0 ? (
            <EmptyState text="No audit events." />
          ) : (
            audit?.auditLogs.slice(0, 40).map((event) => (
              <div
                className="grid gap-1 rounded-2xl border border-[#242b32] bg-[#15191d] p-3 text-xs"
                key={event.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-[#dee3e7]">{event.eventType}</strong>
                  <span className="font-semibold text-[#7b8996]">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
                <span className="break-all font-medium text-[#7b8996]">
                  user: {event.userId ?? "system"}
                </span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </AdminShell>
  );
}

function AdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#101418]">
      <section className="mx-auto w-full max-w-[1500px] overflow-x-hidden px-4 py-8 md:px-6 xl:px-8">
        <h1 className="text-3xl font-semibold tracking-normal text-[#dee3e7]">{title}</h1>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  );
}

function AdminLoginShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#101418] px-4 text-[#dee3e7]">
      {children}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#242b32] bg-[#1e2428] p-4">
      <span className="text-xs font-bold uppercase tracking-wide text-[#7b8996]">{label}</span>
      <strong className="mt-2 block text-2xl font-semibold text-[#dee3e7]">{value}</strong>
    </div>
  );
}

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-[#242b32] bg-[#1e2428] p-4 ${className}`}>
      <h2 className="mb-4 text-lg font-semibold text-[#dee3e7]">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#242b32] p-5 text-center text-sm font-semibold text-[#7b8996]">
      {text}
    </div>
  );
}

function SummaryBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 grid gap-1 rounded-xl border border-[#2a3b47] bg-[#15191d] p-3 text-sm font-semibold text-[#7b8996]">
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-bold uppercase tracking-wide text-[#7b8996]">{label}</span>
      <input
        className="h-11 rounded-xl border border-[#242b32] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none"
        min={0}
        step={step}
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function toDatetimeLocal(timestamp: number) {
  const date = new Date(timestamp);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;

  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}
