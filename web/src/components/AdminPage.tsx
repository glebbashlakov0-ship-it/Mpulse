import { Ban, EyeOff, ShieldCheck, Undo2 } from "lucide-react";
import * as React from "react";
import {
  hideAdminMarket,
  loadAdminAuditLogs,
  loadAdminUsers,
  loadAdminWithdrawals,
  rejectAdminWithdrawal,
  unhideAdminMarket,
} from "../lib/api";
import type {
  AdminAuditPayload,
  AdminUsersPayload,
  AdminWithdrawalsPayload,
  AuthUser,
  HiddenMarketRule,
} from "../lib/types";

const adminReasons = ["legal_risk", "compliance", "sensitive_topic", "manual_review"] as const;

export function AdminPage({
  user,
  authStatus,
  onOpenLogin,
}: {
  user: AuthUser | null;
  authStatus: "loading" | "guest" | "authenticated" | "error";
  onOpenLogin: () => void;
}) {
  const isAdmin = Boolean(user && user.role !== "user");
  const [users, setUsers] = React.useState<AdminUsersPayload | null>(null);
  const [audit, setAudit] = React.useState<AdminAuditPayload | null>(null);
  const [withdrawals, setWithdrawals] = React.useState<AdminWithdrawalsPayload | null>(null);
  const [marketId, setMarketId] = React.useState("");
  const [reason, setReason] = React.useState<HiddenMarketRule["reason"]>("manual_review");
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);

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

  if (authStatus === "loading") {
    return <AdminShell title="Admin">Checking session...</AdminShell>;
  }

  if (!isAdmin) {
    return (
      <AdminShell title="Access denied">
        <div className="rounded-2xl border border-[#293440] bg-[#171d24] p-6">
          <p className="text-sm font-medium text-[#8f9aa8]">
            Admin access requires an assigned admin role.
          </p>
          {authStatus !== "authenticated" ? (
            <button
              className="mt-4 rounded-2xl bg-[#3b91f6] px-4 py-3 text-sm font-semibold text-white"
              onClick={onOpenLogin}
              type="button"
            >
              Log In
            </button>
          ) : null}
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Admin">
      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm font-semibold text-[#8f9aa8]">
        <span className="flex items-center gap-2 text-[#edf1f5]">
          <ShieldCheck size={18} />
          {user?.role}
        </span>
        <span>Transfers are not available yet.</span>
        {status === "loading" ? <span>Loading...</span> : null}
        {message ? <span className="text-[#ffb4b4]">{message}</span> : null}
      </div>

      <section className="grid gap-4 lg:grid-cols-5">
        <Metric label="Users" value={String(users?.users.length ?? 0)} />
        {Object.entries(users?.summary ?? {}).map(([role, count]) => (
          <Metric key={role} label={role.replace("_", " ")} value={String(count)} />
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Withdrawal requests">
          <div className="grid gap-3">
            {(withdrawals?.withdrawalRequests ?? []).length === 0 ? (
              <EmptyState text="No withdrawal requests." />
            ) : (
              withdrawals?.withdrawalRequests.map((request) => (
                <div
                  className="rounded-2xl border border-[#293440] bg-[#0f1318] p-4"
                  key={request.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <strong className="block text-sm text-[#edf1f5]">
                        {request.amount} {request.asset} on {request.network}
                      </strong>
                      <span className="mt-1 block break-all text-xs font-medium text-[#8f9aa8]">
                        {request.destinationAddress}
                      </span>
                    </div>
                    <span className="rounded-full bg-[#171d24] px-3 py-1 text-xs font-bold text-[#edf1f5]">
                      {request.status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-[#8f9aa8]">
                    <span>
                      {request.realTransferBlocked
                        ? "Transfer unavailable"
                        : "Ready for review"}
                    </span>
                    <button
                      className="flex items-center gap-2 rounded-2xl border border-[#293440] px-3 py-2 text-[#ffb4b4] transition hover:border-[#ffb4b4]/70"
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

        <Panel title="Market moderation">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <input
              className="h-12 min-w-0 rounded-2xl border border-[#293440] bg-[#0f1318] px-3 text-sm font-semibold text-[#edf1f5] outline-none"
              placeholder="Market id"
              value={marketId}
              onChange={(event) => setMarketId(event.target.value)}
            />
            <select
              className="h-12 rounded-2xl border border-[#293440] bg-[#0f1318] px-3 text-sm font-semibold text-[#edf1f5] outline-none"
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
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#3b91f6] px-4 text-sm font-semibold text-white"
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#293440] bg-[#0f1318] p-4"
                  key={rule.id}
                >
                  <div>
                    <strong className="block text-sm text-[#edf1f5]">{rule.marketId}</strong>
                    <span className="mt-1 block text-xs font-semibold text-[#8f9aa8]">
                      {rule.reason}
                    </span>
                  </div>
                  <button
                    className="flex items-center gap-2 rounded-2xl border border-[#293440] px-3 py-2 text-sm font-semibold text-[#edf1f5] transition hover:border-[#3b91f6]/70"
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
                className="grid gap-1 rounded-2xl border border-[#293440] bg-[#0f1318] p-3 text-xs"
                key={event.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm text-[#edf1f5]">{event.eventType}</strong>
                  <span className="font-semibold text-[#8f9aa8]">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                </div>
                <span className="break-all font-medium text-[#8f9aa8]">
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
    <section className="mx-auto w-full max-w-[1500px] overflow-x-hidden px-4 py-8 md:px-6 xl:px-8">
      <h1 className="text-3xl font-semibold tracking-normal text-[#edf1f5]">{title}</h1>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#293440] bg-[#171d24] p-4">
      <span className="text-xs font-bold uppercase tracking-wide text-[#8f9aa8]">{label}</span>
      <strong className="mt-2 block text-2xl font-semibold text-[#edf1f5]">{value}</strong>
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
    <section className={`min-w-0 rounded-2xl border border-[#293440] bg-[#171d24] p-4 ${className}`}>
      <h2 className="mb-4 text-lg font-semibold text-[#edf1f5]">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#293440] p-5 text-center text-sm font-semibold text-[#8f9aa8]">
      {text}
    </div>
  );
}
