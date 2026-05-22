import { X } from "lucide-react";
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
        <button
          aria-label="Close"
          className="home-soft-button absolute right-3 top-3 z-10 grid size-8 place-items-center rounded-full border border-[#242b32] bg-[#15191d] text-[#7b8996] transition hover:border-[#0093fd]/60 hover:text-[#dee3e7]"
          onClick={onClose}
          type="button"
        >
          <X size={16} />
        </button>
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
