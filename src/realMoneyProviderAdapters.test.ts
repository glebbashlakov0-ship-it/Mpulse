import assert from "node:assert/strict";
import test from "node:test";
import {
  auditVerifiedRealMoneyProviderAdapterRegistry,
  findVerifiedRealMoneyProviderAdapter,
  realMoneyProviderAdapterRuntimeKindByRequirement,
  requiredVerifiedRealMoneyProviderAdapterEvidenceKinds,
  requiredRealMoneyProviderAdapterRequirementCodes,
  verifiedRealMoneyProviderAdapters,
  type VerifiedRealMoneyProviderAdapterRegistry,
} from "./realMoneyProviderAdapters.js";

test("default adapter registry is empty until real provider implementations are audited", () => {
  const issues = auditVerifiedRealMoneyProviderAdapterRegistry(verifiedRealMoneyProviderAdapters);

  assert.deepEqual(verifiedRealMoneyProviderAdapters, []);
  assert.deepEqual(
    issues
      .filter((issue) => issue.code === "MISSING_REQUIRED_ADAPTER")
      .map((issue) => issue.requirementCode),
    requiredRealMoneyProviderAdapterRequirementCodes,
  );
});

test("verified real-money adapter lookup requires provider, evidence, and stable id", () => {
  const registry = [
    {
      requirementCode: "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
        provider: "Fireblocks",
        adapterId: "fireblocks-custody-v1",
        runtime: buildRuntime("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocksCustodyAdapter"),
        verified: true,
        evidence: buildEvidence("custody-signing"),
      },
      {
        requirementCode: "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
        provider: "TRONGrid",
        adapterId: "",
        runtime: buildRuntime("SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED", "tronDepositWebhookAdapter"),
        verified: true,
        evidence: buildEvidence("deposit-webhook-signature"),
      },
  ] as const;

  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      "fireblocks",
    )?.adapterId,
    "fireblocks-custody-v1",
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
      "trongrid",
    ),
    undefined,
  );
});

test("verified real-money adapter registry rejects document-flow metadata", () => {
  const blockedProvider = ["pass", " port-custody"].join("");
  const blockedEvidence = ["account-", "k", "yc", "-screen"].join("");
  const registry = [
    {
      requirementCode: "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
        provider: blockedProvider,
        adapterId: "custody-v1",
        runtime: buildRuntime("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "custodyAdapter"),
        verified: true,
        evidence: buildEvidence("custody-signing"),
      },
      {
        requirementCode: "SANCTIONS_SCREENING_PROVIDER_REQUIRED",
        provider: "chainalysis",
        adapterId: "sanctions-v1",
        runtime: buildRuntime("SANCTIONS_SCREENING_PROVIDER_REQUIRED", "sanctionsAdapter"),
        verified: true,
        evidence: [
          { kind: "integration_test", ref: blockedEvidence },
          { kind: "security_review", ref: "sanctions-security-review" },
          { kind: "operational_runbook", ref: "sanctions-runbook" },
        ],
      },
  ] as const;
  const issues = auditVerifiedRealMoneyProviderAdapterRegistry(registry);

  assert.equal(
    issues.filter((issue) => issue.code === "DISALLOWED_DOCUMENT_FLOW_TERM").length,
    2,
  );
  assert.deepEqual(
    issues
      .filter((issue) => issue.code === "DISALLOWED_DOCUMENT_FLOW_TERM")
      .map((issue) => [issue.code, issue.field]),
    [
      ["DISALLOWED_DOCUMENT_FLOW_TERM", "provider"],
      ["DISALLOWED_DOCUMENT_FLOW_TERM", "evidence"],
    ],
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      blockedProvider,
    ),
    undefined,
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "SANCTIONS_SCREENING_PROVIDER_REQUIRED",
      "chainalysis",
    ),
    undefined,
  );
});

test("verified real-money adapter registry requires full requirement coverage", () => {
  const partialRegistry = [
    buildVerifiedAdapter("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocks"),
  ] as const;
  const completeRegistry = requiredRealMoneyProviderAdapterRequirementCodes.map(
    (requirementCode) => buildVerifiedAdapter(requirementCode, providerForRequirement(requirementCode)),
  );
  const partialIssues = auditVerifiedRealMoneyProviderAdapterRegistry(partialRegistry);
  const completeIssues = auditVerifiedRealMoneyProviderAdapterRegistry(completeRegistry);

  assert.equal(
    partialIssues.filter((issue) => issue.code === "MISSING_REQUIRED_ADAPTER").length,
    requiredRealMoneyProviderAdapterRequirementCodes.length - 1,
  );
  assert.deepEqual(completeIssues, []);
});

test("verified real-money adapter registry rejects ambiguous adapter ownership", () => {
  const duplicatedIdRegistry = [
    buildVerifiedAdapter("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocks", {
      adapterId: "shared-adapter-v1",
    }),
    buildVerifiedAdapter("SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED", "trongrid", {
      adapterId: "shared-adapter-v1",
    }),
  ] as const;
  const duplicatedProviderRegistry = [
    buildVerifiedAdapter("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocks", {
      adapterId: "fireblocks-custody-v1",
      exportName: "fireblocksCustodyAdapter",
    }),
    buildVerifiedAdapter("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "Fireblocks", {
      adapterId: "fireblocks-custody-v2",
      exportName: "fireblocksCustodyAdapterV2",
    }),
  ] as const;

  assert.deepEqual(
    auditVerifiedRealMoneyProviderAdapterRegistry(duplicatedIdRegistry)
      .filter((issue) => issue.code === "DUPLICATE_ADAPTER_ID")
      .map((issue) => [issue.code, issue.adapterId, issue.field]),
    [["DUPLICATE_ADAPTER_ID", "shared-adapter-v1", "registry"]],
  );
  assert.deepEqual(
    auditVerifiedRealMoneyProviderAdapterRegistry(duplicatedProviderRegistry)
      .filter((issue) => issue.code === "DUPLICATE_REQUIREMENT_PROVIDER")
      .map((issue) => [issue.code, issue.requirementCode, issue.field]),
    [["DUPLICATE_REQUIREMENT_PROVIDER", "PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "registry"]],
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      duplicatedProviderRegistry,
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      "fireblocks",
    ),
    undefined,
  );
});

test("verified real-money adapter registry does not count unverified records as coverage", () => {
  const registry = [
    {
      ...buildVerifiedAdapter("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocks"),
      verified: false,
    },
  ] as unknown as VerifiedRealMoneyProviderAdapterRegistry;
  const issues = auditVerifiedRealMoneyProviderAdapterRegistry(registry);

  assert.deepEqual(
    issues
      .filter(
        (issue) =>
          issue.code === "ADAPTER_NOT_VERIFIED" ||
          (issue.code === "MISSING_REQUIRED_ADAPTER" &&
            issue.requirementCode === "PRODUCTION_CUSTODY_PROVIDER_REQUIRED"),
      )
      .map((issue) => [issue.code, issue.requirementCode, issue.field]),
    [
      ["ADAPTER_NOT_VERIFIED", "PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "registry"],
      ["MISSING_REQUIRED_ADAPTER", "PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "registry"],
    ],
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      "fireblocks",
    ),
    undefined,
  );
});

test("verified real-money adapter registry enforces provider shape by requirement owner", () => {
  const registry = [
    buildVerifiedAdapter("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", null),
    buildVerifiedAdapter("OPERATIONS_MONITORING_REQUIRED", "datadog"),
  ] as const;
  const issues = auditVerifiedRealMoneyProviderAdapterRegistry(registry);

  assert.deepEqual(
    issues
      .filter((issue) => issue.code === "INVALID_PROVIDER")
      .map((issue) => [issue.requirementCode, issue.field, issue.message]),
    [
      [
        "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
        "provider",
        "PRODUCTION_CUSTODY_PROVIDER_REQUIRED must name the external provider it verifies.",
      ],
      [
        "OPERATIONS_MONITORING_REQUIRED",
        "provider",
        "OPERATIONS_MONITORING_REQUIRED must use provider null because it represents an internal workflow.",
      ],
    ],
  );
  assert.deepEqual(
    issues
      .filter(
        (issue) =>
          issue.code === "MISSING_REQUIRED_ADAPTER" &&
          (issue.requirementCode === "PRODUCTION_CUSTODY_PROVIDER_REQUIRED" ||
            issue.requirementCode === "OPERATIONS_MONITORING_REQUIRED"),
      )
      .map((issue) => issue.requirementCode),
    [
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      "OPERATIONS_MONITORING_REQUIRED",
    ],
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "OPERATIONS_MONITORING_REQUIRED",
      null,
    ),
    undefined,
  );
});

test("verified real-money adapter registry requires structured evidence coverage", () => {
  const registry = [
    {
      requirementCode: "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      provider: "fireblocks",
      adapterId: "fireblocks-custody-v1",
      runtime: buildRuntime("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocksCustodyAdapter"),
      verified: true,
      evidence: [{ kind: "integration_test", ref: "src/custody-signing.test.ts" }],
    },
  ] as const;
  const issues = auditVerifiedRealMoneyProviderAdapterRegistry(registry);

  assert.deepEqual(
    issues
      .filter((issue) => issue.code === "MISSING_EVIDENCE_KIND")
      .map((issue) => issue.message),
    [
      "Verified real-money provider adapter must include security_review evidence.",
      "Verified real-money provider adapter must include operational_runbook evidence.",
    ],
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      "fireblocks",
    ),
    undefined,
  );
});

test("verified real-money adapter registry requires local audited evidence references", () => {
  const registry = [
    {
      requirementCode: "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      provider: "fireblocks",
      adapterId: "fireblocks-custody-v1",
      runtime: buildRuntime("PRODUCTION_CUSTODY_PROVIDER_REQUIRED", "fireblocksCustodyAdapter"),
      verified: true,
      evidence: [
        { kind: "integration_test", ref: "https://example.test/custody.test.ts" },
        { kind: "security_review", ref: "docs/security review.md" },
        { kind: "operational_runbook", ref: "docs/custody-runbook-template.md" },
      ],
    },
  ] as const;
  const issues = auditVerifiedRealMoneyProviderAdapterRegistry(registry);

  assert.deepEqual(
    issues
      .filter((issue) => issue.code === "INVALID_EVIDENCE_REF")
      .map((issue) => issue.message),
    [
      "integration_test evidence must reference a local audited artifact path: integration tests under src/ or web/src/, and reviews/runbooks under docs/.",
      "security_review evidence must reference a local audited artifact path: integration tests under src/ or web/src/, and reviews/runbooks under docs/.",
      "operational_runbook evidence must reference a local audited artifact path: integration tests under src/ or web/src/, and reviews/runbooks under docs/.",
    ],
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      "fireblocks",
    ),
    undefined,
  );
});

test("verified real-money adapter registry requires executable runtime metadata", () => {
  const registry = [
    {
      requirementCode: "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      provider: "fireblocks",
      adapterId: "fireblocks-custody-v1",
      runtime: {
        moduleRef: "src/custody-signing.test.ts",
        exportName: "fireblocks-custody",
        kind: "provider_reconciliation",
      },
      verified: true,
      evidence: buildEvidence("custody-signing"),
    },
    {
      requirementCode: "SIGNED_DEPOSIT_WEBHOOK_PROVIDER_REQUIRED",
      provider: "trongrid",
      adapterId: "trongrid-deposit-v1",
      verified: true,
      evidence: buildEvidence("deposit-webhook-signature"),
    },
    {
      requirementCode: "WITHDRAWAL_BROADCAST_PROVIDER_REQUIRED",
      provider: "fireblocks",
      adapterId: "fireblocks-withdrawal-v1",
      runtime: {
        moduleRef: "src/realMoneyAdapters/fireblocksWithdrawalAdapter.fixture.ts",
        exportName: "fireblocksWithdrawalAdapter",
        kind: "withdrawal_broadcast",
      },
      verified: true,
      evidence: buildEvidence("withdrawal-broadcast"),
    },
  ] as unknown as VerifiedRealMoneyProviderAdapterRegistry;
  const issues = auditVerifiedRealMoneyProviderAdapterRegistry(registry);

  assert.deepEqual(
    issues
      .filter(
        (issue) =>
          issue.code === "INVALID_RUNTIME_MODULE_REF" ||
          issue.code === "INVALID_RUNTIME_EXPORT" ||
          issue.code === "INVALID_RUNTIME_KIND" ||
          issue.code === "MISSING_RUNTIME",
      )
      .map((issue) => [issue.adapterId, issue.code, issue.field]),
    [
      ["fireblocks-custody-v1", "INVALID_RUNTIME_MODULE_REF", "runtime"],
      ["fireblocks-custody-v1", "INVALID_RUNTIME_EXPORT", "runtime"],
      ["fireblocks-custody-v1", "INVALID_RUNTIME_KIND", "runtime"],
      ["trongrid-deposit-v1", "MISSING_RUNTIME", "runtime"],
      ["fireblocks-withdrawal-v1", "INVALID_RUNTIME_MODULE_REF", "runtime"],
    ],
  );
  assert.equal(
    findVerifiedRealMoneyProviderAdapter(
      registry,
      "PRODUCTION_CUSTODY_PROVIDER_REQUIRED",
      "fireblocks",
    ),
    undefined,
  );
});

function buildVerifiedAdapter(
  requirementCode: VerifiedRealMoneyProviderAdapterRegistry[number]["requirementCode"],
  provider: string | null,
  overrides: {
    adapterId?: string;
    exportName?: string;
  } = {},
) {
  const exportName = overrides.exportName ?? `${requirementCode.toLowerCase()}Adapter`;

  return {
    requirementCode,
    provider,
    adapterId: overrides.adapterId ?? `${requirementCode.toLowerCase()}-adapter-v1`,
    runtime: buildRuntime(requirementCode, exportName),
    verified: true,
    evidence: buildEvidence(requirementCode.toLowerCase()),
  } as const;
}

function providerForRequirement(
  requirementCode: VerifiedRealMoneyProviderAdapterRegistry[number]["requirementCode"],
) {
  return requirementCode === "LEDGER_SETTLEMENT_RECONCILIATION_REQUIRED" ||
    requirementCode === "OPERATIONS_MONITORING_REQUIRED"
    ? null
    : `${requirementCode.toLowerCase()}-provider`;
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

function buildRuntime(
  requirementCode: VerifiedRealMoneyProviderAdapterRegistry[number]["requirementCode"],
  exportName: string,
) {
  return {
    moduleRef: `src/realMoneyAdapters/${exportName}.ts`,
    exportName,
    kind: realMoneyProviderAdapterRuntimeKindByRequirement[requirementCode],
  } as const;
}
