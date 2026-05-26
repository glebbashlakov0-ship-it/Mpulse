import * as React from "react";
import { AuthPage as AuthForm } from "./AuthPage";
import type { AuthUser } from "../lib/types";

export function AuthModal({
  mode,
  onModeChange,
  onClose,
  onLogin,
  onRegister,
  onAuthenticated,
}: {
  mode: "login" | "register";
  onModeChange: (mode: "login" | "register") => void;
  onClose: () => void;
  onLogin: (input: {
    email: string;
    password: string;
    twoFactorCode?: string;
  }) => Promise<AuthUser>;
  onRegister: (input: {
    email: string;
    password: string;
    displayName: string;
  }) => Promise<AuthUser>;
  onAuthenticated: () => void;
}) {
  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      aria-modal="true"
      className="app-modal-overlay fixed inset-0 z-[90] grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
    >
      <div
        className="app-modal-panel relative max-h-[calc(100vh-48px)] w-full max-w-[540px] overflow-y-auto"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <AuthForm
          mode={mode}
          onModeChange={onModeChange}
          onBack={onClose}
          onLogin={onLogin}
          onRegister={onRegister}
          onAuthenticated={onAuthenticated}
          showBackButton={false}
          surface="modal"
        />
      </div>
    </div>
  );
}
