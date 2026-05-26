import type { ComplianceEligibilityPayload } from "./types";

export function isEligibleToTrade(eligibility: unknown) {
  const payload = eligibility as { canTradeMock?: boolean; canTradeLocal?: boolean } | null;
  return Boolean(payload?.canTradeMock ?? payload?.canTradeLocal);
}

export function hasAcceptedLegalVersions(
  acceptedVersions: ComplianceEligibilityPayload["acceptedVersions"] | undefined,
) {
  return Boolean(
    acceptedVersions?.terms &&
      acceptedVersions.privacy &&
      acceptedVersions.risk_disclosure,
  );
}

export function formatVerificationStatus(value: string | null | undefined) {
  switch (value) {
    case "approved":
      return "Verified";
    case "pending":
      return "Under review";
    case "manual_review":
    case "rejected":
      return "Review required";
    case "not_started":
    case null:
    case undefined:
      return "Not started";
    default:
      return humanizeCode(value);
  }
}

export function formatAmlStatus(value: string | null | undefined) {
  switch (value) {
    case "clear":
      return "Good standing";
    case "watchlist_review":
      return "Review required";
    case "blocked":
      return "Restricted";
    case null:
    case undefined:
      return "Not started";
    default:
      return humanizeCode(value);
  }
}

export function formatRiskLevel(value: string | null | undefined) {
  switch (value) {
    case "low":
      return "Standard";
    case "medium":
      return "Elevated";
    case "high":
      return "High";
    case "blocked":
      return "Restricted";
    case null:
    case undefined:
      return "Not started";
    default:
      return humanizeCode(value);
  }
}

export function formatEligibilityReason(reason: string) {
  switch (reason) {
    case "DATE_OF_BIRTH_REQUIRED_FOR_COMPLIANCE":
      return "Add your date of birth.";
    case "AGE_UNDER_18":
      return "You must be at least 18 to trade.";
    case "COUNTRY_REQUIRED_FOR_COMPLIANCE":
      return "Add your country of residence.";
    case "BLOCKED_COUNTRY":
      return "Trading is not available in your region.";
    case "LEGAL_CONSENTS_REQUIRED":
      return "Review and accept the required account acknowledgements.";
    case "COMPLIANCE_RISK_BLOCKED":
      return "Account review is required before trading.";
    case "TRANSFERS_UNAVAILABLE":
      return "Withdrawal requests are reviewed before processing.";
    default:
      return humanizeCode(reason);
  }
}

export function getTradingBlockerReasons(eligibility: ComplianceEligibilityPayload | null) {
  if (!eligibility) {
    return ["Sign in and complete account verification before trading."];
  }

  if (eligibility.canTradeMock ?? eligibility.canTradeLocal) {
    return [];
  }

  return eligibility.reasons
    .filter((reason) => reason !== "TRANSFERS_UNAVAILABLE")
    .map(formatEligibilityReason);
}

function humanizeCode(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
