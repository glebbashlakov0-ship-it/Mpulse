import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthPage as AuthComponent } from "../components/AuthPage";
import { useAuth } from "../hooks/useAuth";

function getSafeRedirect(search: string) {
  const redirect = new URLSearchParams(search).get("redirect");

  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) {
    return "/";
  }

  return redirect.startsWith("/auth") ? "/" : redirect;
}

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, register } = useAuth();
  const requestedMode = new URLSearchParams(location.search).get("mode");
  const [mode, setMode] = React.useState<"login" | "register">(
    requestedMode === "register" ? "register" : "login",
  );
  const redirectTo = React.useMemo(() => getSafeRedirect(location.search), [location.search]);

  React.useEffect(() => {
    setMode(requestedMode === "register" ? "register" : "login");
  }, [requestedMode]);

  // Redirect if already authenticated
  React.useEffect(() => {
    if (user) {
      navigate(redirectTo, { replace: true });
    }
  }, [user, navigate, redirectTo]);

  return (
    <AuthComponent
      mode={mode}
      onModeChange={setMode}
      onBack={() => navigate("/")}
      onLogin={login}
      onRegister={register}
      onAuthenticated={() => navigate(redirectTo, { replace: true })}
    />
  );
}
