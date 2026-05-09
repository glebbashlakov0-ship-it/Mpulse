import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAmlStatus,
  formatEligibilityReason,
  formatRiskLevel,
  formatVerificationStatus,
  getTradingBlockerReasons,
  hasAcceptedLegalVersions,
  isEligibleToTrade,
} from "./eligibility";
import type { ComplianceEligibilityPayload } from "./types";

const eligibility: ComplianceEligibilityPayload = {
  profile: {
    userId: "user-1",
    countryCode: "US",
    dateOfBirth: "1990-01-01",
    kycStatus: "not_started",
    amlStatus: "clear",
    riskLevel: "low",
    verificationProvider: "self_declared",
    createdAt: "2026-05-06T00:00:00.000Z",
    updatedAt: "2026-05-06T00:00:00.000Z",
  },
  legalConsents: [],
  acceptedVersions: {
    terms: "1.0.0",
    privacy: "1.0.0",
    risk_disclosure: "1.0.0",
  },
  canTradeMock: true,
  canTradeLocal: true,
  canUseRealMoney: false,
  reasons: ["TRANSFERS_UNAVAILABLE"],
  age: 36,
  complianceMode: "trading_restricted",
  verificationProvider: "self_declared",
};

describe("eligibility helpers", () => {
  it("formats backend-owned account statuses for UI", () => {
    assert.equal(formatVerificationStatus("not_started"), "Not started");
    assert.equal(formatVerificationStatus("approved"), "Verified");
    assert.equal(formatAmlStatus("clear"), "Good standing");
    assert.equal(formatRiskLevel("low"), "Standard");
  });

  it("turns eligibility reasons into readable text", () => {
    assert.equal(
      formatEligibilityReason("DATE_OF_BIRTH_REQUIRED_FOR_COMPLIANCE"),
      "Add your date of birth.",
    );
    assert.equal(formatEligibilityReason("BLOCKED_COUNTRY"), "Trading is not available in your region.");
  });

  it("separates trading blockers from transfer availability notices", () => {
    assert.equal(isEligibleToTrade(eligibility), true);
    assert.equal(hasAcceptedLegalVersions(eligibility.acceptedVersions), true);
    assert.deepEqual(getTradingBlockerReasons(eligibility), []);

    assert.deepEqual(
      getTradingBlockerReasons({
        ...eligibility,
        canTradeMock: false,
        canTradeLocal: false,
        reasons: ["LEGAL_CONSENTS_REQUIRED", "TRANSFERS_UNAVAILABLE"],
      }),
      ["Review and accept the required account acknowledgements."],
    );
  });
});
