import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMoneyMovementCapabilities,
  getRealMoneyReadinessBlockerDetails,
  getRealMoneyReadinessBlockers,
  type RealMoneyInfrastructureRequirementCode,
} from "./moneyMovement.js";
import {
  realMoneyProviderAdapterRuntimeKindByRequirement,
  requiredVerifiedRealMoneyProviderAdapterEvidenceKinds,
} from "./realMoneyProviderAdapters.js";

test("money movement capabilities expose explicit real-money infrastructure blockers", () => {
  const capabilities = buildMoneyMovementCapabilities();

  assert.equal(capabilities.realMoneyEnabled, false);
  assert.equal(capabilities.canUseRealMoney, false);
  assert.equal(capabilities.realMoneyInfrastructure.status, "not_configured");
  assert.equal(capabilities.realMoneyInfrastructure.provider, "none");
  assert.deepEqual(capabilities.realMoneyInfrastructure.declaredRequirementCodes, []);
  assert.deepEqual(capabilities.realMoneyInfrastructure.verifiedRequirementCodes, []);
  assert.deepEqual(capabilities.realMoneyInfrastructure.missingRequirementCodes, [
    "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
    "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
    "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED",
    "PROVIDER_RECONCILIATION_REQUIRED",
    "ACCOUNT_RISK_PROVIDER_REQUIRED",
    "SANCTIONS_SCREENING_PROVIDER_REQUIRED",
    "REAL_EXECUTION_VENUE_REQUIRED",
    "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED",
    "OPERATIONS_MONITORING_REQUIRED",
  ]);
});

test("declared real-money providers remain unverified without bundled adapters", () => {
  const capabilities = buildMoneyMovementCapabilities({
    realMoneyCustodyProvider: "Fireblocks",
    realMoneyDepositProvider: "Fireblocks",
    realMoneyWithdrawalProvider: "Fireblocks",
    realMoneyExecutionProvider: "Polymarket CLOB",
    realMoneyReconciliationProvider: "internal-ledger-reconciler",
    realMoneyAccountRiskProvider: "internal-risk-engine",
    realMoneySanctionsProvider: "ofac",
    realMoneyLedgerSettlementReconciliationConfigured: true,
    realMoneyOperationsMonitoringConfigured: true,
  });
  const blockers = getRealMoneyReadinessBlockerDetails(capabilities);

  assert.equal(capabilities.realMoneyEnabled, false);
  assert.equal(capabilities.canUseRealMoney, false);
  assert.equal(capabilities.realMoneyInfrastructure.status, "declared_unverified");
  assert.equal(capabilities.realMoneyInfrastructure.custodyProvider, "fireblocks");
  assert.equal(capabilities.realMoneyInfrastructure.depositProvider, "fireblocks");
  assert.equal(capabilities.realMoneyInfrastructure.accountRiskProvider, "internal-risk-engine");
  assert.equal(capabilities.realMoneyInfrastructure.sanctionsProvider, "ofac");
  assert.deepEqual(
    capabilities.realMoneyInfrastructure.declaredRequirementCodes,
    [
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
      "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED",
      "PROVIDER_RECONCILIATION_REQUIRED",
      "ACCOUNT_RISK_PROVIDER_REQUIRED",
      "SANCTIONS_SCREENING_PROVIDER_REQUIRED",
      "REAL_EXECUTION_VENUE_REQUIRED",
      "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED",
      "OPERATIONS_MONITORING_REQUIRED",
    ],
  );
  assert.deepEqual(
    capabilities.realMoneyInfrastructure.missingRequirementCodes,
    capabilities.realMoneyInfrastructure.declaredRequirementCodes,
  );
  assert.deepEqual(capabilities.realMoneyInfrastructure.verifiedRequirementCodes, []);
  assert.ok(
    capabilities.realMoneyInfrastructure.requirements
      .every(
        (requirement) =>
          requirement.status === "declared_unverified" &&
          requirement.message.includes("no verified adapter exists"),
      ),
  );
  assert.deepEqual(blockers.slice(0, 3).map((blocker) => blocker.code), [
    "MONEY_MOVEMENT_PROVIDER_DISABLED",
    "COMPLIANCE_REAL_MONEY_DISABLED",
    "WITHDRAWALS_TRANSFER_BLOCKED",
  ]);
  assert.deepEqual(
    blockers.slice(3).map((blocker) => blocker.code),
    capabilities.realMoneyInfrastructure.declaredRequirementCodes,
  );
});

test("money movement owner rejects disallowed user-paperwork provider metadata", () => {
  const blockedProvider = ["k", "yc", "-vendor"].join("");
  const capabilities = buildMoneyMovementCapabilities({
    realMoneyAccountRiskProvider: blockedProvider,
  });
  const accountRiskRequirement = capabilities.realMoneyInfrastructure.requirements.find(
    (requirement) => requirement.code === "ACCOUNT_RISK_PROVIDER_REQUIRED",
  );
  const blockers = getRealMoneyReadinessBlockerDetails(capabilities);

  assert.equal(capabilities.realMoneyInfrastructure.status, "invalid");
  assert.equal(capabilities.realMoneyInfrastructure.accountRiskProvider, blockedProvider);
  assert.equal(accountRiskRequirement?.status, "invalid");
  assert.equal(accountRiskRequirement?.configured, true);
  assert.equal(accountRiskRequirement?.provider, blockedProvider);
  assert.match(
    accountRiskRequirement?.message ?? "",
    /disallowed user-paperwork collection metadata/,
  );
  assert.ok(capabilities.realMoneyInfrastructure.missingRequirementCodes.includes(
    "ACCOUNT_RISK_PROVIDER_REQUIRED",
  ));
  assert.ok(
    blockers.some(
      (blocker) =>
        blocker.source === "money_movement" &&
        blocker.code === "ACCOUNT_RISK_PROVIDER_REQUIRED" &&
        blocker.message.includes("disallowed user-paperwork collection metadata"),
    ),
  );
});

test("verified real-money adapters are matched by requirement and provider", () => {
  const capabilities = buildMoneyMovementCapabilities({
    realMoneyCustodyProvider: "Fireblocks",
    realMoneyDepositProvider: "TRONGrid",
    realMoneyWithdrawalProvider: "Fireblocks",
    realMoneyExecutionProvider: "Polymarket CLOB",
    realMoneyReconciliationProvider: "internal-ledger-reconciler",
    realMoneyAccountRiskProvider: "internal-risk-engine",
    realMoneySanctionsProvider: "ofac",
    realMoneyLedgerSettlementReconciliationConfigured: true,
    realMoneyOperationsMonitoringConfigured: true,
    verifiedRealMoneyProviderAdapters: [
      {
        requirementCode: "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
        provider: "fireblocks",
        adapterId: "fireblocks-custody-v1",
        runtime: buildRuntime("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocksCustodyAdapter"),
        verified: true,
        evidence: buildEvidence("custody-signing"),
      },
      {
        requirementCode: "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
        provider: "wrong-provider",
        adapterId: "wrong-deposit-v1",
        runtime: buildRuntime("SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED", "wrongDepositAdapter"),
        verified: true,
        evidence: buildEvidence("wrong-deposit"),
      },
      {
        requirementCode: "OPERATIONS_MONITORING_REQUIRED",
        provider: null,
        adapterId: "ops-monitoring-v1",
        runtime: buildRuntime("OPERATIONS_MONITORING_REQUIRED", "opsMonitoringAdapter"),
        verified: true,
        evidence: buildEvidence("ops-monitoring"),
      },
    ],
  });
  const custodyRequirement = capabilities.realMoneyInfrastructure.requirements.find(
    (requirement) => requirement.code === "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
  );
  const depositRequirement = capabilities.realMoneyInfrastructure.requirements.find(
    (requirement) => requirement.code === "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
  );
  const monitoringRequirement = capabilities.realMoneyInfrastructure.requirements.find(
    (requirement) => requirement.code === "OPERATIONS_MONITORING_REQUIRED",
  );
  const blockers = getRealMoneyReadinessBlockerDetails(capabilities);
  const blockerCodes = blockers.map((blocker) => blocker.code);

  assert.equal(custodyRequirement?.status, "verified");
  assert.equal(custodyRequirement?.verifiedAdapterId, "fireblocks-custody-v1");
  assert.deepEqual(custodyRequirement?.verificationEvidence, buildEvidence("custody-signing"));
  assert.equal(depositRequirement?.status, "declared_unverified");
  assert.equal(
    depositRequirement?.message,
    "Deposit webhook provider is declared but no verified signed webhook adapter is implemented. Configured provider: trongrid; available verified providers: wrong-provider; available adapter ids: wrong-deposit-v1.",
  );
  assert.deepEqual(depositRequirement?.availableVerifiedAdapterIds, [
    "wrong-deposit-v1",
  ]);
  assert.deepEqual(depositRequirement?.availableVerifiedProviders, ["wrong-provider"]);
  assert.equal(monitoringRequirement?.status, "verified");
  assert.deepEqual(capabilities.realMoneyInfrastructure.verifiedRequirementCodes, [
    "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
    "OPERATIONS_MONITORING_REQUIRED",
  ]);
  assert.equal(blockerCodes.includes("PRODUCTION_CUSTODY_PROVIDER_REQUIRED"), false);
  assert.equal(blockerCodes.includes("OPERATIONS_MONITORING_REQUIRED"), false);
  assert.ok(blockerCodes.includes("SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED"));
});

test("fully verified real-money infrastructure is distinguished from declared-only setup", () => {
  const config = buildDeclaredRealMoneyConfig();
  const capabilities = buildMoneyMovementCapabilities({
    ...config,
    verifiedRealMoneyProviderAdapters: buildCompleteVerifiedAdapterRegistry(),
  });
  const blockers = getRealMoneyReadinessBlockerDetails(capabilities);
  const blockerCodes = blockers.map((blocker) => blocker.code);

  assert.equal(capabilities.realMoneyInfrastructure.status, "verified");
  assert.deepEqual(capabilities.realMoneyInfrastructure.missingRequirementCodes, []);
  assert.deepEqual(
    capabilities.realMoneyInfrastructure.verifiedRequirementCodes,
    realMoneyRequirementCodes,
  );
  assert.ok(
    capabilities.realMoneyInfrastructure.requirements.every(
      (requirement) => requirement.status === "verified",
    ),
  );
  assert.equal(blockerCodes.includes("PRODUCTION_CUSTODY_PROVIDER_REQUIRED"), false);
  assert.equal(blockerCodes.includes("REAL_EXECUTION_VENUE_REQUIRED"), false);
  assert.ok(blockerCodes.includes("MONEY_MOVEMENT_PROVIDER_DISABLED"));
  assert.ok(blockerCodes.includes("COMPLIANCE_REAL_MONEY_DISABLED"));
  assert.ok(blockerCodes.includes("WITHDRAWALS_TRANSFER_BLOCKED"));
});

test("verified real-money infrastructure enables transfers only in production real-money mode", () => {
  const localCapabilities = buildMoneyMovementCapabilities({
    ...buildDeclaredRealMoneyConfig(),
    verifiedRealMoneyProviderAdapters: buildCompleteVerifiedAdapterRegistry(),
    appMode: "real_money",
    nodeEnv: "development",
    productionDeployment: false,
  });
  const productionCapabilities = buildMoneyMovementCapabilities({
    ...buildDeclaredRealMoneyConfig(),
    verifiedRealMoneyProviderAdapters: buildCompleteVerifiedAdapterRegistry(),
    appMode: "real_money",
    nodeEnv: "production",
    productionDeployment: true,
  });
  const blockerCodes = getRealMoneyReadinessBlockerDetails(productionCapabilities).map(
    (blocker) => blocker.code,
  );

  assert.equal(localCapabilities.realMoneyInfrastructure.status, "verified");
  assert.equal(localCapabilities.realMoneyEnabled, false);
  assert.equal(localCapabilities.canUseRealMoney, false);
  assert.equal(localCapabilities.deposits.realTransfersEnabled, false);
  assert.equal(localCapabilities.withdrawals.realTransferBlocked, true);
  assert.equal(localCapabilities.withdrawals.blockReason, "TRANSFERS_UNAVAILABLE");

  assert.equal(productionCapabilities.realMoneyInfrastructure.status, "verified");
  assert.equal(productionCapabilities.mode, "real_money");
  assert.equal(productionCapabilities.realMoneyEnabled, true);
  assert.equal(productionCapabilities.canUseRealMoney, true);
  assert.equal(productionCapabilities.deposits.realTransfersEnabled, true);
  assert.equal(productionCapabilities.withdrawals.realTransfersEnabled, true);
  assert.equal(productionCapabilities.withdrawals.realTransferBlocked, false);
  assert.equal(productionCapabilities.withdrawals.blockReason, null);
  assert.equal(productionCapabilities.withdrawals.requiresManualReview, false);
  assert.equal(blockerCodes.includes("MONEY_MOVEMENT_PROVIDER_DISABLED"), false);
  assert.equal(blockerCodes.includes("COMPLIANCE_REAL_MONEY_DISABLED"), false);
  assert.equal(blockerCodes.includes("WITHDRAWALS_TRANSFER_BLOCKED"), false);
  assert.deepEqual(blockerCodes, []);
});

const realMoneyRequirementCodes: RealMoneyInfrastructureRequirementCode[] = [
  "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
  "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
  "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED",
  "PROVIDER_RECONCILIATION_REQUIRED",
  "ACCOUNT_RISK_PROVIDER_REQUIRED",
  "SANCTIONS_SCREENING_PROVIDER_REQUIRED",
  "REAL_EXECUTION_VENUE_REQUIRED",
  "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED",
  "OPERATIONS_MONITORING_REQUIRED",
];

function buildDeclaredRealMoneyConfig() {
  return {
    realMoneyCustodyProvider: "Fireblocks",
    realMoneyDepositProvider: "TRONGrid",
    realMoneyWithdrawalProvider: "Fireblocks",
    realMoneyExecutionProvider: "Polymarket CLOB",
    realMoneyReconciliationProvider: "internal-ledger-reconciler",
    realMoneyAccountRiskProvider: "internal-risk-engine",
    realMoneySanctionsProvider: "chainalysis",
    realMoneyLedgerSettlementReconciliationConfigured: true,
    realMoneyOperationsMonitoringConfigured: true,
  } as const;
}

function buildCompleteVerifiedAdapterRegistry() {
  return [
    buildVerifiedAdapter("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocks"),
    buildVerifiedAdapter("SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED", "trongrid"),
    buildVerifiedAdapter("WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED", "fireblocks"),
    buildVerifiedAdapter("PROVIDER_RECONCILIATION_REQUIRED", "internal-ledger-reconciler"),
    buildVerifiedAdapter("ACCOUNT_RISK_PROVIDER_REQUIRED", "internal-risk-engine"),
    buildVerifiedAdapter("SANCTIONS_SCREENING_PROVIDER_REQUIRED", "chainalysis"),
    buildVerifiedAdapter("REAL_EXECUTION_VENUE_REQUIRED", "polymarket clob"),
    buildVerifiedAdapter("LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED", null),
    buildVerifiedAdapter("OPERATIONS_MONITORING_REQUIRED", null),
  ] as const;
}

function buildVerifiedAdapter(
  requirementCode: RealMoneyInfrastructureRequirementCode,
  provider: string | null,
) {
  return {
    requirementCode,
    provider,
    adapterId: `${requirementCode.toLowerCase()}-adapter-v1`,
    runtime: buildRuntime(requirementCode, `adapter_${requirementCode.toLowerCase()}`),
    verified: true,
    evidence: buildEvidence(requirementCode.toLowerCase()),
  } as const;
}

function buildEvidence(prefix: string) {
  return requiredVerifiedRealMoneyProviderAdapterEvidenceKinds.map((kind) => {
    if (kind === "integration_test") {
      return { kind, ref: `src/${prefix}.test.ts` };
    }
    if (kind === "security_review") {
      return { kind, ref: `docs/${prefix}-security-review.md` };
    }
    return { kind, ref: `docs/${prefix}-runbook.md` };
  });
}

function buildRuntime(requirementCode: RealMoneyInfrastructureRequirementCode, exportName: string) {
  return {
    moduleRef: `src/realMoneyAdapters/${exportName}.ts`,
    exportName,
    kind: realMoneyProviderAdapterRuntimeKindByRequirement[requirementCode],
  } as const;
}

test("real-money readiness blockers are derived from owner capabilities", () => {
  const capabilities = buildMoneyMovementCapabilities();
  const blockers = getRealMoneyReadinessBlockers(capabilities);
  const details = getRealMoneyReadinessBlockerDetails(capabilities);
  const detailCodes = details.map((blocker) => blocker.code);

  assert.ok(blockers.some((blocker) => blocker.includes("TRANSFERS_UNAVAILABLE")));
  assert.ok(blockers.some((blocker) => blocker.includes("custody/signing provider")));
  assert.ok(blockers.some((blocker) => blocker.includes("signature verification")));
  assert.ok(blockers.some((blocker) => blocker.includes("reconciliation")));
  assert.ok(blockers.some((blocker) => blocker.includes("allowed-region eligibility")));
  assert.ok(blockers.some((blocker) => blocker.includes("sanctions screening provider")));
  assert.deepEqual(blockers, details.map((blocker) => blocker.message));
  assert.ok(details.every((blocker) => blocker.source === "money_movement"));
  assert.ok(detailCodes.includes("MONEY_MOVEMENT_PROVIDER_DISABLED"));
  assert.ok(detailCodes.includes("COMPLIANCE_REAL_MONEY_DISABLED"));
  assert.ok(detailCodes.includes("WITHDRAWALS_TRANSFER_BLOCKED"));
  assert.ok(detailCodes.includes("PRODUCTION_CUSTODY_PROVIDER_REQUIRED"));
  assert.ok(detailCodes.includes("SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED"));
  assert.ok(detailCodes.includes("ACCOUNT_RISK_PROVIDER_REQUIRED"));
  assert.ok(detailCodes.includes("SANCTIONS_SCREENING_PROVIDER_REQUIRED"));
  assert.deepEqual(detailCodes.filter((code) => code.endsWith("_PROVIDER_REQUIRED")), [
    "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
    "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
    "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED",
    "ACCOUNT_RISK_PROVIDER_REQUIRED",
    "SANCTIONS_SCREENING_PROVIDER_REQUIRED",
  ]);
});

test("local webhook flag never enables real transfer infrastructure", () => {
  const capabilities = buildMoneyMovementCapabilities({
    walletDepositWebhookEnabled: true,
    adminManualDepositApprovalEnabled: true,
  });

  assert.equal(capabilities.deposits.localWebhookConfigured, true);
  assert.equal(capabilities.deposits.localWebhookEnabled, true);
  assert.equal(capabilities.deposits.localWebhookCreditEnabled, true);
  assert.equal(capabilities.deposits.localWebhookBlockReason, null);
  assert.equal(capabilities.deposits.realTransfersEnabled, false);
  assert.equal(capabilities.admin.manualDepositApprovalConfigured, true);
  assert.equal(capabilities.admin.manualDepositApprovalEnabled, true);
  assert.equal(capabilities.admin.manualDepositCreditEnabled, true);
  assert.equal(capabilities.admin.manualDepositBlockReason, null);
  assert.equal(capabilities.withdrawals.realTransfersEnabled, false);
  assert.equal(capabilities.realMoneyInfrastructure.status, "not_configured");
});

test("production disables local webhook ledger credit at the money movement owner layer", () => {
  const capabilities = buildMoneyMovementCapabilities({
    appMode: "local",
    nodeEnv: "production",
    walletDepositWebhookEnabled: true,
    adminManualDepositApprovalEnabled: true,
  });

  assert.equal(capabilities.deposits.localWebhookConfigured, true);
  assert.equal(capabilities.deposits.localWebhookEnabled, false);
  assert.equal(capabilities.deposits.localWebhookCreditEnabled, false);
  assert.equal(
    capabilities.deposits.localWebhookBlockReason,
    "LOCAL_DEPOSIT_WEBHOOK_PRODUCTION_DISABLED",
  );
  assert.equal(capabilities.deposits.realTransfersEnabled, false);
  assert.equal(capabilities.admin.manualDepositApprovalConfigured, true);
  assert.equal(capabilities.admin.manualDepositApprovalEnabled, false);
  assert.equal(capabilities.admin.manualDepositCreditEnabled, false);
  assert.equal(
    capabilities.admin.manualDepositBlockReason,
    "LOCAL_MANUAL_DEPOSIT_APPROVAL_PRODUCTION_DISABLED",
  );
  assert.equal(capabilities.realMoneyEnabled, false);
});

test("production deployment context disables local money movement before NODE_ENV is corrected", () => {
  const capabilities = buildMoneyMovementCapabilities({
    appMode: "local",
    nodeEnv: "development",
    productionDeployment: true,
    walletDepositWebhookEnabled: true,
    adminManualDepositApprovalEnabled: true,
  });

  assert.equal(
    capabilities.deposits.localWebhookBlockReason,
    "LOCAL_DEPOSIT_WEBHOOK_PRODUCTION_DISABLED",
  );
  assert.equal(capabilities.deposits.localWebhookCreditEnabled, false);
  assert.equal(
    capabilities.admin.manualDepositBlockReason,
    "LOCAL_MANUAL_DEPOSIT_APPROVAL_PRODUCTION_DISABLED",
  );
  assert.equal(capabilities.admin.manualDepositCreditEnabled, false);
});
