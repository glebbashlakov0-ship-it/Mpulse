import * as React from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, LogIn, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../lib/types";

const panel = "rounded-3xl border border-[#293440] bg-[#171d24]";

export function AuthPage({
  mode,
  onModeChange,
  onBack,
  onLogin,
  onRegister,
  onAuthenticated,
}: {
  mode: "login" | "register";
  onModeChange: (mode: "login" | "register") => void;
  onBack: () => void;
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
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [needsTwoFactor, setNeedsTwoFactor] = React.useState(false);
  const [displayName, setDisplayName] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const navigate = useNavigate();
  const [message, setMessage] = React.useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const isRegister = mode === "register";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const user = isRegister
        ? await onRegister({ email, password, displayName })
        : await onLogin({ email, password, twoFactorCode: twoFactorCode.trim() || undefined });
      setMessage({
        tone: "success",
        text: `Signed in as ${user.displayName}.`,
      });
      onAuthenticated();
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("two-factor")) {
        setNeedsTwoFactor(true);
      }
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Authentication failed.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-[920px] px-4 py-8 md:px-6 xl:px-8">
      <button
        className="flex w-fit items-center gap-2 rounded-2xl border border-[#293440] px-4 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft size={18} />
        All markets
      </button>

      <div className={`${panel} mt-6 overflow-hidden`}>
        <div className="grid gap-6 p-5 md:grid-cols-[0.9fr_1.1fr] md:p-7">
          <div className="flex flex-col justify-between rounded-2xl border border-[#293440] bg-[#0f1318] p-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#3b91f6]">
                Pulse Market
              </span>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-[#edf1f5]">
                {isRegister ? "Create account" : "Log in"}
              </h1>
              <p className="mt-3 text-sm font-medium leading-6 text-[#8f9aa8]">
                Keep your profile and settings ready across market sessions.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                  !isRegister
                    ? "bg-[#edf1f5] text-[#0f1318]"
                    : "bg-[#171d24] text-[#8f9aa8] hover:text-[#edf1f5]"
                }`}
                onClick={() => onModeChange("login")}
                type="button"
              >
                Log In
              </button>
              <button
                className={`rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                  isRegister
                    ? "bg-[#edf1f5] text-[#0f1318]"
                    : "bg-[#171d24] text-[#8f9aa8] hover:text-[#edf1f5]"
                }`}
                onClick={() => onModeChange("register")}
                type="button"
              >
                Sign Up
              </button>
            </div>
          </div>

          <form className="grid gap-4" onSubmit={submit}>
            {isRegister ? (
              <TextField
                label="Display name"
                value={displayName}
                onChange={setDisplayName}
                autoComplete="name"
                placeholder="Market Trader"
              />
            ) : null}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              placeholder="you@example.com"
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={isRegister ? "new-password" : "current-password"}
              placeholder="At least 10 characters"
            />
            {!isRegister && needsTwoFactor ? (
              <TextField
                label="2FA code"
                value={twoFactorCode}
                onChange={setTwoFactorCode}
                autoComplete="one-time-code"
                placeholder="123456"
              />
            ) : null}

            {message ? <InlineMessage tone={message.tone} text={message.text} /> : null}

            <button
              className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#3b91f6] px-4 text-sm font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isRegister ? <UserPlus size={18} /> : <LogIn size={18} />}
              {isSubmitting ? "Submitting..." : isRegister ? "Create account" : "Log in"}
            </button>

            {!isRegister && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => navigate("/request-password-reset")}
                  className="text-sm text-[#3b91f6] hover:text-[#3b91f6]/80 transition"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-bold uppercase tracking-wide text-[#8f9aa8]">{label}</span>
      <input
        className="h-12 rounded-2xl border border-[#293440] bg-[#0f1318] px-3 text-sm font-semibold text-[#edf1f5] outline-none placeholder:text-[#8f9aa8] transition focus:border-[#3b91f6]/70"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
      />
    </label>
  );
}

function InlineMessage({ tone, text }: { tone: "success" | "error"; text: string }) {
  return (
    <div
      className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold ${
        tone === "success" ? "bg-green-500/10 text-green-200" : "bg-red-500/10 text-red-200"
      }`}
    >
      {tone === "success" ? (
        <CheckCircle2 className="mt-0.5 shrink-0" size={17} />
      ) : (
        <AlertCircle className="mt-0.5 shrink-0" size={17} />
      )}
      <span>{text}</span>
    </div>
  );
}
