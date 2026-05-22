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
  rewards?: {
    enabled: boolean;
    daily_rate: number;
    holding: boolean;
    min_size: number | null;
    max_spread: number | null;
  };
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
      outcomes?: Array<{ name: string; price: number | null }>;
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
  walletId: string;
  marketId: string;
  marketTitle: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  amount: number;
  price: number;
  shares: number;
  realizedPnl: number | null;
  idempotencyKey: string | null;
  createdAt: string;
};

export type LocalPosition = {
  id: string;
  userId: string;
  marketId: string;
  marketTitle: string;
  yesShares: number;
  noShares: number;
  yesCost: number;
  noCost: number;
  totalCost: number;
  lastYesPrice: number | null;
  lastNoPrice: number | null;
  currentValue: number;
  pnl: number;
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
  yesShares: number;
  noShares: number;
  shares: number;
  value: number;
  updatedAt: string;
};

export type MarketPublicPosition = {
  id: string;
  userId: string;
  displayName: string;
  side: "yes" | "no";
  shares: number;
  totalCost: number;
  averagePrice: number | null;
  lastPrice: number | null;
  value: number;
  pnl: number;
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
      amount: number;
      price: number;
      shares: number;
      createdAt: string;
    }
  | (MarketComment & {
      type: "comment";
    });

export type MarketActivityPayload = {
  comments: MarketComment[];
  topHolders: MarketHolder[];
  positions: MarketPublicPosition[];
  activity: MarketActivityItem[];
};

export type LocalUser = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type LocalWallet = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  balance: number;
  initialBalance: number;
  updatedAt: string;
};

export type WalletCoreMode = "wallet_review_only";

export type WalletProviderStatus = {
  provider: "internal_wallet";
  network: "TRON";
  status: "available";
  realTransfersEnabled: false;
};

export type Wallet = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  address: string;
  status: "pending" | "active" | "disabled";
  provider: "internal_wallet";
  createdAt: string;
  updatedAt: string;
};

export type WalletCorePayload = {
  mode: WalletCoreMode;
  warning: string;
};

export type MyWalletPayload = WalletCorePayload & {
  wallet: Wallet;
  created: boolean;
  providerStatus: WalletProviderStatus;
};

export type DepositIntent = {
  id: string;
  userId: string;
  walletId: string;
  asset: "USDT";
  network: "TRON";
  address: string;
  expectedAmount: number;
  status: "waiting" | "detected" | "credited" | "expired" | "rejected";
  memo: string | null;
  reference: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type WalletDepositEvent = {
  id: string;
  txHash: string;
  logIndex: string;
  walletId: string | null;
  userId: string | null;
  amount: number;
  asset: "USDT";
  network: "TRON";
  confirmations: number;
  status: "detected" | "confirmed" | "credited" | "rejected" | "manual_review";
  provider: string;
  recipientAddress: string | null;
  rejectionReason: string | null;
  creditedLedgerEntryId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WalletDepositsPayload = WalletCorePayload & {
  depositIntents: DepositIntent[];
  depositEvents: WalletDepositEvent[];
};

export type WithdrawalRequest = {
  id: string;
  userId: string;
  asset: "USDT";
  network: "TRON";
  destinationAddress: string;
  amount: number;
  status:
    | "draft"
    | "pending_review"
    | "approved_for_review"
    | "approved"
    | "rejected"
    | "cancelled"
    | "broadcast_pending"
    | "broadcasted"
    | "failed";
  idempotencyKey: string;
  provider: "internal_wallet";
  realTransferBlocked: true;
  blockReason: "TRANSFERS_UNAVAILABLE";
  createdAt: string;
  updatedAt: string;
};

export type WithdrawalRequestsPayload = WalletCorePayload & {
  withdrawalRequests: WithdrawalRequest[];
};

export type CreateWithdrawalPayload = WalletCorePayload & {
  withdrawalRequest: WithdrawalRequest;
  idempotent: boolean;
  compliance: {
    canUseRealMoney: boolean;
    realTransferBlocked: true;
    reason: "TRANSFERS_UNAVAILABLE";
  };
};

export type CreateDepositIntentPayload = WalletCorePayload & {
  depositIntent: DepositIntent;
  wallet: Wallet;
  walletCreated: boolean;
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
  mode: "local_ledger";
  balance: LedgerBalance;
};

export type LedgerEntriesPayload = {
  mode: "local_ledger";
  entries: LedgerEntry[];
};

export type LocalLedgerCreditPayload = {
  mode: "local_ledger";
  complianceMode: "ledger_restricted";
  warning: string;
  entry: LedgerEntry;
  balance: LedgerBalance;
  idempotent: boolean;
};

export type PortfolioSummary = {
  cash: number;
  positionValue: number;
  invested: number;
  equity: number;
  pnl: number;
  pnlPercent: number;
  openPositions: number;
};

export type Portfolio = {
  user: LocalUser;
  wallet: LocalWallet;
  trades: Trade[];
  positions: LocalPosition[];
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
  currency: "USDT";
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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminUsersPayload = {
  mode: string;
  users: AuthUser[];
  summary: Record<string, number>;
};

export type AdminAuditPayload = {
  mode: string;
  auditLogs: AuditLog[];
  hiddenMarkets: HiddenMarketRule[];
};

export type AdminWithdrawalsPayload = {
  mode: "wallet_review_only";
  realTransferBlocked: true;
  warning: string;
  withdrawalRequests: AdminWithdrawalRequest[];
};
