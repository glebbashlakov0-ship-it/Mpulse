import assert from "node:assert/strict";
import test from "node:test";
import { buildAuditService, MemoryAuditLogRepository } from "./audit.js";
import {
  buildComplianceService,
  MemoryComplianceRepository,
} from "./compliance.js";

function buildTestComplianceService() {
  const auditRepository = new MemoryAuditLogRepository();

  return {
    auditRepository,
    compliance: buildComplianceService({
      repository: new MemoryComplianceRepository(),
      audit: buildAuditService(auditRepository),
      now: () => new Date("2026-04-29T12:00:00.000Z"),
    }),
  };
}

test("adult profile with legal consents is allowed for trading eligibility but not real money", async () => {
  const { compliance } = buildTestComplianceService();

  await compliance.updateProfile({
    userId: "adult-user",
    body: {
      countryCode: "US",
      dateOfBirth: "1990-04-28",
    },
  });
  await compliance.acceptTerms({
    userId: "adult-user",
    body: {
      termsVersion: "terms-2026.04",
      privacyVersion: "privacy-2026.04",
      riskDisclosureVersion: "risk-2026.04",
    },
  });
  const eligibility = await compliance.getEligibility({ userId: "adult-user" });

  assert.equal(eligibility.profile.countryCode, "US");
  assert.equal(eligibility.profile.kycStatus, "not_started");
  assert.equal(eligibility.profile.amlStatus, "clear");
  assert.equal(eligibility.profile.riskLevel, "low");
  assert.equal(eligibility.canTradeMock, true);
  assert.equal(eligibility.canTradeLocal, true);
  assert.equal(eligibility.canUseRealMoney, false);
  assert.ok(eligibility.reasons.includes("TRANSFERS_UNAVAILABLE"));
});

test("under 18 profile is blocked from trading eligibility", async () => {
  const { compliance } = buildTestComplianceService();

  await compliance.updateProfile({
    userId: "minor-user",
    body: {
      countryCode: "US",
      dateOfBirth: "2010-01-01",
    },
  });
  const eligibility = await compliance.getEligibility({ userId: "minor-user" });

  assert.equal(eligibility.profile.kycStatus, "rejected");
  assert.equal(eligibility.profile.riskLevel, "blocked");
  assert.equal(eligibility.canTradeMock, false);
  assert.equal(eligibility.canTradeLocal, false);
  assert.equal(eligibility.canUseRealMoney, false);
  assert.ok(eligibility.reasons.includes("AGE_UNDER_18"));
});

test("blocked country is blocked from trading eligibility", async () => {
  const { compliance } = buildTestComplianceService();

  await compliance.updateProfile({
    userId: "blocked-country-user",
    body: {
      countryCode: "IR",
      dateOfBirth: "1990-01-01",
    },
  });
  const eligibility = await compliance.getEligibility({ userId: "blocked-country-user" });

  assert.equal(eligibility.profile.kycStatus, "rejected");
  assert.equal(eligibility.profile.amlStatus, "blocked");
  assert.equal(eligibility.profile.riskLevel, "blocked");
  assert.equal(eligibility.canTradeMock, false);
  assert.equal(eligibility.canTradeLocal, false);
  assert.ok(eligibility.reasons.includes("BLOCKED_COUNTRY"));
});

test("accepted legal terms are recorded with fixed versions", async () => {
  const { auditRepository, compliance } = buildTestComplianceService();

  const result = await compliance.acceptTerms({
    userId: "consent-user",
    sessionId: "session-1",
    body: {
      termsVersion: "terms-2026.04",
      privacyVersion: "privacy-2026.04",
      riskDisclosureVersion: "risk-2026.04",
    },
  });
  const profile = await compliance.getMe("consent-user");
  const auditEvents = await auditRepository.listRecent();

  assert.equal(result.legalConsents.length, 3);
  assert.equal(profile.acceptedVersions.terms, "terms-2026.04");
  assert.equal(profile.acceptedVersions.privacy, "privacy-2026.04");
  assert.equal(profile.acceptedVersions.risk_disclosure, "risk-2026.04");
  assert.equal(auditEvents[0]?.eventType, "compliance.legal_consents_accept");
});

test("frontend cannot self-approve KYC status", async () => {
  const { compliance } = buildTestComplianceService();

  await assert.rejects(
    () =>
      compliance.updateProfile({
        userId: "approval-user",
        body: {
          countryCode: "US",
          dateOfBirth: "1990-01-01",
          kycStatus: "approved",
        },
      }),
    /Unsupported field: kycStatus/,
  );
});
