import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRealMoneyLaunchApprovalCapabilities,
  getRealMoneyLaunchApprovalReadinessBlockerDetails,
  isRealMoneyLaunchApprovalRef,
} from "./realMoneyLaunchApproval.js";

test("real-money launch approval is missing until a local reviewed artifact is declared", () => {
  const capabilities = buildRealMoneyLaunchApprovalCapabilities({});
  const blockers = getRealMoneyLaunchApprovalReadinessBlockerDetails(capabilities);

  assert.equal(capabilities.approved, false);
  assert.equal(capabilities.refAccepted, false);
  assert.equal(capabilities.artifactStatus, "not_checked");
  assert.equal(capabilities.approvalRef, null);
  assert.deepEqual(blockers.map((blocker) => blocker.code), [
    "REAL_MONEY_LAUNCH_APPROVAL_REQUIRED",
  ]);
});

test("real-money launch approval rejects weak or external refs", () => {
  for (const ref of [
    "https://example.com/approval.md",
    "docs/approval placeholder.md",
    "../approval.md",
    "docs/todo-approval.md",
    "docs/real-money-launch-approval-template.md",
    "docs/real-money-launch-approval-draft.md",
    "src/approval.test.ts",
  ]) {
    assert.equal(isRealMoneyLaunchApprovalRef(ref), false);
  }

  const capabilities = buildRealMoneyLaunchApprovalCapabilities({
    realMoneyLaunchApprovalRef: "https://example.com/approval.md",
  });
  const blockers = getRealMoneyLaunchApprovalReadinessBlockerDetails(capabilities);

  assert.equal(capabilities.approved, false);
  assert.equal(capabilities.refAccepted, false);
  assert.equal(capabilities.artifactStatus, "not_checked");
  assert.deepEqual(blockers.map((blocker) => blocker.code), [
    "REAL_MONEY_LAUNCH_APPROVAL_REF_INVALID",
  ]);
});

test("real-money launch approval accepts local docs markdown refs before artifact audit", () => {
  const capabilities = buildRealMoneyLaunchApprovalCapabilities({
    realMoneyLaunchApprovalRef: "docs/real-money-launch-approval.md",
  });

  assert.equal(isRealMoneyLaunchApprovalRef("docs/real-money-launch-approval.md"), true);
  assert.equal(capabilities.refAccepted, true);
  assert.equal(capabilities.artifactStatus, "not_checked");
  assert.equal(capabilities.approved, false);
  assert.deepEqual(
    getRealMoneyLaunchApprovalReadinessBlockerDetails(capabilities).map(
      (blocker) => blocker.code,
    ),
    ["REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED"],
  );
});

test("real-money launch approval is approved only after artifact audit passes", () => {
  const rejected = buildRealMoneyLaunchApprovalCapabilities({
    realMoneyLaunchApprovalRef: "docs/real-money-launch-approval.md",
    realMoneyLaunchApprovalArtifactApproved: false,
  });
  const approved = buildRealMoneyLaunchApprovalCapabilities({
    realMoneyLaunchApprovalRef: "docs/real-money-launch-approval.md",
    realMoneyLaunchApprovalArtifactApproved: true,
  });

  assert.equal(rejected.refAccepted, true);
  assert.equal(rejected.artifactStatus, "rejected");
  assert.equal(rejected.approved, false);
  assert.deepEqual(
    getRealMoneyLaunchApprovalReadinessBlockerDetails(rejected).map(
      (blocker) => blocker.code,
    ),
    ["REAL_MONEY_LAUNCH_APPROVAL_ARTIFACT_NOT_APPROVED"],
  );
  assert.equal(approved.refAccepted, true);
  assert.equal(approved.artifactStatus, "approved");
  assert.equal(approved.approved, true);
  assert.deepEqual(getRealMoneyLaunchApprovalReadinessBlockerDetails(approved), []);
});
