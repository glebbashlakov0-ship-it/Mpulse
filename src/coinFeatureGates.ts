export const COIN_DEPOSIT_CREDITS_DISABLED =
  "COIN_DEPOSIT_CREDITS_DISABLED" as const;
export const COIN_DEPOSIT_SIGNED_WEBHOOK_REQUIRED =
  "COIN_DEPOSIT_SIGNED_WEBHOOK_REQUIRED" as const;
export const COIN_DEPOSIT_RATE_PROVIDER_REQUIRED =
  "COIN_DEPOSIT_RATE_PROVIDER_REQUIRED" as const;
export const COIN_DEPOSIT_CONTRACT_REQUIRED =
  "COIN_DEPOSIT_CONTRACT_REQUIRED" as const;
export const COIN_WITHDRAWAL_REQUESTS_DISABLED =
  "COIN_WITHDRAWAL_REQUESTS_DISABLED" as const;
export const COIN_WITHDRAWAL_RATE_PROVIDER_REQUIRED =
  "COIN_WITHDRAWAL_RATE_PROVIDER_REQUIRED" as const;
export const COIN_INTERNAL_TRADING_DISABLED =
  "COIN_INTERNAL_TRADING_DISABLED" as const;

type CoinFeatureGateConfig = {
  coinDepositCreditsEnabled?: boolean;
  coinWithdrawalRequestsEnabled?: boolean;
  coinInternalTradingEnabled?: boolean;
  walletDepositWebhookEnabled?: boolean;
  realMoneyDepositProvider?: string | null;
  exchangeRateProvider?: string;
  usdtTronContract?: string | null;
};

export type CoinFeatureCapabilities = {
  deposits: {
    requested: boolean;
    intentCreationEnabled: boolean;
    creditsEnabled: boolean;
    signedWebhookIngestionEnabled: boolean;
    blockReason:
      | typeof COIN_DEPOSIT_CREDITS_DISABLED
      | typeof COIN_DEPOSIT_SIGNED_WEBHOOK_REQUIRED
      | typeof COIN_DEPOSIT_RATE_PROVIDER_REQUIRED
      | typeof COIN_DEPOSIT_CONTRACT_REQUIRED
      | null;
  };
  withdrawals: {
    requested: boolean;
    requestsEnabled: boolean;
    reviewOnly: true;
    broadcastEnabled: false;
    blockReason:
      | typeof COIN_WITHDRAWAL_REQUESTS_DISABLED
      | typeof COIN_WITHDRAWAL_RATE_PROVIDER_REQUIRED
      | null;
  };
  trading: {
    requested: boolean;
    internalExecutionEnabled: boolean;
    externalExecutionEnabled: false;
    blockReason: typeof COIN_INTERNAL_TRADING_DISABLED | null;
  };
  outboundFundsProviderCallsEnabled: false;
};

export function buildCoinFeatureCapabilities(
  config: CoinFeatureGateConfig,
): CoinFeatureCapabilities {
  const depositRequested = config.coinDepositCreditsEnabled === true;
  const signedWebhookIngestionEnabled =
    config.walletDepositWebhookEnabled === true &&
    normalizeProvider(config.realMoneyDepositProvider) === "fireblocks";
  const rateProviderEnabled =
    Boolean(config.exchangeRateProvider) &&
    config.exchangeRateProvider !== "disabled";
  const contractConfigured = Boolean(config.usdtTronContract?.trim());
  const depositBlockReason = !depositRequested
    ? COIN_DEPOSIT_CREDITS_DISABLED
    : !signedWebhookIngestionEnabled
      ? COIN_DEPOSIT_SIGNED_WEBHOOK_REQUIRED
      : !rateProviderEnabled
        ? COIN_DEPOSIT_RATE_PROVIDER_REQUIRED
        : !contractConfigured
          ? COIN_DEPOSIT_CONTRACT_REQUIRED
          : null;

  const withdrawalRequested = config.coinWithdrawalRequestsEnabled === true;
  const withdrawalBlockReason = !withdrawalRequested
    ? COIN_WITHDRAWAL_REQUESTS_DISABLED
    : !rateProviderEnabled
      ? COIN_WITHDRAWAL_RATE_PROVIDER_REQUIRED
      : null;

  const internalTradingEnabled = config.coinInternalTradingEnabled === true;

  return {
    deposits: {
      requested: depositRequested,
      intentCreationEnabled: depositBlockReason === null,
      creditsEnabled: depositBlockReason === null,
      signedWebhookIngestionEnabled,
      blockReason: depositBlockReason,
    },
    withdrawals: {
      requested: withdrawalRequested,
      requestsEnabled: withdrawalBlockReason === null,
      reviewOnly: true,
      broadcastEnabled: false,
      blockReason: withdrawalBlockReason,
    },
    trading: {
      requested: internalTradingEnabled,
      internalExecutionEnabled: internalTradingEnabled,
      externalExecutionEnabled: false,
      blockReason: internalTradingEnabled
        ? null
        : COIN_INTERNAL_TRADING_DISABLED,
    },
    outboundFundsProviderCallsEnabled: false,
  };
}

export function assertCoinFeatureGateConfiguration(
  config: CoinFeatureGateConfig,
) {
  const capabilities = buildCoinFeatureCapabilities(config);

  if (
    capabilities.deposits.requested &&
    !capabilities.deposits.creditsEnabled
  ) {
    throw new Error(
      `COIN_DEPOSIT_CREDITS_ENABLED=true is unsafe: ${capabilities.deposits.blockReason}.`,
    );
  }
  if (
    capabilities.withdrawals.requested &&
    !capabilities.withdrawals.requestsEnabled
  ) {
    throw new Error(
      `COIN_WITHDRAWAL_REQUESTS_ENABLED=true is unsafe: ${capabilities.withdrawals.blockReason}.`,
    );
  }
}

function normalizeProvider(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, "-") ?? "";
}
