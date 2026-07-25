import { findDisallowedIdentityDocumentTerm } from "./identityDocumentPolicy.js";
import type { RealMoneyInfrastructureRequirementCode } from "./moneyMovement.js";
import type { RealMoneyProviderAdapterRuntimeKind } from "./realMoneyAdapterRuntime.js";

export type VerifiedRealMoneyProviderAdapter = {
  requirementCode: RealMoneyInfrastructureRequirementCode;
  provider: string | null;
  adapterId: string;
  runtime: VerifiedRealMoneyProviderAdapterRuntime;
  verified: true;
  evidence: readonly VerifiedRealMoneyProviderAdapterEvidence[];
};

export type VerifiedRealMoneyProviderAdapterRuntime = {
  moduleRef: string;
  exportName: string;
  kind: RealMoneyProviderAdapterRuntimeKind;
};

export type VerifiedRealMoneyProviderAdapterEvidence = {
  kind: VerifiedRealMoneyProviderAdapterEvidenceKind;
  ref: string;
};

export type VerifiedRealMoneyProviderAdapterRegistry =
  readonly VerifiedRealMoneyProviderAdapter[];

export type VerifiedRealMoneyProviderAdapterEvidenceKind =
  | "integration_test"
  | "security_review"
  | "operational_runbook";

export const requiredVerifiedRealMoneyProviderAdapterEvidenceKinds: readonly VerifiedRealMoneyProviderAdapterEvidenceKind[] =
  ["integration_test", "security_review", "operational_runbook"];

export const requiredRealMoneyProviderAdapterRequirementCodes: readonly RealMoneyInfrastructureRequirementCode[] =
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
  ];

export const realMoneyProviderAdapterRuntimeKindByRequirement:
  Record<RealMoneyInfrastructureRequirementCode, RealMoneyProviderAdapterRuntimeKind> = {
    PRODUCTION_CUSTODY_PROVIDER_REQUIRED: "custody_signing",
    SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED: "signed_deposit_webhook",
    WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED: "withdrawal_broadcast",
    PROVIDER_RECONCILIATION_REQUIRED: "provider_reconciliation",
    ACCOUNT_RISK_PROVIDER_REQUIRED: "account_risk",
    SANCTIONS_SCREENING_PROVIDER_REQUIRED: "sanctions_screening",
    REAL_EXECUTION_VENUE_REQUIRED: "execution_venue",
    LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED: "ledger_settlement_reconciliation",
    OPERATIONS_MONITORING_REQUIRED: "operations_monitoring",
  };

export type VerifiedRealMoneyProviderAdapterIssue = {
  adapterId: string | null;
  requirementCode: RealMoneyInfrastructureRequirementCode;
  code:
    | "DISALLOWED_DOCUMENT_FLOW_TERM"
    | "INVALID_EVIDENCE_REF"
    | "INVALID_PROVIDER"
    | "INVALID_RUNTIME_EXPORT"
    | "INVALID_RUNTIME_KIND"
    | "INVALID_RUNTIME_MODULE_REF"
    | "DUPLICATE_ADAPTER_ID"
    | "DUPLICATE_REQUIREMENT_PROVIDER"
    | "ADAPTER_NOT_VERIFIED"
    | "MISSING_EVIDENCE"
    | "MISSING_EVIDENCE_KIND"
    | "MISSING_ADAPTER_ID"
    | "MISSING_RUNTIME"
    | "MISSING_REQUIRED_ADAPTER";
  field: "provider" | "adapterId" | "runtime" | "evidence" | "registry";
  message: string;
};

export const verifiedRealMoneyProviderAdapters: VerifiedRealMoneyProviderAdapterRegistry = [];

const internalWorkflowRequirementCodes = new Set<RealMoneyInfrastructureRequirementCode>([
  "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED",
  "OPERATIONS_MONITORING_REQUIRED",
]);

export function findVerifiedRealMoneyProviderAdapter(
  registry: VerifiedRealMoneyProviderAdapterRegistry,
  requirementCode: RealMoneyInfrastructureRequirementCode,
  provider: string | null,
) {
  const normalizedProvider = normalizeProvider(provider);
  const matches = registry.filter(
    (adapter) =>
      adapter.verified &&
      adapter.requirementCode === requirementCode &&
      normalizeProvider(adapter.provider) === normalizedProvider &&
      getVerifiedRealMoneyProviderAdapterIssues(adapter).length === 0,
  );

  return matches.length === 1 ? matches[0] : undefined;
}

export function auditVerifiedRealMoneyProviderAdapterRegistry(
  registry: VerifiedRealMoneyProviderAdapterRegistry,
) {
  const adapterIssues = registry.flatMap((adapter) =>
    getVerifiedRealMoneyProviderAdapterIssues(adapter),
  );
  const registryIssues = getVerifiedRealMoneyProviderAdapterRegistryIssues(registry);
  const validRequirementCodes = new Set(
    registry
      .filter((adapter) => getVerifiedRealMoneyProviderAdapterIssues(adapter).length === 0)
      .map((adapter) => adapter.requirementCode),
  );
  const coverageIssues = requiredRealMoneyProviderAdapterRequirementCodes
    .filter((requirementCode) => !validRequirementCodes.has(requirementCode))
    .map((requirementCode) => ({
      adapterId: null,
      requirementCode,
      code: "MISSING_REQUIRED_ADAPTER" as const,
      field: "registry" as const,
      message: `${requirementCode} has no verified real-money provider adapter.`,
    }));

  return [...adapterIssues, ...registryIssues, ...coverageIssues];
}

function getVerifiedRealMoneyProviderAdapterRegistryIssues(
  registry: VerifiedRealMoneyProviderAdapterRegistry,
): VerifiedRealMoneyProviderAdapterIssue[] {
  const issues: VerifiedRealMoneyProviderAdapterIssue[] = [];
  const adapterIdCounts = new Map<string, number>();
  const requirementProviderCounts = new Map<string, number>();

  for (const adapter of registry) {
    const adapterId = adapter.adapterId.trim();
    if (adapterId) {
      adapterIdCounts.set(adapterId, (adapterIdCounts.get(adapterId) ?? 0) + 1);
    }

    if (getVerifiedRealMoneyProviderAdapterIssues(adapter).length === 0) {
      const requirementProviderKey = getRequirementProviderKey(adapter);
      requirementProviderCounts.set(
        requirementProviderKey,
        (requirementProviderCounts.get(requirementProviderKey) ?? 0) + 1,
      );
    }
  }

  const reportedAdapterIds = new Set<string>();
  const reportedRequirementProviders = new Set<string>();
  for (const adapter of registry) {
    const adapterId = adapter.adapterId.trim();
    if (adapterId && (adapterIdCounts.get(adapterId) ?? 0) > 1 && !reportedAdapterIds.has(adapterId)) {
      issues.push({
        adapterId,
        requirementCode: adapter.requirementCode,
        code: "DUPLICATE_ADAPTER_ID",
        field: "registry",
        message: `Verified real-money provider adapter id ${adapterId} is duplicated.`,
      });
      reportedAdapterIds.add(adapterId);
    }

    if (getVerifiedRealMoneyProviderAdapterIssues(adapter).length > 0) {
      continue;
    }

    const requirementProviderKey = getRequirementProviderKey(adapter);
    if (
      (requirementProviderCounts.get(requirementProviderKey) ?? 0) > 1 &&
      !reportedRequirementProviders.has(requirementProviderKey)
    ) {
      issues.push({
        adapterId,
        requirementCode: adapter.requirementCode,
        code: "DUPLICATE_REQUIREMENT_PROVIDER",
        field: "registry",
        message:
          `${adapter.requirementCode} has multiple verified adapters for provider ` +
          `${adapter.provider ?? "internal workflow"}.`,
      });
      reportedRequirementProviders.add(requirementProviderKey);
    }
  }

  return issues;
}

function getRequirementProviderKey(adapter: VerifiedRealMoneyProviderAdapter) {
  return `${adapter.requirementCode}:${normalizeProvider(adapter.provider) ?? ""}`;
}

function getVerifiedRealMoneyProviderAdapterIssues(
  adapter: VerifiedRealMoneyProviderAdapter,
): VerifiedRealMoneyProviderAdapterIssue[] {
  const issues: VerifiedRealMoneyProviderAdapterIssue[] = [];
  const adapterId = adapter.adapterId.trim();

  if (adapter.verified !== true) {
    issues.push({
      adapterId,
      requirementCode: adapter.requirementCode,
      code: "ADAPTER_NOT_VERIFIED",
      field: "registry",
      message: "Real-money provider adapter must be explicitly verified before it can cover a production requirement.",
    });
  }

  const provider = normalizeProvider(adapter.provider);
  const requiresInternalWorkflow = internalWorkflowRequirementCodes.has(adapter.requirementCode);
  if (requiresInternalWorkflow && provider !== null) {
    issues.push({
      adapterId,
      requirementCode: adapter.requirementCode,
      code: "INVALID_PROVIDER",
      field: "provider",
      message: `${adapter.requirementCode} must use provider null because it represents an internal workflow.`,
    });
  }
  if (!requiresInternalWorkflow && provider === null) {
    issues.push({
      adapterId,
      requirementCode: adapter.requirementCode,
      code: "INVALID_PROVIDER",
      field: "provider",
      message: `${adapter.requirementCode} must name the external provider it verifies.`,
    });
  }

  if (!adapterId) {
    issues.push({
      adapterId,
      requirementCode: adapter.requirementCode,
      code: "MISSING_ADAPTER_ID",
      field: "adapterId",
      message: "Verified real-money provider adapter must have a stable adapter id.",
    });
  }

  if (!adapter.runtime) {
    issues.push({
      adapterId,
      requirementCode: adapter.requirementCode,
      code: "MISSING_RUNTIME",
      field: "runtime",
      message: "Verified real-money provider adapter must reference an executable runtime module.",
    });
  } else {
    if (!isVerifiedRuntimeModuleRef(adapter.runtime.moduleRef)) {
      issues.push({
        adapterId,
        requirementCode: adapter.requirementCode,
        code: "INVALID_RUNTIME_MODULE_REF",
        field: "runtime",
        message:
          "Verified real-money provider adapter runtime must reference a local source module under src/.",
      });
    }
    if (!isVerifiedRuntimeExportName(adapter.runtime.exportName)) {
      issues.push({
        adapterId,
        requirementCode: adapter.requirementCode,
        code: "INVALID_RUNTIME_EXPORT",
        field: "runtime",
        message:
          "Verified real-money provider adapter runtime must name a stable exported symbol.",
      });
    }
    if (
      adapter.runtime.kind !==
      realMoneyProviderAdapterRuntimeKindByRequirement[adapter.requirementCode]
    ) {
      issues.push({
        adapterId,
        requirementCode: adapter.requirementCode,
        code: "INVALID_RUNTIME_KIND",
        field: "runtime",
        message:
          `${adapter.requirementCode} requires a ` +
          `${realMoneyProviderAdapterRuntimeKindByRequirement[adapter.requirementCode]} runtime.`,
      });
    }
  }

  if (adapter.evidence.length === 0) {
    issues.push({
      adapterId,
      requirementCode: adapter.requirementCode,
      code: "MISSING_EVIDENCE",
      field: "evidence",
      message: "Verified real-money provider adapter must include audit evidence.",
    });
  }

  const evidenceKinds = new Set(adapter.evidence.map((evidence) => evidence.kind));
  for (const evidenceKind of requiredVerifiedRealMoneyProviderAdapterEvidenceKinds) {
    if (!evidenceKinds.has(evidenceKind)) {
      issues.push({
        adapterId,
        requirementCode: adapter.requirementCode,
        code: "MISSING_EVIDENCE_KIND",
        field: "evidence",
        message: `Verified real-money provider adapter must include ${evidenceKind} evidence.`,
      });
    }
  }

  for (const evidence of adapter.evidence) {
    if (!isVerifiedEvidenceRef(evidence.kind, evidence.ref)) {
      issues.push({
        adapterId,
        requirementCode: adapter.requirementCode,
        code: "INVALID_EVIDENCE_REF",
        field: "evidence",
        message:
          `${evidence.kind} evidence must reference a local audited artifact path: ` +
          "integration tests under src/ or web/src/, and reviews/runbooks under docs/.",
      });
    }
  }

  for (const [field, value] of [
    ["provider", adapter.provider],
    ["adapterId", adapter.adapterId],
    [
      "runtime",
      adapter.runtime
        ? `${adapter.runtime.moduleRef} ${adapter.runtime.exportName}`
        : null,
    ],
    ["evidence", adapter.evidence.map((evidence) => `${evidence.kind} ${evidence.ref}`).join(" ")],
  ] as const) {
    if (findDisallowedIdentityDocumentTerm(value)) {
      issues.push({
        adapterId,
        requirementCode: adapter.requirementCode,
        code: "DISALLOWED_DOCUMENT_FLOW_TERM",
        field,
        message:
          `Verified real-money provider adapter ${field} cannot reference ` +
          "disallowed user-paperwork collection metadata.",
      });
    }
  }

  return issues;
}

function normalizeProvider(provider: string | null) {
  const normalizedProvider = provider?.trim().toLowerCase().replace(/\s+/g, "-");
  return normalizedProvider || null;
}

function isVerifiedEvidenceRef(
  kind: VerifiedRealMoneyProviderAdapterEvidenceKind,
  ref: string,
) {
  const normalizedRef = ref.trim();
  if (!normalizedRef || normalizedRef !== ref || normalizedRef.includes("..")) {
    return false;
  }
  if (/^(?:https?:)?\/\//i.test(normalizedRef) || /\s/.test(normalizedRef)) {
    return false;
  }
  if (/\b(?:todo|tbd|later|manual|placeholder|template|draft|example|sample)\b/i.test(normalizedRef)) {
    return false;
  }

  switch (kind) {
    case "integration_test":
      return (
        (normalizedRef.startsWith("src/") || normalizedRef.startsWith("web/src/")) &&
        normalizedRef.endsWith(".test.ts")
      );
    case "security_review":
    case "operational_runbook":
      return normalizedRef.startsWith("docs/") && normalizedRef.endsWith(".md");
  }
}

function isVerifiedRuntimeModuleRef(ref: string) {
  const normalizedRef = ref.trim();
  if (!normalizedRef || normalizedRef !== ref || normalizedRef.includes("..")) {
    return false;
  }
  if (/^(?:https?:)?\/\//i.test(normalizedRef) || /\s/.test(normalizedRef)) {
    return false;
  }
  if (/\b(?:todo|tbd|later|manual|placeholder|template|draft|example|sample)\b/i.test(normalizedRef)) {
    return false;
  }
  if (isNonProductionRuntimeArtifactRef(normalizedRef)) {
    return false;
  }

  return (
    normalizedRef.startsWith("src/") &&
    normalizedRef.endsWith(".ts") &&
    !normalizedRef.endsWith(".d.ts")
  );
}

function isVerifiedRuntimeExportName(exportName: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName.trim()) && exportName === exportName.trim();
}

function isNonProductionRuntimeArtifactRef(ref: string) {
  return /(?:^|\/)(?:__tests__|__mocks__|fixtures?|mocks?|tmp|temp)(?:\/|$)|\.(?:test|spec|mock|fixture|story|stories)\.ts$/i.test(ref);
}
