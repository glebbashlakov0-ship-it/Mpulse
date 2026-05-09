import * as React from "react";
import {
  loadCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  updateMySettings,
} from "../lib/api";
import type { AuthUser, UserSettings } from "../lib/types";

export type AuthStatus = "loading" | "guest" | "authenticated" | "error";

function useAuthState() {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const nextUser = await loadCurrentUser();
      setUser(nextUser);
      setStatus(nextUser ? "authenticated" : "guest");
      return nextUser;
    } catch (refreshError) {
      setUser(null);
      setStatus("error");
      setError(refreshError instanceof Error ? refreshError.message : "Could not load session");
      throw refreshError;
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    loadCurrentUser()
      .then((nextUser) => {
        if (!cancelled) {
          setUser(nextUser);
          setStatus(nextUser ? "authenticated" : "guest");
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setUser(null);
          setStatus("error");
          setError(loadError instanceof Error ? loadError.message : "Could not load session");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const register = React.useCallback(
    async (input: { email: string; password: string; displayName: string }) => {
      const nextUser = await registerUser(input);
      setUser(nextUser);
      setStatus("authenticated");
      setError(null);
      return nextUser;
    },
    [],
  );

  const login = React.useCallback(async (input: {
    email: string;
    password: string;
    twoFactorCode?: string;
  }) => {
    const nextUser = await loginUser(input);
    setUser(nextUser);
    setStatus("authenticated");
    setError(null);
    return nextUser;
  }, []);

  const logout = React.useCallback(async () => {
    await logoutUser();
    setUser(null);
    setStatus("guest");
    setError(null);
  }, []);

  const updateSettings = React.useCallback(async (settings: Partial<UserSettings>) => {
    const nextUser = await updateMySettings(settings);
    setUser(nextUser);
    setStatus("authenticated");
    setError(null);
    return nextUser;
  }, []);

  return {
    user,
    status,
    error,
    isAuthenticated: status === "authenticated" && Boolean(user),
    refresh,
    register,
    login,
    logout,
    updateSettings,
  };
}

export type AuthContextValue = ReturnType<typeof useAuthState>;

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(AuthContext.Provider, { value: useAuthState() }, children);
}

export function useAuth() {
  const context = React.useContext(AuthContext);

  if (!context) {
    return useAuthState();
  }

  return context;
}
