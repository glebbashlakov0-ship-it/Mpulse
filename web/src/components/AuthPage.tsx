import * as React from "react";
import { AlertCircle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { lookupAuthEmail } from "../lib/api";
import type { AuthUser } from "../lib/types";

const panel = "rounded-[28px] border border-[#242b32] bg-[#181d21] shadow-[0_28px_90px_rgba(0,0,0,0.46)]";
type EmailAuthStep = "email" | "login" | "register";

export function AuthPage({
  mode,
  onModeChange,
  onBack,
  onLogin,
  onRegister,
  onAuthenticated,
  showBackButton = true,
  surface = "page",
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
  showBackButton?: boolean;
  surface?: "page" | "modal";
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [needsTwoFactor, setNeedsTwoFactor] = React.useState(false);
  const [displayName, setDisplayName] = React.useState("");
  const [emailAuthStep, setEmailAuthStep] = React.useState<EmailAuthStep>("email");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const isLoginStep = emailAuthStep === "login";
  const isRegisterStep = emailAuthStep === "register";
  const sectionClass =
    surface === "modal"
      ? "w-full"
      : "mx-auto max-w-[920px] px-4 py-8 md:px-6 xl:px-8";

  React.useEffect(() => {
    setEmailAuthStep("email");
    setMessage(null);
    setNeedsTwoFactor(false);
    setPassword("");
    setTwoFactorCode("");
  }, [mode]);

  function getDefaultDisplayName(nextEmail: string) {
    return nextEmail.split("@")[0]?.trim() || "Market Trader";
  }

  function updateEmail(nextEmail: string) {
    setEmail(nextEmail);

    if (emailAuthStep !== "email") {
      setEmailAuthStep("email");
      setPassword("");
      setDisplayName("");
      setTwoFactorCode("");
      setNeedsTwoFactor(false);
      setMessage(null);
    }
  }

  function focusNextStep(nextStep: EmailAuthStep) {
    window.requestAnimationFrame(() => {
      const selector =
        nextStep === "register"
          ? 'input[autocomplete="name"]'
          : 'input[autocomplete="current-password"]';
      document.querySelector<HTMLInputElement>(selector)?.focus();
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail) {
      setMessage({ tone: "error", text: "Enter your email to continue." });
      return;
    }

    if (emailAuthStep === "email") {
      setIsSubmitting(true);
      setMessage(null);

      try {
        const exists = await lookupAuthEmail(nextEmail);
        const nextStep = exists ? "login" : "register";
        setEmailAuthStep(nextStep);
        focusNextStep(nextStep);
      } catch (error) {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Could not check email.",
        });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!password.trim()) {
      setMessage({ tone: "error", text: "Enter your password to continue." });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      const user = isRegisterStep
        ? await onRegister({
            email: nextEmail,
            password,
            displayName: displayName.trim() || getDefaultDisplayName(nextEmail),
          })
        : await onLogin({ email: nextEmail, password, twoFactorCode: twoFactorCode.trim() || undefined });
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

  function showProviderPlaceholder(label: string) {
    setMessage({
      tone: "success",
      text: `${label} sign-in will be connected soon.`,
    });
  }

  return (
    <section className={sectionClass}>
      {showBackButton ? (
        <button
          className="flex w-fit items-center gap-2 rounded-2xl border border-[#242b32] px-4 py-2 text-sm font-semibold text-[#7b8996] transition hover:border-[#0093fd]/50 hover:text-[#dee3e7]"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={18} />
          All markets
        </button>
      ) : null}

      <div className={`${panel} ${showBackButton ? "mt-6" : ""} overflow-hidden px-7 py-7`}>
        <h1 className="text-center text-2xl font-semibold tracking-normal text-[#dee3e7]">
          Welcome to Pulse Market
        </h1>

        <button
          className="mt-6 flex h-[62px] w-full items-center justify-center gap-4 rounded-lg bg-[#0093fd] px-5 text-base font-semibold text-white transition hover:bg-[#26a3fd]"
          onClick={() => showProviderPlaceholder("Google")}
          type="button"
        >
          <span className="text-2xl font-black leading-none">G</span>
          Continue with Google
        </button>

        <div className="my-6 grid grid-cols-[1fr_auto_1fr] items-center gap-5 text-lg font-semibold uppercase text-[#7b8996]">
          <span className="h-px bg-[#242b32]" />
          OR
          <span className="h-px bg-[#242b32]" />
        </div>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="flex h-[58px] items-center gap-2 rounded-xl border border-[#242b32] bg-[#181d21] px-3 transition focus-within:border-[#0093fd]/70">
            <input
              className="min-w-0 flex-1 bg-transparent text-base font-medium text-[#dee3e7] outline-none placeholder:text-[#7b8996]"
              value={email}
              onChange={(event) => updateEmail(event.target.value)}
              type="email"
              autoComplete="email"
              placeholder="Email address"
            />
            <button
              className="h-10 shrink-0 rounded-lg bg-[#0093fd] px-3 text-sm font-semibold text-white transition hover:bg-[#26a3fd] disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting
                ? "..."
                : emailAuthStep === "email"
                  ? "Continue"
                  : isRegisterStep
                    ? "Create"
                    : "Log in"}
            </button>
          </div>

          {emailAuthStep !== "email" ? (
            <div className="grid gap-3">
              <p className="text-sm font-semibold text-[#7b8996]">
                {isRegisterStep
                  ? "New account. Add your name and create a password."
                  : "Account found. Enter your password."}
              </p>
              {isRegisterStep ? (
                <TextField
                  label="Display name"
                  value={displayName}
                  onChange={setDisplayName}
                  autoComplete="name"
                  placeholder={getDefaultDisplayName(email)}
                />
              ) : null}
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete={isRegisterStep ? "new-password" : "current-password"}
                placeholder={isRegisterStep ? "At least 10 characters" : "Password"}
              />
              {isLoginStep && needsTwoFactor ? (
                <TextField
                  label="2FA code"
                  value={twoFactorCode}
                  onChange={setTwoFactorCode}
                  autoComplete="one-time-code"
                  placeholder="123456"
                />
              ) : null}
            </div>
          ) : null}

          {message ? <InlineMessage tone={message.tone} text={message.text} /> : null}
        </form>

        <div className="mt-5 flex justify-center">
          <button
            aria-label="More sign-in options"
            className="grid h-14 w-24 place-items-center rounded-lg bg-[#242b32] text-2xl font-bold tracking-[0.12em] text-[#dee3e7] transition hover:bg-[#2c3540]"
            onClick={() => showProviderPlaceholder("More options")}
            type="button"
          >
            ...
          </button>
        </div>

        <div className="mt-6 flex justify-center gap-3 text-sm font-semibold text-[#7b8996]">
          <button className="transition hover:text-[#dee3e7]" type="button">
            Terms
          </button>
          <span>•</span>
          <button className="transition hover:text-[#dee3e7]" type="button">
            Privacy
          </button>
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
      <span className="text-xs font-bold uppercase tracking-wide text-[#7b8996]">{label}</span>
      <input
        className="h-[52px] rounded-2xl border border-[#242b32] bg-[#181d21] px-4 text-sm font-semibold text-[#dee3e7] outline-none placeholder:text-[#7b8996] transition focus:border-[#0093fd]/70"
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
        tone === "success" ? "bg-[#3db468]/10 text-[#a6d2b6]" : "bg-[#cb3131]/10 text-[#daa]"
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
