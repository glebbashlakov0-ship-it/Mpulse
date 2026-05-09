import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveKycViewState, shouldRefreshKycCompliance } from "./KYCPage.state";

const user = { id: "user-1" };

describe("KYC page state model", () => {
  it("keeps auth loading separate from verification loading", () => {
    assert.equal(
      resolveKycViewState({ authStatus: "loading", user: null, loadState: "idle" }),
      "loading",
    );
    assert.equal(
      resolveKycViewState({ authStatus: "authenticated", user, loadState: "loading" }),
      "loading",
    );
  });

  it("renders the account screen and starts verification refresh from authenticated idle", () => {
    assert.equal(
      resolveKycViewState({ authStatus: "authenticated", user, loadState: "idle" }),
      "ready",
    );
    assert.equal(
      shouldRefreshKycCompliance({ authStatus: "authenticated", user, loadState: "idle" }),
      true,
    );
  });

  it("shows sign-in when auth has settled without a user", () => {
    assert.equal(
      resolveKycViewState({ authStatus: "guest", user: null, loadState: "idle" }),
      "sign-in",
    );
    assert.equal(
      resolveKycViewState({ authStatus: "error", user: null, loadState: "loading" }),
      "sign-in",
    );
  });

  it("moves authenticated users to ready or error after verification resolves", () => {
    assert.equal(
      resolveKycViewState({ authStatus: "authenticated", user, loadState: "ready" }),
      "ready",
    );
    assert.equal(
      resolveKycViewState({ authStatus: "authenticated", user, loadState: "error" }),
      "error",
    );
  });
});
