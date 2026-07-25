import * as React from "react";
import {
  approveAdminMoneyWithdrawal,
  createAdminCoinCorrection,
  loadAdminMoneyDepositDetail,
  loadAdminMoneyDeposits,
  loadAdminMoneyUser,
  loadAdminMoneyWithdrawals,
  rejectAdminMoneyWithdrawal,
  retryAdminMoneyDeposit,
  retryAdminMoneyWithdrawal,
} from "../lib/api";
import {
  formatAssetAmount,
  formatCoinMicros,
  formatRelativeTime,
  formatSignedCoinMicros,
  parseSignedCoinInputToMicros,
} from "../lib/format";
import type {
  AdminMoneyDepositDetailPayload,
  AdminMoneyDepositsPayload,
  AdminMoneyUserPayload,
  AdminMoneyWithdrawalsPayload,
  AuthUser,
  CoinDeposit,
  WithdrawalRequest,
} from "../lib/types";

type AdminMoneyPanelProps = {
  users: AuthUser[];
  canManageFinance: boolean;
};

const panelClass = "rounded-3xl border border-[#242b32] bg-[#1e2428] p-5";
const inputClass =
  "h-11 rounded-xl border border-[#2e3841] bg-[#15191d] px-3 text-sm font-semibold text-[#dee3e7] outline-none focus:border-[#0093fd]";

export function AdminMoneyPanel({
  users,
  canManageFinance,
}: AdminMoneyPanelProps) {
  const [query, setQuery] = React.useState("");
  const [selectedUserId, setSelectedUserId] = React.useState("");
  const [userMoney, setUserMoney] = React.useState<AdminMoneyUserPayload | null>(null);
  const [deposits, setDeposits] = React.useState<AdminMoneyDepositsPayload | null>(null);
  const [withdrawals, setWithdrawals] =
    React.useState<AdminMoneyWithdrawalsPayload | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [message, setMessage] = React.useState<string | null>(null);
  const [actionReason, setActionReason] = React.useState("");
  const [correctionAmount, setCorrectionAmount] = React.useState("");
  const [relatedEntityType, setRelatedEntityType] = React.useState("");
  const [relatedEntityId, setRelatedEntityId] = React.useState("");
  const [activeAction, setActiveAction] = React.useState<string | null>(null);

  const matchingUsers = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return users;
    }
    return users.filter((user) =>
      `${user.id} ${user.email} ${user.displayName}`.toLowerCase().includes(normalized),
    );
  }, [query, users]);

  React.useEffect(() => {
    if (!selectedUserId && users[0]) {
      setSelectedUserId(users[0].id);
    }
  }, [selectedUserId, users]);

  const refresh = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!canManageFinance) {
        return;
      }
      setStatus("loading");
      setMessage(null);
      try {
        const [nextUserMoney, nextDeposits, nextWithdrawals] = await Promise.all([
          selectedUserId ? loadAdminMoneyUser(selectedUserId, signal) : Promise.resolve(null),
          loadAdminMoneyDeposits(signal),
          loadAdminMoneyWithdrawals(signal),
        ]);
        setUserMoney(nextUserMoney);
        setDeposits(nextDeposits);
        setWithdrawals(nextWithdrawals);
        setStatus("ready");
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Could not load Coin operations");
      }
    },
    [canManageFinance, selectedUserId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  async function runAction(key: string, action: () => Promise<unknown>) {
    const reason = actionReason.trim();
    if (!reason) {
      setMessage("A reason is required for every admin money action.");
      return;
    }

    setActiveAction(key);
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage("Admin money action completed and audited.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin money action failed");
    } finally {
      setActiveAction(null);
    }
  }

  async function createCorrection() {
    const deltaCoinMicros = parseSignedCoinInputToMicros(correctionAmount);
    if (!selectedUserId || !deltaCoinMicros) {
      setMessage("Select a user and enter a non-zero signed Coin amount.");
      return;
    }
    if (!relatedEntityType.trim() || !relatedEntityId.trim()) {
      setMessage("A related entity type and id are required for a correction.");
      return;
    }

    await runAction("correction", async () => {
      await createAdminCoinCorrection({
        userId: selectedUserId,
        deltaCoinMicros,
        reason: actionReason.trim(),
        relatedEntityType: relatedEntityType.trim(),
        relatedEntityId: relatedEntityId.trim(),
      });
      setCorrectionAmount("");
      setRelatedEntityType("");
      setRelatedEntityId("");
    });
  }

  if (!canManageFinance) {
    return (
      <section className={panelClass}>
        <h2 className="text-lg font-semibold text-[#dee3e7]">Coin operations</h2>
        <p className="mt-2 text-sm text-[#7b8996]">
          Finance-admin access is required to inspect balances and perform audited actions.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 grid gap-6">
      <div className={panelClass}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0093fd]">
              Coin ledger
            </p>
            <h2 className="mt-1 text-xl font-semibold text-[#dee3e7]">
              User money operations
            </h2>
            <p className="mt-1 text-sm text-[#7b8996]">
              Immutable entries and compensating corrections only. Direct balance editing is not
              available.
            </p>
          </div>
          <span className="rounded-full bg-[#f7d022]/12 px-3 py-1.5 text-xs font-bold text-[#f8da52]">
            Review-only · no broadcast
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,1fr)]">
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#7b8996]">
              Find user
            </span>
            <input
              className={inputClass}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Email, name, or user id"
              type="search"
              value={query}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#7b8996]">
              Selected user
            </span>
            <select
              className={inputClass}
              onChange={(event) => setSelectedUserId(event.target.value)}
              value={selectedUserId}
            >
              <option value="">Select a user</option>
              {matchingUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} · {user.email}
                </option>
              ))}
            </select>
          </label>
        </div>

        {message ? (
          <p
            aria-live="polite"
            className={`mt-4 rounded-xl px-3 py-2 text-sm font-semibold ${
              status === "error"
                ? "bg-[#cb3131]/12 text-[#d78282]"
                : "bg-[#242b32] text-[#afbac5]"
            }`}
          >
            {message}
          </p>
        ) : null}

        {userMoney ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <BalanceCard
              label="Available Coins"
              value={userMoney.balance.availableCoinMicros}
            />
            <BalanceCard
              label="Reserved Coins"
              value={userMoney.balance.reservedCoinMicros}
            />
            <BalanceCard label="Total Coins" value={userMoney.balance.totalCoinMicros} />
          </div>
        ) : (
          <p className="mt-5 text-sm text-[#7b8996]">
            {status === "loading" ? "Loading Coin account…" : "Select a user to inspect."}
          </p>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className={panelClass}>
          <h3 className="text-lg font-semibold text-[#dee3e7]">Compensating correction</h3>
          <p className="mt-1 text-sm text-[#7b8996]">
            Creates a new immutable credit or debit with admin identity, reason, related entity,
            before/after balance, and audit id.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <AdminField
              label="Signed Coin amount"
              placeholder="+10 or -2.5"
              value={correctionAmount}
              onChange={setCorrectionAmount}
            />
            <AdminField
              label="Related entity type"
              placeholder="support_case"
              value={relatedEntityType}
              onChange={setRelatedEntityType}
            />
            <AdminField
              label="Related entity id"
              placeholder="case-123"
              value={relatedEntityId}
              onChange={setRelatedEntityId}
            />
            <AdminField
              label="Required reason"
              placeholder="Explain the compensating entry"
              value={actionReason}
              onChange={setActionReason}
            />
          </div>
          <button
            className="mt-4 h-11 rounded-xl bg-[#0093fd] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={activeAction !== null}
            onClick={() => void createCorrection()}
            type="button"
          >
            {activeAction === "correction" ? "Posting…" : "Post correction entry"}
          </button>
        </div>

        <div className={panelClass}>
          <h3 className="text-lg font-semibold text-[#dee3e7]">Coin ledger entries</h3>
          <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto">
            {(userMoney?.ledger ?? []).length === 0 ? (
              <EmptyMoneyState text="No Coin ledger entries for this user." />
            ) : (
              userMoney?.ledger.map((entry) => (
                <div className="rounded-xl border border-[#2e3841] bg-[#15191d] p-3" key={entry.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong className="text-sm text-[#dee3e7]">
                        {entry.operationType.replace(/_/g, " ")}
                      </strong>
                      <p className="mt-1 text-xs text-[#7b8996]">{entry.reason}</p>
                    </div>
                    <span className="text-right text-sm font-semibold text-[#dee3e7]">
                      {formatSignedCoinMicros(entry.availableDeltaCoinMicros)}
                    </span>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] text-[#697d91]">
                    {entry.sourceType}:{entry.sourceId} · audit/admin{" "}
                    {entry.adminActor ?? entry.adminUserId ?? "system"} ·{" "}
                    {formatRelativeTime(entry.createdAt)}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-[#697d91]">
                    Available {formatCoinMicros(beforeMicros(
                      entry.availableAfterCoinMicros,
                      entry.availableDeltaCoinMicros,
                    ))}{" "}
                    → {formatCoinMicros(entry.availableAfterCoinMicros)} · ledger {entry.id}
                    {typeof entry.auditMetadata.auditId === "string"
                      ? ` · audit ${entry.auditMetadata.auditId}`
                      : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className={panelClass}>
          <h3 className="text-lg font-semibold text-[#dee3e7]">Crypto deposits</h3>
          <p className="mt-1 text-sm text-[#7b8996]">
            Fireblocks events, rate state, fees, contract, transaction hash, and event index.
          </p>
          <div className="mt-4 max-h-[560px] space-y-3 overflow-y-auto">
            {(deposits?.deposits ?? []).length === 0 ? (
              <EmptyMoneyState text="No crypto deposits." />
            ) : (
              deposits?.deposits.map((deposit) => (
                <DepositAdminRow
                  activeAction={activeAction}
                  deposit={deposit}
                  key={deposit.id}
                  onRetry={() =>
                    runAction(`deposit:${deposit.id}`, () =>
                      retryAdminMoneyDeposit(deposit.id, actionReason.trim()),
                    )
                  }
                />
              ))
            )}
          </div>
        </div>

        <div className={panelClass}>
          <h3 className="text-lg font-semibold text-[#dee3e7]">Withdrawals</h3>
          <p className="mt-1 text-sm text-[#7b8996]">
            Coin reserves stay local. Approval and retry never broadcast while launch approval is
            off.
          </p>
          <div className="mt-4 max-h-[560px] space-y-3 overflow-y-auto">
            {(withdrawals?.withdrawalRequests ?? []).length === 0 ? (
              <EmptyMoneyState text="No Coin withdrawal requests." />
            ) : (
              withdrawals?.withdrawalRequests.map((withdrawal) => (
                <WithdrawalAdminRow
                  activeAction={activeAction}
                  key={withdrawal.id}
                  onApprove={() =>
                    runAction(`withdrawal-approve:${withdrawal.id}`, () =>
                      approveAdminMoneyWithdrawal(withdrawal.id, actionReason.trim()),
                    )
                  }
                  onReject={() =>
                    runAction(`withdrawal-reject:${withdrawal.id}`, () =>
                      rejectAdminMoneyWithdrawal(withdrawal.id, actionReason.trim()),
                    )
                  }
                  onRetry={() =>
                    runAction(`withdrawal-retry:${withdrawal.id}`, () =>
                      retryAdminMoneyWithdrawal(withdrawal.id, actionReason.trim()),
                    )
                  }
                  withdrawal={withdrawal}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function BalanceCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#2e3841] bg-[#15191d] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#7b8996]">{label}</p>
      <strong className="mt-2 block text-xl text-[#dee3e7]">{formatCoinMicros(value)}</strong>
    </div>
  );
}

function AdminField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#7b8996]">{label}</span>
      <input
        className={inputClass}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </label>
  );
}

function DepositAdminRow({
  deposit,
  activeAction,
  onRetry,
}: {
  deposit: CoinDeposit;
  activeAction: string | null;
  onRetry: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [details, setDetails] =
    React.useState<AdminMoneyDepositDetailPayload | null>(null);
  const [detailsStatus, setDetailsStatus] =
    React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const detailsRequest = React.useRef<AbortController | null>(null);
  const retryable = ["pending_rate", "confirmed_unpriced", "manual_review"].includes(
    deposit.status,
  );

  React.useEffect(
    () => () => {
      detailsRequest.current?.abort();
    },
    [],
  );

  async function fetchDetails() {
    detailsRequest.current?.abort();
    const controller = new AbortController();
    detailsRequest.current = controller;
    setDetailsStatus("loading");
    setDetailsError(null);

    try {
      const payload = await loadAdminMoneyDepositDetail(deposit.id, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setDetails(payload);
      setDetailsStatus("ready");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setDetailsStatus("error");
      setDetailsError(
        error instanceof Error ? error.message : "Could not load deposit evidence",
      );
    } finally {
      if (detailsRequest.current === controller) {
        detailsRequest.current = null;
      }
    }
  }

  function toggleDetails() {
    const nextOpen = !detailsOpen;
    setDetailsOpen(nextOpen);
    if (nextOpen && !details && detailsStatus !== "loading") {
      void fetchDetails();
    }
  }

  return (
    <article className="rounded-xl border border-[#2e3841] bg-[#15191d] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <strong className="text-sm text-[#dee3e7]">
            {formatAssetAmount(deposit.grossUsdtAtomic, "USDT", { atomic: true })}
          </strong>
          <p className="mt-1 text-xs text-[#7b8996]">
            {deposit.status.replace(/_/g, " ")} · {deposit.actualConfirmations}/
            {deposit.requiredConfirmations} confirmations
          </p>
        </div>
        <span className="rounded-full bg-[#242b32] px-2.5 py-1 text-xs font-semibold text-[#afbac5]">
          {deposit.creditedCoinMicros
            ? formatCoinMicros(deposit.creditedCoinMicros)
            : "No Coin credit"}
        </span>
      </div>
      <dl className="mt-3 grid gap-1 text-xs text-[#7b8996]">
        <DetailLine label="Provider event" value={deposit.providerEventId} />
        <DetailLine label="Tx / event" value={`${deposit.blockchainTxHash}:${deposit.eventIndex}`} />
        <DetailLine label="Contract" value={deposit.tokenContract} />
        <DetailLine
          label="Fees"
          value={`${formatAssetAmount(deposit.networkFeeUsdtAtomic, "USDT", {
            atomic: true,
          })} network · ${formatAssetAmount(deposit.providerFeeUsdtAtomic, "USDT", {
            atomic: true,
          })} provider`}
        />
        <DetailLine label="Rate snapshot" value={deposit.rateSnapshotId ?? "Awaiting rate"} />
        <DetailLine label="Ledger entry" value={deposit.ledgerEntryId ?? "Not credited"} />
        <DetailLine
          label="Reversal entry"
          value={deposit.reversalLedgerEntryId ?? "No reversal"}
        />
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          aria-controls={`deposit-evidence-${deposit.id}`}
          aria-expanded={detailsOpen}
          className="h-9 rounded-lg border border-[#2e3841] px-3 text-xs font-bold text-[#dee3e7] disabled:opacity-50"
          onClick={toggleDetails}
          type="button"
        >
          {detailsOpen ? "Hide details" : "View evidence"}
        </button>
        {retryable ? (
          <button
            className="h-9 rounded-lg border border-[#2e3841] px-3 text-xs font-bold text-[#dee3e7] disabled:opacity-50"
            disabled={activeAction !== null}
            onClick={onRetry}
            type="button"
          >
            {activeAction === `deposit:${deposit.id}` ? "Retrying…" : "Safe retry"}
          </button>
        ) : null}
      </div>
      {detailsOpen ? (
        <div
          className="mt-3 rounded-xl border border-[#2e3841] bg-[#111519] p-3"
          id={`deposit-evidence-${deposit.id}`}
        >
          {detailsStatus === "loading" ? (
            <p aria-live="polite" className="text-xs text-[#7b8996]">
              Loading immutable deposit evidence…
            </p>
          ) : null}
          {detailsStatus === "error" ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-xs font-semibold text-[#d78282]">
                {detailsError ?? "Could not load deposit evidence"}
              </p>
              <button
                className="h-8 rounded-lg border border-[#2e3841] px-3 text-xs font-bold text-[#dee3e7]"
                onClick={() => void fetchDetails()}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : null}
          {details ? <DepositEvidenceDetail detail={details} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function DepositEvidenceDetail({
  detail,
}: {
  detail: AdminMoneyDepositDetailPayload;
}) {
  const { deposit, providerEvent, rateSnapshot, ledgerEntry, reversalLedgerEntry } =
    detail;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-xs uppercase tracking-wide text-[#dee3e7]">
          Read-only evidence
        </strong>
        <span className="rounded-full bg-[#f7d022]/12 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#f8da52]">
          Review-only
        </span>
      </div>

      <EvidenceSection title="Deposit">
        <DetailLine label="Deposit ID" value={deposit.id} />
        <DetailLine label="Status" value={deposit.status} />
        <DetailLine label="User" value={deposit.userId ?? "Unassigned"} />
        <DetailLine label="Intent" value={deposit.depositIntentId ?? "No intent"} />
        <DetailLine label="Provider" value={deposit.provider} />
        <DetailLine
          label="Provider tx"
          value={deposit.providerTransactionId ?? "Not supplied"}
        />
        <DetailLine label="Network" value={deposit.network} />
        <DetailLine label="Contract" value={deposit.tokenContract} />
        <DetailLine label="Destination" value={deposit.destinationAddress} />
        <DetailLine label="Tx hash" value={deposit.blockchainTxHash} />
        <DetailLine label="Event index" value={deposit.eventIndex} />
        <DetailLine
          label="Gross / net"
          value={`${formatAssetAmount(deposit.grossUsdtAtomic, "USDT", {
            atomic: true,
          })} / ${formatAssetAmount(deposit.netUsdtAtomic, "USDT", {
            atomic: true,
          })}`}
        />
        <DetailLine
          label="Fees"
          value={`${formatAssetAmount(deposit.networkFeeUsdtAtomic, "USDT", {
            atomic: true,
          })} network · ${formatAssetAmount(deposit.providerFeeUsdtAtomic, "USDT", {
            atomic: true,
          })} provider`}
        />
        <DetailLine
          label="Confirmations"
          value={`${deposit.actualConfirmations}/${deposit.requiredConfirmations}`}
        />
        <DetailLine
          label="Review reason"
          value={deposit.manualReviewReason ?? "No manual-review reason"}
        />
      </EvidenceSection>

      <EvidenceSection title="Provider event">
        {providerEvent ? (
          <>
            <DetailLine label="Record ID" value={providerEvent.id} />
            <DetailLine label="Provider" value={providerEvent.provider} />
            <DetailLine label="Event ID" value={providerEvent.providerEventId} />
            <DetailLine label="Event type" value={providerEvent.eventType} />
            <DetailLine
              label="Provider tx"
              value={providerEvent.providerTransactionId ?? "Not supplied"}
            />
            <DetailLine label="Payload hash" value={providerEvent.payloadHash} />
            <DetailLine label="Received at" value={providerEvent.receivedAt} />
            <details className="mt-2 rounded-lg border border-[#2e3841] p-2">
              <summary className="cursor-pointer text-xs font-semibold text-[#afbac5]">
                Provider payload (sensitive fields redacted)
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[#0c1013] p-2 font-mono text-[10px] leading-relaxed text-[#8fa0af]">
                {formatSafeProviderPayload(providerEvent.payload)}
              </pre>
            </details>
          </>
        ) : (
          <p className="text-xs text-[#7b8996]">
            No provider event is linked to this deposit.
          </p>
        )}
      </EvidenceSection>

      <EvidenceSection title="Immutable rate snapshot">
        {rateSnapshot ? (
          <>
            <DetailLine label="Snapshot ID" value={rateSnapshot.id} />
            <DetailLine
              label="Rate"
              value={`1 ${rateSnapshot.asset} = ${rateSnapshot.rateDecimal} ${rateSnapshot.quoteCurrency}`}
            />
            <DetailLine label="Rate nanos" value={rateSnapshot.rateNanos} />
            <DetailLine label="Source" value={rateSnapshot.source} />
            <DetailLine label="Purpose" value={rateSnapshot.purpose} />
            <DetailLine label="Kind" value={rateSnapshot.kind} />
            <DetailLine label="Quoted at" value={rateSnapshot.quotedAt} />
            <DetailLine label="Expires at" value={rateSnapshot.expiresAt} />
            <DetailLine
              label="Provider ref"
              value={rateSnapshot.providerReference ?? "Not supplied"}
            />
          </>
        ) : (
          <p className="text-xs text-[#7b8996]">
            No rate snapshot is linked yet; no Coin credit can be evidenced from a rate.
          </p>
        )}
      </EvidenceSection>

      <EvidenceSection title="Coin ledger linkage">
        <DetailLine
          label="Ledger ID"
          value={ledgerEntry?.id ?? deposit.ledgerEntryId ?? "Not credited"}
        />
        <DetailLine
          label="Reversal ID"
          value={
            reversalLedgerEntry?.id ??
            deposit.reversalLedgerEntryId ??
            "No reversal entry"
          }
        />
        {ledgerEntry ? (
          <>
            <DetailLine label="Credit type" value={ledgerEntry.operationType} />
            <DetailLine
              label="Credit delta"
              value={formatSignedCoinMicros(ledgerEntry.availableDeltaCoinMicros)}
            />
            <DetailLine
              label="Credit source"
              value={`${ledgerEntry.sourceType}:${ledgerEntry.sourceId}`}
            />
          </>
        ) : null}
        {reversalLedgerEntry ? (
          <>
            <DetailLine label="Reversal type" value={reversalLedgerEntry.operationType} />
            <DetailLine
              label="Reversal delta"
              value={formatSignedCoinMicros(
                reversalLedgerEntry.availableDeltaCoinMicros,
              )}
            />
            <DetailLine
              label="Reversal source"
              value={`${reversalLedgerEntry.sourceType}:${reversalLedgerEntry.sourceId}`}
            />
          </>
        ) : null}
      </EvidenceSection>
    </div>
  );
}

function WithdrawalAdminRow({
  withdrawal,
  activeAction,
  onApprove,
  onReject,
  onRetry,
}: {
  withdrawal: WithdrawalRequest;
  activeAction: string | null;
  onApprove: () => void;
  onReject: () => void;
  onRetry: () => void;
}) {
  const canReview = withdrawal.status === "pending_review";
  const canRelease = ["pending_review", "approved_for_review", "failed"].includes(
    withdrawal.status,
  );
  return (
    <article className="rounded-xl border border-[#2e3841] bg-[#15191d] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <strong className="text-sm text-[#dee3e7]">
            {formatCoinMicros(withdrawal.coinReservedMicros)}
          </strong>
          <p className="mt-1 text-xs text-[#7b8996]">
            {formatAssetAmount(withdrawal.estimatedUsdtAtomic, "USDT", { atomic: true })} external
          </p>
        </div>
        <span className="rounded-full bg-[#f7d022]/12 px-2.5 py-1 text-xs font-semibold text-[#f8da52]">
          {withdrawal.status.replace(/_/g, " ")}
        </span>
      </div>
      <dl className="mt-3 grid gap-1 text-xs text-[#7b8996]">
        <DetailLine label="Destination" value={withdrawal.destinationAddress} />
        <DetailLine label="Quote" value={withdrawal.withdrawalQuoteId} />
        <DetailLine
          label="Fees"
          value={`${formatAssetAmount(withdrawal.networkFeeUsdtAtomic, "USDT", {
            atomic: true,
          })} network · ${formatAssetAmount(withdrawal.providerFeeUsdtAtomic, "USDT", {
            atomic: true,
          })} provider`}
        />
        <DetailLine label="Reserve entry" value={withdrawal.reserveLedgerEntryId} />
        <DetailLine label="Release entry" value={withdrawal.releaseLedgerEntryId ?? "Active reserve"} />
        <DetailLine label="Fireblocks" value={withdrawal.fireblocksReference ?? "Not broadcast"} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {canReview ? (
          <MoneyActionButton
            disabled={activeAction !== null}
            label="Approve for review"
            onClick={onApprove}
          />
        ) : null}
        {canRelease ? (
          <MoneyActionButton
            disabled={activeAction !== null}
            label="Reject + release"
            onClick={onReject}
          />
        ) : null}
        {withdrawal.status === "failed" || withdrawal.status === "approved_for_review" ? (
          <MoneyActionButton
            disabled={activeAction !== null}
            label="Safe retry"
            onClick={onRetry}
          />
        ) : null}
      </div>
    </article>
  );
}

function MoneyActionButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="h-9 rounded-lg border border-[#2e3841] px-3 text-xs font-bold text-[#dee3e7] disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
      <dt>{label}</dt>
      <dd className="break-all font-mono text-[#afbac5]">{value}</dd>
    </div>
  );
}

function EvidenceSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[#242b32] bg-[#15191d] p-3">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-[#0093fd]">
        {title}
      </h4>
      <dl className="mt-2 grid gap-1 text-xs text-[#7b8996]">{children}</dl>
    </section>
  );
}

const sensitiveProviderPayloadKey =
  /authorization|cookie|password|secret|signature|api[-_]?key|access[-_]?token|private[-_]?key/i;

function sanitizeProviderPayload(value: unknown, key = ""): unknown {
  if (key && sensitiveProviderPayloadKey.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderPayload(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeProviderPayload(nestedValue, nestedKey),
      ]),
    );
  }
  return value;
}

function formatSafeProviderPayload(payload: Record<string, unknown>) {
  try {
    return JSON.stringify(sanitizeProviderPayload(payload), null, 2);
  } catch {
    return "Payload could not be rendered safely.";
  }
}

function EmptyMoneyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#2e3841] p-5 text-center text-sm text-[#7b8996]">
      {text}
    </div>
  );
}

function beforeMicros(after: string, delta: string) {
  try {
    return (BigInt(after) - BigInt(delta)).toString();
  } catch {
    return "0";
  }
}
