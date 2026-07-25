export type Outcome = {
  name: string;
  price: number | null;
  probability?: number | null;
  price_cents?: number | null;
  clobTokenId: string | null;
};

export type RelatedMarket = {
  id: string;
  slug: string | null;
  title: string;
  category: string | null;
  image: string | null;
  icon: string | null;
  volume: number;
  ends_at: string | null;
  probability: number | null;
};

export type MarketSnapshot = {
  id: string;
  market_id: string;
  captured_at: string;
  prices: {
    yes: number | null;
    no: number | null;
    best_bid: number | null;
    best_ask: number | null;
    last_trade: number | null;
    midpoint: number | null;
    spread: number | null;
  };
  volume: number;
  liquidity: number;
  source: "polymarket";
  synthetic?: boolean;
};

export type Market = {
  id: string;
  slug: string | null;
  title: string;
  title_ar: string | null;
  description: string | null;
  category: string | null;
  category_label: string | null;
  topics: string[];
  image: string | null;
  icon: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: "upcoming" | "live" | "closed" | "expired";
  active: boolean;
  closed: boolean;
  archived: boolean;
  restricted: boolean;
  volume: number;
  volume_24h?: number;
  liquidity: number;
  comment_count?: number;
  game_start_time?: string | null;
  outcomes: Outcome[];
  trading: {
    order_book_enabled: boolean;
    accepting_orders: boolean;
    best_bid: number | null;
    best_ask: number | null;
    last_trade_price: number | null;
  };
  event_id: string | null;
  event_slug: string | null;
  event_title: string | null;
  groupItemTitle: string | null;
  groupItemThreshold: string | null;
  canonical_market_id: string;
  canonical_event_slug: string | null;
  prices?: {
    yes: number | null;
    no: number | null;
    best_bid: number | null;
    best_ask: number | null;
    last_trade: number | null;
    midpoint: number | null;
    spread: number | null;
  };
  dates?: {
    starts_at: string | null;
    ends_at: string | null;
    starts_at_ms: number | null;
    ends_at_ms: number | null;
    status: "upcoming" | "live" | "closed" | "expired";
    seconds_to_close: number | null;
  };
  volume_detail?: {
    volume: number;
    liquidity: number;
  };
  related_markets?: RelatedMarket[];
  history?: {
    snapshots: MarketSnapshot[];
    price_history: Array<{
      timestamp: string;
      yes: number | null;
      no: number | null;
      outcomes?: Array<{ name: string; price: number | null; volume?: number }>;
      outcomeVolumes?: Record<string, number>;
      volume: number;
      liquidity: number;
      synthetic?: boolean;
    }>;
    is_synthetic: boolean;
  };
  group_markets?: Array<Market & {
    label: string;
    yes_price: number | null;
    no_price: number | null;
    clobTokenIds: string[];
  }>;
  source: "polymarket";
  displayImage?: string;
};

export type ApiResponse<T> = {
  data: T;
  error?: {
    code: string;
    message: string;
  };
};

export type ApiListResponse<T> = ApiResponse<T> & {
  meta?: {
    limit: number;
    offset: number;
    next_cursor: string | null;
    total: number;
    sort: string;
    lastSyncedAt?: string | null;
    isStale?: boolean;
    sourceStatus?: "fresh" | "cache" | "stale" | "fallback" | "unavailable";
    warnings?: string[];
  };
};

export type CoinMicros = string;
export type UsdtAtomic = string;
export type DecimalString = string;

export type SupportedMoneyAssetsPayload = {
  internalCurrency: {
    code: "COIN";
    name: "Coins";
    microsPerCoin: "1000000";
    usdParity: "1";
    blockchainAsset: false;
  };
  settlementAssets: Array<{
    asset: "USDT";
    network: "TRON";
    rail: "TRC-20";
    decimals: 6;
    depositEnabled: boolean;
    withdrawalEnabled: boolean;
    reviewOnly: boolean;
    disabledReason?: string | null;
  }>;
};

export type CoinBalance = {
  userId: string;
  availableCoinMicros: CoinMicros;
  reservedCoinMicros: CoinMicros;
  totalCoinMicros: CoinMicros;
};

export type CoinOperationType =
  | "crypto_deposit_credit"
  | "withdrawal_reserve"
  | "withdrawal_debit"
  | "withdrawal_release"
  | "trade_reserve"
  | "trade_debit"
  | "trade_release"
  | "trade_settlement_credit"
  | "fee_debit"
  | "refund_credit"
  | "bonus_credit"
  | "admin_credit"
  | "admin_debit"
  | "migration_credit"
  | "correction_credit"
  | "correction_debit"
  | "reversed_deposit";

export type CoinLedgerEntry = {
  id: string;
  userId: string;
  operationType: CoinOperationType;
  availableDeltaCoinMicros: CoinMicros;
  reservedDeltaCoinMicros: CoinMicros;
  availableAfterCoinMicros: CoinMicros;
  reservedAfterCoinMicros: CoinMicros;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  externalReference: string | null;
  rateSnapshotId: string | null;
  reason: string;
  adminUserId: string | null;
  adminActor: string | null;
  auditMetadata: Record<string, unknown>;
  createdAt: string;
};

export type CoinLedgerPayload = {
  entries: CoinLedgerEntry[];
};

export type MarketCategory = {
  id: string;
  slug: string;
  label: string;
  title_ar: string | null;
  description: string | null;
  image: string;
  keywords: string[];
};

export type MarketTag = {
  id: string;
  slug: string;
  label: string;
};

export type MarketFilters = {
  search: string;
  category: string;
  topic: string;
  sort: "trending" | "volume" | "liquidity" | "newest" | "closing_soon" | "relevance";
  status: "all" | "live" | "upcoming" | "closed" | "expired";
  minVolume: string;
  maxVolume: string;
  closingAfter: string;
  closingBefore: string;
};

export type Trade = {
  id: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  amountCoinMicros: CoinMicros;
  stakeCoinMicros: CoinMicros;
  feeCoinMicros: CoinMicros;
  price: DecimalString;
  shares: DecimalString;
  realizedPnlCoinMicros: CoinMicros | null;
  idempotencyKey: string | null;
  status?: "reserved" | "partially_filled" | "filled" | "cancelled" | "failed";
  createdAt: string;
};

export type TradingMode = {
  mode: "local_simulated" | "real_money";
  warning: string;
  realMoneyEnabled: boolean;
  simulated: boolean;
  localSimulationEnabled: boolean;
  localSimulationBlockReason: string | null;
  balance: {
    asset: "COIN";
    initialCoinMicros: CoinMicros;
    simulatedCreditEnabled: boolean;
  };
  orders: {
    simulatedExecutionEnabled: boolean;
    realExecutionEnabled: boolean;
    blockReason: string | null;
  };
};

export type TradingQuote = {
  tradingMode: TradingMode;
  id: string;
  marketId: string;
  marketTitle: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  price: DecimalString;
  shares: DecimalString;
  amountCoinMicros: CoinMicros;
  stakeCoinMicros: CoinMicros;
  feeCoinMicros: CoinMicros;
  estimatedCostCoinMicros: CoinMicros;
  estimatedProceedsCoinMicros: CoinMicros;
  estimatedPayoutCoinMicros: CoinMicros;
  estimatedProfitCoinMicros: CoinMicros;
  availableCoinMicros: CoinMicros;
  balanceAfterCoinMicros: CoinMicros;
  availableShares: DecimalString;
  status: "quoted";
  createdAt: string;
};

export type LocalPosition = {
  id: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  yesShares: DecimalString;
  noShares: DecimalString;
  yesCostCoinMicros: CoinMicros;
  noCostCoinMicros: CoinMicros;
  totalCostCoinMicros: CoinMicros;
  lastYesPrice: DecimalString | null;
  lastNoPrice: DecimalString | null;
  averagePrice: DecimalString;
  currentPrice: DecimalString;
  currentValueCoinMicros: CoinMicros;
  pnlCoinMicros: CoinMicros;
  lastTradeAt: string;
};

export type MarketComment = {
  id: string;
  marketId: string;
  userId: string | null;
  displayName: string;
  body: string;
  positionLabel: string | null;
  createdAt: string;
};

export type MarketHolder = {
  id: string;
  userId: string;
  displayName: string;
  yesShares: DecimalString;
  noShares: DecimalString;
  shares: DecimalString;
  valueCoinMicros: CoinMicros;
  updatedAt: string;
};

export type MarketActivityItem =
  | {
      type: "trade";
      id: string;
      marketId: string;
      userId: string;
      displayName: string;
      side: "yes" | "no";
      action: "buy" | "sell";
      amountCoinMicros: CoinMicros;
      price: DecimalString;
      shares: DecimalString;
      createdAt: string;
    }
  | (MarketComment & {
      type: "comment";
    });

export type MarketActivityPayload = {
  comments: MarketComment[];
  topHolders: MarketHolder[];
  activity: MarketActivityItem[];
};

export type LocalUser = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type LocalWallet = {
  userId: string;
  asset: "COIN";
  availableCoinMicros: CoinMicros;
  reservedCoinMicros: CoinMicros;
  totalCoinMicros: CoinMicros;
  initialCoinMicros: CoinMicros;
  updatedAt: string;
};

export type WalletCoreMode = "wallet_review_only" | "real_money";

export type Wallet = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  address: string;
  status: "active";
  provider: "fireblocks";
  createdAt: string;
  updatedAt: string;
};

export type MyWalletPayload = {
  wallet: Wallet;
  instructions: {
    rail: "TRC-20";
    tokenContract: string | null;
    requiredConfirmations: string;
    doNotSubmitTransactionHash: true;
  };
  reviewOnly: boolean;
};

export type DepositIntent = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  address: string;
  expectedUsdtAtomic: UsdtAtomic;
  memo?: string | null;
  status:
    | "waiting"
    | "detected"
    | "confirming"
    | "pending_rate"
    | "awaiting_rate"
    | "credited"
    | "expired"
    | "rejected"
    | "manual_review";
  expiresAt: string;
  createdAt: string;
};

export type CoinDeposit = {
  id: string;
  userId: string | null;
  depositIntentId: string | null;
  network: "TRON";
  provider: string;
  providerEventId: string;
  providerTransactionId: string | null;
  blockchainTxHash: string;
  eventIndex: string;
  tokenContract: string;
  destinationAddress: string;
  grossUsdtAtomic: UsdtAtomic;
  networkFeeUsdtAtomic: UsdtAtomic;
  providerFeeUsdtAtomic: UsdtAtomic;
  netUsdtAtomic: UsdtAtomic;
  usdValueMicros: string | null;
  creditedCoinMicros: CoinMicros | null;
  actualConfirmations: string;
  requiredConfirmations: string;
  status:
    | "detected"
    | "confirming"
    | "confirmed_unpriced"
    | "pending_rate"
    | "manual_review"
    | "credited"
    | "rejected"
    | "reversal_pending"
    | "reversing"
    | "reversed";
  rateSnapshotId: string | null;
  ledgerEntryId: string | null;
  reversalLedgerEntryId: string | null;
  manualReviewReason: string | null;
  detectedAt: string;
  confirmedAt: string | null;
  creditedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoinRateSnapshot = {
  id: string;
  asset: "USDT";
  network: "TRON";
  quoteCurrency: "USD";
  rateNanos: string;
  rateDecimal: DecimalString;
  source: string;
  kind: "indicative" | "final";
  purpose: "deposit_final" | "withdrawal_indicative" | "withdrawal_final";
  quotedAt: string;
  expiresAt: string;
  providerReference: string | null;
  createdAt: string;
};

export type MoneyProviderEventEvidence = {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  providerTransactionId: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  receivedAt: string;
};

export type AdminMoneyDepositDetailPayload = {
  deposit: CoinDeposit;
  providerEvent: MoneyProviderEventEvidence | null;
  rateSnapshot: CoinRateSnapshot | null;
  ledgerEntry: CoinLedgerEntry | null;
  reversalLedgerEntry: CoinLedgerEntry | null;
};

export type WalletDepositsPayload = {
  deposits: CoinDeposit[];
};

export type WithdrawalRequest = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  destinationAddress: string;
  withdrawalQuoteId: string;
  coinReservedMicros: CoinMicros;
  coinDebitedMicros: CoinMicros | null;
  estimatedUsdtAtomic: UsdtAtomic;
  finalUsdtAtomic: UsdtAtomic | null;
  networkFeeUsdtAtomic: UsdtAtomic;
  providerFeeUsdtAtomic: UsdtAtomic;
  status:
    | "pending_review"
    | "approved_for_review"
    | "rejected"
    | "cancelled"
    | "broadcast_pending"
    | "broadcasted"
    | "failed";
  idempotencyKey: string;
  fireblocksReference: string | null;
  reserveLedgerEntryId: string;
  finalLedgerEntryId: string | null;
  releaseLedgerEntryId: string | null;
  finalRateSnapshotId: string | null;
  failureState: string | null;
  reviewReason: string | null;
  reviewedByActor: string | null;
  reviewedAt: string | null;
  realTransferBlocked: boolean;
  blockReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WithdrawalRequestsPayload = {
  withdrawalRequests: WithdrawalRequest[];
  reviewOnly: true;
};

export type WithdrawalRateSnapshot = Omit<CoinRateSnapshot, "purpose"> & {
  purpose: "withdrawal_indicative" | "withdrawal_final";
};

export type WithdrawalQuote = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  destinationAddress: string;
  coinToDebitMicros: CoinMicros;
  grossUsdtAtomic: UsdtAtomic;
  estimatedUsdtAtomic: UsdtAtomic;
  networkFeeUsdtAtomic: UsdtAtomic;
  providerFeeUsdtAtomic: UsdtAtomic;
  rateSnapshot: WithdrawalRateSnapshot;
  status: "open" | "consumed" | "expired" | "cancelled";
  expiresAt: string;
  idempotencyKey: string;
  createdAt: string;
};

export type CreateWithdrawalQuotePayload = {
  quote: WithdrawalQuote;
};

export type CreateWithdrawalPayload = {
  withdrawalRequest: WithdrawalRequest;
  balance: CoinBalance;
  idempotent: boolean;
};

export type CreateDepositIntentPayload = {
  depositIntent: DepositIntent;
  instructions: {
    asset: "USDT";
    network: "TRON";
    rail: "TRC-20";
    tokenContract: string | null;
    address: string;
    requiredConfirmations: string;
    doNotSubmitTransactionHash: true;
  };
  reviewOnly: boolean;
};

export type LedgerEntryType =
  | "credit"
  | "debit"
  | "hold"
  | "release"
  | "trade_debit"
  | "trade_credit"
  | "adjustment";

export type LedgerEntry = {
  id: string;
  userId: string;
  walletId: string | null;
  asset: "USDT";
  entryType: LedgerEntryType;
  amount: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type LedgerBalance = {
  userId: string;
  walletId: string | null;
  asset: "USDT";
  availableBalance: number;
  totalCredited: number;
  totalDebited: number;
  totalHeld: number;
  totalReleased: number;
};

export type LedgerBalancePayload = {
  mode: "ledger";
  balance: LedgerBalance;
};

export type LedgerEntriesPayload = {
  mode: "ledger";
  entries: LedgerEntry[];
};

export type LedgerCreditPayload = {
  mode: "ledger";
  complianceMode: "ledger_restricted";
  entry: LedgerEntry;
  balance: LedgerBalance;
  idempotent: boolean;
};

export type PortfolioSummary = {
  availableCoinMicros: CoinMicros;
  reservedCoinMicros: CoinMicros;
  totalCoinMicros: CoinMicros;
  positionValueCoinMicros: CoinMicros;
  investedCoinMicros: CoinMicros;
  equityCoinMicros: CoinMicros;
  unrealizedPnlCoinMicros: CoinMicros;
  realizedPnlCoinMicros: CoinMicros;
  pnlCoinMicros: CoinMicros;
  pnlPercent: DecimalString | null;
  openPositions: number;
};

export type SettlementHistoryItem = {
  id: string;
  marketId: string | null;
  settlementId: string | null;
  side: "yes" | "no" | null;
  originalStakeCoinMicros: CoinMicros;
  payoutCoinMicros: CoinMicros;
  profitCoinMicros: CoinMicros;
  kind: string | null;
  createdAt: string;
};

export type Portfolio = {
  tradingMode: TradingMode;
  user: LocalUser;
  wallet: LocalWallet;
  trades: Trade[];
  positions: LocalPosition[];
  settlements?: SettlementHistoryItem[];
  summary: PortfolioSummary;
};

export type KycStatus = "not_started" | "pending" | "approved" | "rejected" | "manual_review";
export type AmlStatus = "clear" | "watchlist_review" | "blocked";
export type RiskLevel = "low" | "medium" | "high" | "blocked";
export type LegalConsentType = "terms" | "privacy" | "risk_disclosure";

export type ComplianceProfile = {
  userId: string;
  countryCode: string | null;
  dateOfBirth: string | null;
  kycStatus: KycStatus;
  amlStatus: AmlStatus;
  riskLevel: RiskLevel;
  verificationProvider: "self_declared";
  createdAt: string;
  updatedAt: string;
};

export type LegalConsent = {
  id: string;
  userId: string;
  consentType: LegalConsentType;
  version: string;
  acceptedAt: string;
};

export type AcceptedLegalVersions = Record<LegalConsentType, string | null>;

export type ComplianceMePayload = {
  profile: ComplianceProfile;
  legalConsents: LegalConsent[];
  acceptedVersions: AcceptedLegalVersions;
};

export type ComplianceEligibilityPayload = ComplianceMePayload & {
  canTradeMock: boolean;
  canTradeLocal: boolean;
  canUseRealMoney: boolean;
  reasons: string[];
  age: number | null;
  complianceMode: "trading_restricted";
  verificationProvider: "self_declared";
};

export type UserSettings = {
  language: "en" | "ar";
  currency: "COIN";
  country: string | null;
  emailNotifications: boolean;
  marketNotifications: boolean;
};

export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  role: "user" | "support" | "compliance_admin" | "finance_admin" | "super_admin";
  settings: UserSettings;
  createdAt: string;
  updatedAt: string;
};

export type AuthSessionInfo = {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
};

export type TwoFactorStatus = {
  enabled: boolean;
  enabledAt: string | null;
  lastUsedAt: string | null;
};

export type TwoFactorSetup = {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  backupCodes: string[];
};

export type AuditLog = {
  id: string;
  eventType: string;
  userId: string | null;
  sessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AdminWithdrawalRequest = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  destinationAddress: string;
  amount: number;
  status: string;
  idempotencyKey: string;
  provider: string;
  realTransferBlocked: true;
  blockReason: string;
  mode: "wallet_review_only";
  createdAt: string;
  updatedAt: string;
};

export type HiddenMarketRule = {
  id: string;
  marketId: string;
  action: "hide";
  reason: "legal_risk" | "compliance" | "sensitive_topic" | "manual_review";
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminUsersPayload = {
  mode: string;
  users: AuthUser[];
  summary: Record<string, number>;
};

export type AdminPanelSessionPayload = {
  authenticated: boolean;
  admin: {
    username: string;
    role: "super_admin";
    expiresAt: string;
  } | null;
};

export type AdminAuditPayload = {
  mode: string;
  auditLogs: AuditLog[];
  hiddenMarkets: HiddenMarketRule[];
};

export type AdminMoneyUserPayload = {
  userId: string;
  balance: CoinBalance;
  ledger: CoinLedgerEntry[];
  deposits: CoinDeposit[];
  withdrawals: WithdrawalRequest[];
};

export type AdminMoneyDepositsPayload = {
  deposits: CoinDeposit[];
  reviewOnly: true;
};

export type AdminMoneyWithdrawalsPayload = {
  withdrawalRequests: WithdrawalRequest[];
  reviewOnly: true;
};

export type AdminCorrectionResult = {
  auditId: string;
  ledgerEntry: CoinLedgerEntry;
  balance: CoinBalance;
};

export type AdminWithdrawalActionResult = {
  withdrawalRequest: WithdrawalRequest;
  balance?: CoinBalance;
  idempotent: boolean;
  broadcastAttempted?: false;
  reviewOnly?: true;
  retryBlockedReason?: string;
};

export type AdminWithdrawalsPayload = {
  mode: "wallet_review_only";
  realTransferBlocked: true;
  warning: string;
  withdrawalRequests: AdminWithdrawalRequest[];
};

export type AdminSettlementResult = {
  settlement: {
    id: string;
    marketId: string;
    status: "resolved" | "cancelled" | "no_winner";
    winningSide: "yes" | "no" | null;
    totalPoolCoinMicros: string;
    winningPoolCoinMicros: string;
    platformFeeCoinMicros: string;
    distributablePoolCoinMicros: string;
    payoutCount: number;
    createdBy: string | null;
    idempotencyKey: string;
    createdAt: string;
  };
  payouts: Array<{
    id: string;
    settlementId: string;
    marketId: string;
    userId: string;
    side: "yes" | "no";
    originalStakeCoinMicros: string;
    payoutCoinMicros: string;
    profitCoinMicros: string;
    kind: "payout" | "refund" | "loss";
    coinLedgerEntryId: string | null;
    createdAt: string;
  }>;
  balancing: {
    totalPoolCoinMicros: string;
    payoutTotalCoinMicros: string;
    platformFeeCoinMicros: string;
    balanced: boolean;
    fundingModel: "external_clob";
    providerFundingVerified: false;
    reviewOnly: true;
  };
  idempotent: boolean;
};

export type AdminSeedOddsResult = {
  marketId: string;
  scope: {
    scopeType: "market" | "event";
    scopeId: string;
    marketExternalId: string;
  };
  created: boolean;
  outcomes: Array<{ name: string; price: number | null; volume?: number }>;
  pointCount: number;
  latestPoint: {
    id: string;
    capturedAt: string;
    volume: number;
    liquidity: number;
    source: "pulse_seed" | "admin" | "trade";
  } | null;
};

export type AdminOddsOverrideResult = {
  marketId: string;
  scope: {
    scopeType: "market" | "event";
    scopeId: string;
    marketExternalId: string;
  };
  point: {
    id: string;
    capturedAt: string;
    source: "admin";
  };
  outcomes: Array<{ name: string; price: number | null; volume?: number }>;
};

export type AdminLedgerSeedActivityResult = {
  batchId: string;
  kind: "deposit" | "payment";
  created: Array<{
    userId: string;
    ledgerEntry: LedgerEntry;
    depositEvent: CoinDeposit | null;
  }>;
  skipped: Array<{ userId: string; reason: string }>;
  errors: Array<{ userId: string; message: string }>;
  summary: {
    requested: number;
    created: number;
    skipped: number;
    errors: number;
  };
};

export type AdminEventActivitySeedResult = {
  batchId: string;
  targets: Array<{
    marketId: string;
    title: string;
    scope: {
      scopeType: "market" | "event";
      scopeId: string;
      marketExternalId: string;
    };
    grouped: boolean;
    plannedBets: number;
    tradesCreated: number;
  }>;
  depositsCreated: number;
  tradesCreated: number;
  skipped: Array<{ scopeId?: string; marketId?: string; userId?: string; reason: string }>;
  errors: Array<{ scopeId?: string; marketId?: string; userId?: string; message: string }>;
  summary: {
    eventsProcessed: number;
    plannedTrades: number;
    depositsCreated: number;
    tradesCreated: number;
    skipped: number;
    errors: number;
  };
};

export type PlatformActivityItem = {
  id: string;
  type: "deposit" | "payment" | "trade";
  displayName: string;
  amountCoinMicros: CoinMicros;
  currency: "COIN";
  marketTitle: string | null;
  createdAt: string;
  relativeTime: string;
};

export type PlatformActivityPayload = {
  activity: PlatformActivityItem[];
};
