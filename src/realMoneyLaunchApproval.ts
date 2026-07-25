export const REAL_MONEY_LAUNCH_APPROVAL_REQUIRED =
  "REAL_MONEY_LAUNCH_APPROVAL_REQUIRED" as const;
export const REAL_MONEY_LAUNCH_APPROVAL_REF_INVALID =
  "REAL_MONEY_LAUNCH_APPROVAL_REF_INVALID" as const;
export const REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED =
  "REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED" as const;

export type RealMoneyLaunchApprovalCapabilities = {
  approvalRef: string | null;
  refAccepted: boolean;
  artifactStatus: "not_checked" | "approved" | "rejected";
  approved: boolean;
};

export type RealMoneyLaunchApprovalReadinessBlocker = {
  source: "launch_approval";
  code:
    | typeof REAL_MONEY_LAUNCH_APPROVAL_REQUIRED
    | typeof REAL_MONEY_LAUNCH_APPROVAL_REF_INVALID
    | typeof REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED;
  message: string;
};

export function buildRealMoneyLaunchApprovalCapabilities(config: {
  realMoneyLaunchApprovalRef?: string | null;
  realMoneyLaunchApprovalArtifactApproved?: boolean | null;
}): RealMoneyLaunchApprovalCapabilities {
  const approvalRef = config.realMoneyLaunchApprovalRef?.trim() || null;
  const refAccepted =
    approvalRef !== null && isRealMoneyLaunchApprovalRef(approvalRef);
  const artifactStatus = !refAccepted
    ? "not_checked"
    : config.realMoneyLaunchApprovalArtifactApproved === true
      ? "approved"
      : config.realMoneyLaunchApprovalArtifactApproved === false
        ? "rejected"
        : "not_checked";

  return {
    approvalRef,
    refAccepted,
    artifactStatus,
    approved: refAccepted && artifactStatus === "approved",
  };
}

export function getRealMoneyLaunchApprovalReadinessBlockerDetails(
  capabilities: RealMoneyLaunchApprovalCapabilities,
): RealMoneyLaunchApprovalReadinessBlocker[] {
  if (!capabilities.approvalRef) {
    return [
      {
        source: "launch_approval",
        code: REAL_MONEY_LAUNCH_APPROVAL_REQUIRED,
        message:
          "Real-money launch approval artifact is not configured. Set REAL_MONEY_LAUNCH_APPROVAL_REF to a reviewed local docs/*.md file before enabling real funds.",
      },
    ];
  }

  if (!capabilities.refAccepted) {
    return [
      {
        source: "launch_approval",
        code: REAL_MONEY_LAUNCH_APPROVAL_REF_INVALID,
        message:
          "REAL_MONEY_LAUNCH_APPROVAL_REF must reference a local reviewed docs/*.md launch approval artifact.",
      },
    ];
  }

  if (!capabilities.approved) {
    return [
      {
        source: "launch_approval",
        code: REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED,
        message:
          "Real-money launch approval artifact has not passed the registry-and-artifact audit.",
      },
    ];
  }

  return [];
}

export function isRealMoneyLaunchApprovalRef(ref: string) {
  const normalizedRef = ref.trim();
  return (
    normalizedRef === ref &&
    normalizedRef.startsWith("docs/") &&
    normalizedRef.endsWith(".md") &&
    !normalizedRef.includes("..") &&
    !/\s/.test(normalizedRef) &&
    !/^(?:https?:)?\/\//i.test(normalizedRef) &&
    !/\b(?:todo|tbd|later|placeholder|template|draft|example|sample)\b/i.test(normalizedRef)
  );
}
