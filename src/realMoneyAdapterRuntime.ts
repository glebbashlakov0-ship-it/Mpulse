export type RealMoneyProviderAdapterRuntimeKind =
  | "custody_signing"
  | "signed_deposit_webhook"
  | "withdrawal_broadcast"
  | "provider_reconciliation"
  | "account_risk"
  | "sanctions_screening"
  | "execution_venue"
  | "ledger_settlement_reconciliation"
  | "operations_monitoring";

export type RealMoneyProviderAdapterRuntime = {
  kind: RealMoneyProviderAdapterRuntimeKind;
  adapterId: string;
  provider: string | null;
};

export type RealMoneyProviderAdapterRuntimeMethod<
  Input = unknown,
  Output = unknown,
> = (input: Input) => Output | Promise<Output>;

export type RealMoneyExecutionOrderInput = {
  idempotencyKey: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  price: number;
  amount: number;
  shares: number;
  clobTokenId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type RealMoneyExecutionOrderResult = {
  status: "filled";
  providerOrderId: string;
  providerTradeId?: string | null;
  executedPrice: number;
  executedShares: number;
  executedAmount: number;
  feeAmount?: number | null;
  settledAt?: string | null;
  raw?: unknown;
};

export type RealMoneyWithdrawalBroadcastInput = {
  idempotencyKey: string;
  userId: string;
  withdrawalRequestId: string;
  asset: "USDT";
  network: "TRON";
  destinationAddress: string;
  amount: number;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type RealMoneyWithdrawalBroadcastResult = {
  status: "broadcasted";
  providerWithdrawalId: string;
  txHash: string;
  broadcastedAt?: string | null;
  networkFeeAmount?: number | null;
  raw?: unknown;
};

export type RealMoneyCustodySigningRuntime = RealMoneyProviderAdapterRuntime & {
  kind: "custody_signing";
  canSignTransfers: true;
  signTransfer: RealMoneyProviderAdapterRuntimeMethod;
};

export type RealMoneySignedDepositWebhookRuntime = RealMoneyProviderAdapterRuntime & {
  kind: "signed_deposit_webhook";
  verifiesWebhookSignatures: true;
  verifyDepositWebhook: RealMoneyProviderAdapterRuntimeMethod;
};

export type RealMoneyWithdrawalBroadcastRuntime = RealMoneyProviderAdapterRuntime & {
  kind: "withdrawal_broadcast";
  broadcastsWithdrawals: true;
  broadcastWithdrawal: RealMoneyProviderAdapterRuntimeMethod<
    RealMoneyWithdrawalBroadcastInput,
    RealMoneyWithdrawalBroadcastResult
  >;
};

export type RealMoneyProviderReconciliationRuntime = RealMoneyProviderAdapterRuntime & {
  kind: "provider_reconciliation";
  reconcilesProviderState: true;
  reconcileProviderState: RealMoneyProviderAdapterRuntimeMethod;
};

export type RealMoneyAccountRiskRuntime = RealMoneyProviderAdapterRuntime & {
  kind: "account_risk";
  evaluatesAccountEligibility: true;
  evaluateAccountEligibility: RealMoneyProviderAdapterRuntimeMethod;
};

export type RealMoneySanctionsScreeningRuntime = RealMoneyProviderAdapterRuntime & {
  kind: "sanctions_screening";
  screensSanctionsRisk: true;
  screenSanctionsRisk: RealMoneyProviderAdapterRuntimeMethod;
};

export type RealMoneyExecutionVenueRuntime = RealMoneyProviderAdapterRuntime & {
  kind: "execution_venue";
  executesOrders: true;
  executeOrder: RealMoneyProviderAdapterRuntimeMethod<
    RealMoneyExecutionOrderInput,
    RealMoneyExecutionOrderResult
  >;
};

export type RealMoneyLedgerSettlementReconciliationRuntime =
  RealMoneyProviderAdapterRuntime & {
    kind: "ledger_settlement_reconciliation";
    reconcilesSettlements: true;
    reconcileSettlement: RealMoneyProviderAdapterRuntimeMethod;
  };

export type RealMoneyOperationsMonitoringRuntime = RealMoneyProviderAdapterRuntime & {
  kind: "operations_monitoring";
  monitorsMoneyMovement: true;
  monitorMoneyMovement: RealMoneyProviderAdapterRuntimeMethod;
};

export type VerifiedRealMoneyProviderAdapterRuntimeExport =
  | RealMoneyCustodySigningRuntime
  | RealMoneySignedDepositWebhookRuntime
  | RealMoneyWithdrawalBroadcastRuntime
  | RealMoneyProviderReconciliationRuntime
  | RealMoneyAccountRiskRuntime
  | RealMoneySanctionsScreeningRuntime
  | RealMoneyExecutionVenueRuntime
  | RealMoneyLedgerSettlementReconciliationRuntime
  | RealMoneyOperationsMonitoringRuntime;
