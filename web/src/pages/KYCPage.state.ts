import type { AuthStatus } from "../hooks/useAuth";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type KycViewState = "loading" | "sign-in" | "error" | "ready";

export function resolveKycViewState({
  authStatus,
  user,
  loadState,
}: {
  authStatus: AuthStatus;
  user: unknown;
  loadState: LoadState;
}): KycViewState {
  if (authStatus === "loading") {
    return "loading";
  }

  if (!user) {
    return "sign-in";
  }

  if (loadState === "loading") {
    return "loading";
  }

  if (loadState === "error") {
    return "error";
  }

  return "ready";
}

export function shouldRefreshKycCompliance({
  authStatus,
  user,
  loadState,
}: {
  authStatus: AuthStatus;
  user: unknown;
  loadState: LoadState;
}) {
  return authStatus === "authenticated" && Boolean(user) && loadState === "idle";
}
