import {
  findVerifiedRealMoneyProviderAdapter,
  verifiedRealMoneyProviderAdapters,
  type VerifiedRealMoneyProviderAdapterEvidence,
  type VerifiedRealMoneyProviderAdapterRegistry,
} from "./realMoneyProviderAdapters.js";
import { findDisallowedIdentityDocumentTerm } from "./identityDocumentPolicy.js";

export const MONEY_MOVEMENT_REVIEW_MODE = "wallet_review_only" as const;
export const MONEY_MOVEMENT_REAL_MONEY_MODE = "real_money" as const;
export const MONEY_MOVEMENT_REVIEW_WARNING =
  "Wallet requests are reviewed before processing.";
export const MONEY_MOVEMENT_REAL_MONEY_WARNING =
  "Real-money transfers are enabled through verified provider adapters.";
export const MONEY_MOVEMENT_DISABLED_REASON = "TRANSFERS_UNAVAILABLE" as const;
export const REAL_MONEY_INFRASTRUCTURE_STATUS_NOT_CONFIGURED = "not_configured" as const;
export const REAL_MONEY_INFRASTRUCTURE_STATUS_DECLARED_UNVERIFIED =
  "declared_unverified" as const;
export const REAL_MONEY_INFRASTRUCTURE_STATUS_INVALID = "invalid" as const;
export const REAL_MONEY_INFRASTRUCTURE_STATUS_VERIFIED = "verified" as const;
export const REAL_MONEY_PROVIDER_NONE = "none" as const;
export const LOCAL_DEPOSIT_WEBHOOK_DISABLED_REASON =
  "LOCAL_DEPOSIT_WEBHOOK_DISABLED" as const;
export const LOCAL_DEPOSIT_WEBHOOK_PRODUCTION_DISABLED_REASON =
  "LOCAL_DEPOSIT_WEBHOOK_PRODUCTION_DISABLED" as const;
export const LOCAL_DEPOSIT_WEBHOOK_APP_MODE_DISABLED_REASON =
  "LOCAL_DEPOSIT_WEBHOOK_APP_MODE_DISABLED" as const;
export const LOCAL_MANUAL_DEPOSIT_APPROVAL_DISABLED_REASON =
  "LOCAL_MANUAL_DEPOSIT_APPROVAL_DISABLED" as const;
export const LOCAL_MANUAL_DEPOSIT_APPROVAL_PRODUCTION_DISABLED_REASON =
  "LOCAL_MANUAL_DEPOSIT_APPROVAL_PRODUCTION_DISABLED" as const;
export const LOCAL_MANUAL_DEPOSIT_APPROVAL_APP_MODE_DISABLED_REASON =
  "LOCAL_MANUAL_DEPOSIT_APPROVAL_APP_MODE_DISABLED" as const;

export type LocalDepositWebhookBlockReason =
  | typeof LOCAL_DEPOSIT_WEBHOOK_DISABLED_REASON
  | typeof LOCAL_DEPOSIT_WEBHOOK_PRODUCTION_DISABLED_REASON
  | typeof LOCAL_DEPOSIT_WEBHOOK_APP_MODE_DISABLED_REASON;

export type LocalManualDepositApprovalBlockReason =
  | typeof LOCAL_MANUAL_DEPOSIT_APPROVAL_DISABLED_REASON
  | typeof LOCAL_MANUAL_DEPOSIT_APPROVAL_PRODUCTION_DISABLED_REASON
  | typeof LOCAL_MANUAL_DEPOSIT_APPROVAL_APP_MODE_DISABLED_REASON;

export type RealMoneyInfrastructureRequirementCode =
  | "PRODUCTION_CUSTODY_PROVIDER_REQUIRED"
  | "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED"
  | "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED"
  | "PROVIDER_RECONCILIATION_REQUIRED"
  | "ACCOUNT_RISK_PROVIDER_REQUIRED"
  | "SANCTIONS_SCREENING_PROVIDER_REQUIRED"
  | "REAL_EXECUTION_VENUE_REQUIRED"
  | "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED"
  | "OPERATIONS_MONITORING_REQUIRED";

export type RealMoneyInfrastructureRequirement = {
  code: RealMoneyInfrastructureRequirementCode;
  status: "missing" | "declared_unverified" | "invalid" | "verified";
  message: string;
  configured: boolean;
  provider: string | null;
  verifiedAdapterId?: string;
  verificationEvidence?: readonly VerifiedRealMoneyProviderAdapterEvidence[];
  availableVerifiedAdapterIds?: string[];
  availableVerifiedProviders?: Array<string | null>;
};

export type RealMoneyInfrastructure = {
  status:
    | typeof REAL_MONEY_INFRASTRUCTURE_STATUS_NOT_CONFIGURED
    | typeof REAL_MONEY_INFRASTRUCTURE_STATUS_DECLARED_UNVERIFIED
    | typeof REAL_MONEY_INFRASTRUCTURE_STATUS_INVALID
    | typeof REAL_MONEY_INFRASTRUCTURE_STATUS_VERIFIED;
  provider: string;
  custodyProvider: string;
  depositProvider: string;
  withdrawalProvider: string;
  executionProvider: string;
  reconciliationProvider: string;
  accountRiskProvider: string;
  sanctionsProvider: string;
  ledgerSettlementReconciliationConfigured: boolean;
  operationsMonitoringConfigured: boolean;
  requirements: RealMoneyInfrastructureRequirement[];
  missingRequirementCodes: RealMoneyInfrastructureRequirementCode[];
  declaredRequirementCodes: RealMoneyInfrastructureRequirementCode[];
  verifiedRequirementCodes: RealMoneyInfrastructureRequirementCode[];
};

type RealMoneyRequirementTemplate = {
  code: RealMoneyInfrastructureRequirementCode;
  missingMessage: string;
  declaredUnverifiedMessage: string;
};

const REAL_MONEY_REQUIREMENTS: RealMoneyRequirementTemplate[] = [
  {
    code: "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
    missingMessage: "Production custody/signing provider is not configured.",
    declaredUnverifiedMessage:
      "Production custody/signing provider is declared but no verified custody adapter is implemented.",
  },
  {
    code: "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
    missingMessage: "Deposit webhook provider with signature verification is not configured.",
    declaredUnverifiedMessage:
      "Deposit webhook provider is declared but no verified signed webhook adapter is implemented.",
  },
  {
    code: "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED",
    missingMessage: "Withdrawal signing and broadcast provider is not configured.",
    declaredUnverifiedMessage:
      "Withdrawal signing and broadcast provider is declared but no verified broadcast adapter is implemented.",
  },
  {
    code: "PROVIDER_RECONCILIATION_REQUIRED",
    missingMessage: "Provider reconciliation for deposits, withdrawals, and ledger rows is not configured.",
    declaredUnverifiedMessage:
      "Provider reconciliation is declared but no verified reconciliation workflow is implemented.",
  },
  {
    code: "ACCOUNT_RISK_PROVIDER_REQUIRED",
    missingMessage:
      "Production account risk and allowed-region eligibility provider is not configured.",
    declaredUnverifiedMessage:
      "Production account risk provider is declared but no verified eligibility adapter is implemented.",
  },
  {
    code: "SANCTIONS_SCREENING_PROVIDER_REQUIRED",
    missingMessage: "Production sanctions screening provider is not configured.",
    declaredUnverifiedMessage:
      "Production sanctions screening provider is declared but no verified screening adapter is implemented.",
  },
  {
    code: "REAL_EXECUTION_VENUE_REQUIRED",
    missingMessage: "Real order execution venue and settlement integration is not configured.",
    declaredUnverifiedMessage:
      "Real order execution venue is declared but no verified execution and settlement adapter is implemented.",
  },
  {
    code: "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED",
    missingMessage: "Production ledger settlement and reconciliation workflow is not configured.",
    declaredUnverifiedMessage:
      "Production ledger settlement and reconciliation workflow is declared but no verified workflow is implemented.",
  },
  {
    code: "OPERATIONS_MONITORING_REQUIRED",
    missingMessage: "Money movement monitoring, alerting, and incident runbooks are not configured.",
    declaredUnverifiedMessage:
      "Money movement monitoring, alerting, and runbooks are declared but no verified operational gate is implemented.",
  },
];

export type MoneyMovementCapabilities = {
  mode: typeof MONEY_MOVEMENT_REVIEW_MODE | typeof MONEY_MOVEMENT_REAL_MONEY_MODE;
  warning: typeof MONEY_MOVEMENT_REVIEW_WARNING | typeof MONEY_MOVEMENT_REAL_MONEY_WARNING;
  realMoneyEnabled: boolean;
  canUseRealMoney: boolean;
  deposits: {
    realTransfersEnabled: boolean;
    localWebhookConfigured: boolean;
    localWebhookEnabled: boolean;
    localWebhookCreditEnabled: boolean;
    localWebhookBlockReason: LocalDepositWebhookBlockReason | null;
  };
  withdrawals: {
    realTransfersEnabled: boolean;
    realTransferBlocked: boolean;
    blockReason: typeof MONEY_MOVEMENT_DISABLED_REASON | null;
    requiresManualReview: boolean;
  };
  admin: {
    manualDepositApprovalConfigured: boolean;
    manualDepositApprovalEnabled: boolean;
    manualDepositCreditEnabled: boolean;
    manualDepositBlockReason: LocalManualDepositApprovalBlockReason | null;
  };
  realMoneyInfrastructure: RealMoneyInfrastructure;
};

export type MoneyMovementReadinessBlockerCode =
  | "MONEY_MOVEMENT_PROVIDER_DISABLED"
  | "COMPLIANCE_REAL_MONEY_DISABLED"
  | "WITHDRAWALS_TRANSFER_BLOCKED"
  | "REAL_MONEY_INFRASTRUCTURE_STATUS_UNRECOGNIZED"
  | RealMoneyInfrastructureRequirementCode;

export type MoneyMovementReadinessBlocker = {
  source: "money_movement";
  code: MoneyMovementReadinessBlockerCode;
  message: string;
};

type MoneyMovementConfig = {
  appMode?: string;
  nodeEnv?: string;
  productionDeployment?: boolean;
  walletDepositWebhookEnabled?: boolean;
  adminManualDepositApprovalEnabled?: boolean;
  realMoneyCustodyProvider?: string | null;
  realMoneyDepositProvider?: string | null;
  realMoneyWithdrawalProvider?: string | null;
  realMoneyExecutionProvider?: string | null;
  realMoneyReconciliationProvider?: string | null;
  realMoneyAccountRiskProvider?: string | null;
  realMoneySanctionsProvider?: string | null;
  realMoneyLedgerSettlementReconciliationConfigured?: boolean;
  realMoneyOperationsMonitoringConfigured?: boolean;
  verifiedRealMoneyProviderAdapters?: VerifiedRealMoneyProviderAdapterRegistry;
};

export function buildMoneyMovementCapabilities(
  config: MoneyMovementConfig = {},
): MoneyMovementCapabilities {
  const realMoneyInfrastructure = buildRealMoneyInfrastructure(config);
  const localWebhookBlockReason = getLocalDepositWebhookBlockReason(config);
  const localWebhookCreditEnabled = localWebhookBlockReason === null;
  const manualDepositBlockReason = getLocalManualDepositApprovalBlockReason(config);
  const manualDepositCreditEnabled = manualDepositBlockReason === null;
  const realTransfersEnabled = isRealMoneyTransferRuntimeEnabled(
    config,
    realMoneyInfrastructure,
  );

  return {
    mode: realTransfersEnabled ? MONEY_MOVEMENT_REAL_MONEY_MODE : MONEY_MOVEMENT_REVIEW_MODE,
    warning: realTransfersEnabled
      ? MONEY_MOVEMENT_REAL_MONEY_WARNING
      : MONEY_MOVEMENT_REVIEW_WARNING,
    realMoneyEnabled: realTransfersEnabled,
    canUseRealMoney: realTransfersEnabled,
    deposits: {
      realTransfersEnabled,
      localWebhookConfigured: Boolean(config.walletDepositWebhookEnabled),
      localWebhookEnabled: localWebhookCreditEnabled,
      localWebhookCreditEnabled,
      localWebhookBlockReason,
    },
    withdrawals: {
      realTransfersEnabled,
      realTransferBlocked: !realTransfersEnabled,
      blockReason: realTransfersEnabled ? null : MONEY_MOVEMENT_DISABLED_REASON,
      requiresManualReview: !realTransfersEnabled,
    },
    admin: {
      manualDepositApprovalConfigured: Boolean(config.adminManualDepositApprovalEnabled),
      manualDepositApprovalEnabled: manualDepositCreditEnabled,
      manualDepositCreditEnabled,
      manualDepositBlockReason,
    },
    realMoneyInfrastructure,
  };
}

function isRealMoneyTransferRuntimeEnabled(
  config: MoneyMovementConfig,
  infrastructure: RealMoneyInfrastructure,
) {
  return (
    config.appMode === MONEY_MOVEMENT_REAL_MONEY_MODE &&
    config.nodeEnv === "production" &&
    config.productionDeployment === true &&
    infrastructure.status === REAL_MONEY_INFRASTRUCTURE_STATUS_VERIFIED
  );
}

function getLocalDepositWebhookBlockReason(
  config: MoneyMovementConfig,
): LocalDepositWebhookBlockReason | null {
  if (!config.walletDepositWebhookEnabled) {
    return LOCAL_DEPOSIT_WEBHOOK_DISABLED_REASON;
  }

  if (config.productionDeployment || config.nodeEnv === "production") {
    return LOCAL_DEPOSIT_WEBHOOK_PRODUCTION_DISABLED_REASON;
  }

  if (config.appMode && config.appMode !== "local") {
    return LOCAL_DEPOSIT_WEBHOOK_APP_MODE_DISABLED_REASON;
  }

  return null;
}

function getLocalManualDepositApprovalBlockReason(
  config: MoneyMovementConfig,
): LocalManualDepositApprovalBlockReason | null {
  if (!config.adminManualDepositApprovalEnabled) {
    return LOCAL_MANUAL_DEPOSIT_APPROVAL_DISABLED_REASON;
  }

  if (config.productionDeployment || config.nodeEnv === "production") {
    return LOCAL_MANUAL_DEPOSIT_APPROVAL_PRODUCTION_DISABLED_REASON;
  }

  if (config.appMode && config.appMode !== "local") {
    return LOCAL_MANUAL_DEPOSIT_APPROVAL_APP_MODE_DISABLED_REASON;
  }

  return null;
}

export function buildRealMoneyInfrastructure(
  config: MoneyMovementConfig = {},
): RealMoneyInfrastructure {
  const custodyProvider = normalizeProvider(config.realMoneyCustodyProvider);
  const depositProvider = normalizeProvider(config.realMoneyDepositProvider);
  const withdrawalProvider = normalizeProvider(config.realMoneyWithdrawalProvider);
  const executionProvider = normalizeProvider(config.realMoneyExecutionProvider);
  const reconciliationProvider = normalizeProvider(config.realMoneyReconciliationProvider);
  const accountRiskProvider = normalizeProvider(config.realMoneyAccountRiskProvider);
  const sanctionsProvider = normalizeProvider(config.realMoneySanctionsProvider);
  const ledgerSettlementReconciliationConfigured = Boolean(
    config.realMoneyLedgerSettlementReconciliationConfigured,
  );
  const operationsMonitoringConfigured = Boolean(config.realMoneyOperationsMonitoringConfigured);
  const adapterRegistry =
    config.verifiedRealMoneyProviderAdapters ?? verifiedRealMoneyProviderAdapters;
  const configuredByCode: Record<RealMoneyInfrastructureRequirementCode, {
    configured: boolean;
    provider: string | null;
  }> = {
    PRODUCTION_CUSTODY_PROVIDER_REQUIRED: {
      configured: custodyProvider !== REAL_MONEY_PROVIDER_NONE,
      provider: providerOrNull(custodyProvider),
    },
    SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED: {
      configured: depositProvider !== REAL_MONEY_PROVIDER_NONE,
      provider: providerOrNull(depositProvider),
    },
    WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED: {
      configured: withdrawalProvider !== REAL_MONEY_PROVIDER_NONE,
      provider: providerOrNull(withdrawalProvider),
    },
    PROVIDER_RECONCILIATION_REQUIRED: {
      configured: reconciliationProvider !== REAL_MONEY_PROVIDER_NONE,
      provider: providerOrNull(reconciliationProvider),
    },
    ACCOUNT_RISK_PROVIDER_REQUIRED: {
      configured: accountRiskProvider !== REAL_MONEY_PROVIDER_NONE,
      provider: providerOrNull(accountRiskProvider),
    },
    SANCTIONS_SCREENING_PROVIDER_REQUIRED: {
      configured: sanctionsProvider !== REAL_MONEY_PROVIDER_NONE,
      provider: providerOrNull(sanctionsProvider),
    },
    REAL_EXECUTION_VENUE_REQUIRED: {
      configured: executionProvider !== REAL_MONEY_PROVIDER_NONE,
      provider: providerOrNull(executionProvider),
    },
    LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED: {
      configured: ledgerSettlementReconciliationConfigured,
      provider: null,
    },
    OPERATIONS_MONITORING_REQUIRED: {
      configured: operationsMonitoringConfigured,
      provider: null,
    },
  };
  const requirements = REAL_MONEY_REQUIREMENTS.map((requirement) => {
    const configured = configuredByCode[requirement.code];
    const disallowedProviderTerm = configured.provider
      ? findDisallowedIdentityDocumentTerm(configured.provider)
      : null;
    const availableVerifiedAdapters = getAvailableVerifiedAdaptersForRequirement(
      adapterRegistry,
      requirement.code,
    );
    const verifiedAdapter = configured.configured && !disallowedProviderTerm
      ? findVerifiedRealMoneyProviderAdapter(
          adapterRegistry,
          requirement.code,
          configured.provider,
        )
      : undefined;
    return {
      code: requirement.code,
      status: !configured.configured
        ? "missing"
        : disallowedProviderTerm
          ? "invalid"
          : verifiedAdapter
          ? "verified"
          : "declared_unverified",
      message: !configured.configured
        ? requirement.missingMessage
        : disallowedProviderTerm
          ? buildDisallowedProviderRequirementMessage(configured.provider, disallowedProviderTerm)
        : verifiedAdapter
          ? "Verified real-money provider adapter is configured."
          : buildDeclaredUnverifiedRequirementMessage(
              requirement.declaredUnverifiedMessage,
              configured.provider,
              availableVerifiedAdapters,
            ),
      configured: configured.configured,
      provider: configured.provider,
      verifiedAdapterId: verifiedAdapter?.adapterId,
      verificationEvidence: verifiedAdapter?.evidence,
      availableVerifiedAdapterIds:
        availableVerifiedAdapters.length > 0
          ? availableVerifiedAdapters.map((adapter) => adapter.adapterId)
          : undefined,
      availableVerifiedProviders:
        availableVerifiedAdapters.length > 0
          ? availableVerifiedAdapters.map((adapter) => adapter.provider)
          : undefined,
    } satisfies RealMoneyInfrastructureRequirement;
  });
  const declaredRequirementCodes = requirements
    .filter((requirement) => requirement.configured)
    .map((requirement) => requirement.code);
  const verifiedRequirementCodes = requirements
    .filter((requirement) => requirement.status === "verified")
    .map((requirement) => requirement.code);
  const invalidRequirementCodes = requirements
    .filter((requirement) => requirement.status === "invalid")
    .map((requirement) => requirement.code);
  const infrastructureStatus =
    invalidRequirementCodes.length > 0
      ? REAL_MONEY_INFRASTRUCTURE_STATUS_INVALID
      : declaredRequirementCodes.length === 0
      ? REAL_MONEY_INFRASTRUCTURE_STATUS_NOT_CONFIGURED
      : verifiedRequirementCodes.length === requirements.length
        ? REAL_MONEY_INFRASTRUCTURE_STATUS_VERIFIED
        : REAL_MONEY_INFRASTRUCTURE_STATUS_DECLARED_UNVERIFIED;

  return {
    status: infrastructureStatus,
    provider: custodyProvider,
    custodyProvider,
    depositProvider,
    withdrawalProvider,
    executionProvider,
    reconciliationProvider,
    accountRiskProvider,
    sanctionsProvider,
    ledgerSettlementReconciliationConfigured,
    operationsMonitoringConfigured,
    requirements,
    missingRequirementCodes: requirements
      .filter((requirement) => requirement.status !== "verified")
      .map((requirement) => requirement.code),
    declaredRequirementCodes,
    verifiedRequirementCodes,
  };
}

function normalizeProvider(value: string | null | undefined): string {
  const provider = value?.trim().toLowerCase().replace(/\s+/g, "-");
  return provider || REAL_MONEY_PROVIDER_NONE;
}

function providerOrNull(provider: string): string | null {
  return provider === REAL_MONEY_PROVIDER_NONE ? null : provider;
}

function getAvailableVerifiedAdaptersForRequirement(
  registry: VerifiedRealMoneyProviderAdapterRegistry,
  requirementCode: RealMoneyInfrastructureRequirementCode,
) {
  const seenAdapterIds = new Set<string>();
  return registry.filter((adapter) => {
    if (adapter.requirementCode !== requirementCode || seenAdapterIds.has(adapter.adapterId)) {
      return false;
    }
    const verifiedAdapter = findVerifiedRealMoneyProviderAdapter(
      registry,
      requirementCode,
      adapter.provider,
    );
    if (verifiedAdapter?.adapterId !== adapter.adapterId) {
      return false;
    }

    seenAdapterIds.add(adapter.adapterId);
    return true;
  });
}

function buildDeclaredUnverifiedRequirementMessage(
  baseMessage: string,
  configuredProvider: string | null,
  availableVerifiedAdapters: ReturnType<typeof getAvailableVerifiedAdaptersForRequirement>,
) {
  const providerDescription = configuredProvider ?? "internal workflow";
  if (availableVerifiedAdapters.length === 0) {
    return `${baseMessage} Configured provider: ${providerDescription}; no verified adapter exists for this requirement.`;
  }

  const availableProviders = availableVerifiedAdapters
    .map((adapter) => adapter.provider ?? "internal workflow")
    .join(", ");
  const availableAdapterIds = availableVerifiedAdapters
    .map((adapter) => adapter.adapterId)
    .join(", ");
  return `${baseMessage} Configured provider: ${providerDescription}; available verified providers: ${availableProviders}; available adapter ids: ${availableAdapterIds}.`;
}

export function getRealMoneyReadinessBlockers(
  capabilities: MoneyMovementCapabilities,
) {
  return getRealMoneyReadinessBlockerDetails(capabilities).map((blocker) => blocker.message);
}

export function getRealMoneyReadinessBlockerDetails(
  capabilities: MoneyMovementCapabilities,
): MoneyMovementReadinessBlocker[] {
  const details: MoneyMovementReadinessBlocker[] = [];
  const addBlocker = (code: MoneyMovementReadinessBlockerCode, message: string) => {
    details.push({
      source: "money_movement",
      code,
      message,
    });
  };

  if (!capabilities.realMoneyEnabled) {
    addBlocker(
      "MONEY_MOVEMENT_PROVIDER_DISABLED",
      "Money movement provider is disabled; no real-money mode exists yet.",
    );
  }
  if (!capabilities.canUseRealMoney) {
    addBlocker(
      "COMPLIANCE_REAL_MONEY_DISABLED",
      "Compliance eligibility returns canUseRealMoney=false.",
    );
  }
  if (capabilities.withdrawals.realTransferBlocked) {
    addBlocker(
      "WITHDRAWALS_TRANSFER_BLOCKED",
      `Withdrawals are blocked with ${capabilities.withdrawals.blockReason ?? MONEY_MOVEMENT_DISABLED_REASON} and remain manual-review only.`,
    );
  }
  if (
    ![
      REAL_MONEY_INFRASTRUCTURE_STATUS_NOT_CONFIGURED,
      REAL_MONEY_INFRASTRUCTURE_STATUS_DECLARED_UNVERIFIED,
      REAL_MONEY_INFRASTRUCTURE_STATUS_INVALID,
      REAL_MONEY_INFRASTRUCTURE_STATUS_VERIFIED,
    ].includes(capabilities.realMoneyInfrastructure.status)
  ) {
    addBlocker(
      "REAL_MONEY_INFRASTRUCTURE_STATUS_UNRECOGNIZED",
      "Real-money infrastructure status is not recognized by this runtime.",
    );
  }
  if (
    !capabilities.deposits.realTransfersEnabled ||
    !capabilities.withdrawals.realTransfersEnabled
  ) {
    for (const requirement of capabilities.realMoneyInfrastructure.requirements) {
      if (requirement.status !== "verified") {
        addBlocker(requirement.code, requirement.message);
      }
    }
  }

  return details;
}

function buildDisallowedProviderRequirementMessage(
  configuredProvider: string | null,
  disallowedTerm: string,
) {
  const providerDescription = configuredProvider ?? "internal workflow";
  return (
    `Configured provider ${providerDescription} references disallowed ` +
    `user-paperwork collection metadata (${disallowedTerm}). Configure account-risk, ` +
    "sanctions, custody, execution, or reconciliation providers only."
  );
}
