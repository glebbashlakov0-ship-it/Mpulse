import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Laptop,
  LogOut,
  MailCheck,
  Save,
  ShieldCheck,
  UserCircle,
} from "lucide-react";
import {
  confirmTwoFactorSetup,
  disableTwoFactor,
  loadAuthSessions,
  loadTwoFactorStatus,
  regenerateTwoFactorBackupCodes,
  resendVerificationEmail,
  revokeAllAuthSessions,
  revokeAuthSession,
  revokeOtherAuthSessions,
  startTwoFactorSetup,
} from "../lib/api";
import type { AuthSessionInfo, AuthUser, TwoFactorSetup, TwoFactorStatus, UserSettings } from "../lib/types";

const panel = "rounded-3xl border border-[#293440] bg-[#171d24]";

export function ProfilePage({
  user,
  authStatus,
  authError,
  onBack,
  onOpenLogin,
  onLogout,
  onUpdateSettings,
}: {
  user: AuthUser | null;
  authStatus: "loading" | "guest" | "authenticated" | "error";
  authError: string | null;
  onBack: () => void;
  onOpenLogin: () => void;
  onLogout: () => Promise<void>;
  onUpdateSettings: (settings: Partial<UserSettings>) => Promise<AuthUser>;
}) {
  const [language, setLanguage] = React.useState<UserSettings["language"]>("en");
  const [country, setCountry] = React.useState("");
  const [emailNotifications, setEmailNotifications] = React.useState(true);
  const [marketNotifications, setMarketNotifications] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const [sessions, setSessions] = React.useState<AuthSessionInfo[]>([]);
  const [twoFactorStatus, setTwoFactorStatus] = React.useState<TwoFactorStatus | null>(null);
  const [twoFactorSetup, setTwoFactorSetup] = React.useState<TwoFactorSetup | null>(null);
  const [regeneratedBackupCodes, setRegeneratedBackupCodes] = React.useState<string[]>([]);
  const [twoFactorCode, setTwoFactorCode] = React.useState("");
  const [message, setMessage] = React.useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  React.useEffect(() => {
    if (user) {
      setLanguage(user.settings.language);
      setCountry(user.settings.country ?? "");
      setEmailNotifications(user.settings.emailNotifications);
      setMarketNotifications(user.settings.marketNotifications);
    }
  }, [user]);

  React.useEffect(() => {
    if (!user) {
      setSessions([]);
      setTwoFactorStatus(null);
      return;
    }

    void Promise.all([loadAuthSessions(), loadTwoFactorStatus()])
      .then(([nextSessions, nextTwoFactorStatus]) => {
        setSessions(nextSessions);
        setTwoFactorStatus(nextTwoFactorStatus);
      })
      .catch((error) => {
        setMessage({
          tone: "error",
          text: error instanceof Error ? error.message : "Could not load account security.",
        });
      });
  }, [user]);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      await onUpdateSettings({
        language,
        country: country.trim() || null,
        emailNotifications,
        marketNotifications,
      });
      setMessage({ tone: "success", text: "Settings saved." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not save settings.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function logout() {
    setIsLoggingOut(true);
    setMessage(null);
    try {
      await onLogout();
      onBack();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not log out.",
      });
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function sendVerification() {
    setMessage(null);
    try {
      await resendVerificationEmail();
      setMessage({ tone: "success", text: "Verification email sent." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not send verification email.",
      });
    }
  }

  async function revokeSession(sessionId: string) {
    setMessage(null);
    try {
      const session = sessions.find((item) => item.id === sessionId);
      await revokeAuthSession(sessionId);
      if (session?.current) {
        await onLogout();
        return;
      }
      setSessions(await loadAuthSessions());
      setMessage({ tone: "success", text: "Session revoked." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not revoke session.",
      });
    }
  }

  async function revokeOthers() {
    setMessage(null);
    try {
      await revokeOtherAuthSessions();
      setSessions(await loadAuthSessions());
      setMessage({ tone: "success", text: "Other sessions revoked." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not revoke sessions.",
      });
    }
  }

  async function revokeAllSessions() {
    setMessage(null);
    try {
      await revokeAllAuthSessions();
      setSessions([]);
      await onLogout();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not log out all devices.",
      });
    }
  }

  async function startTwoFactor() {
    setMessage(null);
    try {
      setTwoFactorSetup(await startTwoFactorSetup());
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not start 2FA setup.",
      });
    }
  }

  async function confirmTwoFactor() {
    setMessage(null);
    try {
      setTwoFactorStatus(await confirmTwoFactorSetup(twoFactorCode));
      setTwoFactorSetup(null);
      setRegeneratedBackupCodes([]);
      setTwoFactorCode("");
      setMessage({ tone: "success", text: "Two-factor authentication enabled." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not enable 2FA.",
      });
    }
  }

  async function turnOffTwoFactor() {
    setMessage(null);
    try {
      setTwoFactorStatus(await disableTwoFactor(twoFactorCode));
      setRegeneratedBackupCodes([]);
      setTwoFactorCode("");
      setMessage({ tone: "success", text: "Two-factor authentication disabled." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not disable 2FA.",
      });
    }
  }

  async function regenerateBackupCodes() {
    setMessage(null);
    try {
      const result = await regenerateTwoFactorBackupCodes(twoFactorCode);
      setTwoFactorStatus(result.status);
      setRegeneratedBackupCodes(result.backupCodes);
      setTwoFactorCode("");
      setMessage({ tone: "success", text: "Backup codes regenerated. Save them now." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Could not regenerate backup codes.",
      });
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1100px] overflow-x-hidden px-4 py-8 md:px-6 xl:px-8">
      <button
        className="flex w-fit items-center gap-2 rounded-2xl border border-[#293440] px-4 py-2 text-sm font-semibold text-[#8f9aa8] transition hover:border-[#3b91f6]/50 hover:text-[#edf1f5]"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft size={18} />
        All markets
      </button>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className={`${panel} h-fit min-w-0 p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#1d252e] text-[#3b91f6]">
              <UserCircle size={28} />
            </span>
            <div className="min-w-0">
              <strong className="block truncate text-base font-semibold text-[#edf1f5]">
                {user?.displayName ?? "Guest"}
              </strong>
              <span className="block truncate text-sm font-medium text-[#8f9aa8]">
                {user?.email ?? "Not signed in"}
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-3 text-sm font-semibold text-[#8f9aa8]">
            <ProfileStat label="Email" value={user?.emailVerified ? "Verified" : "Unverified"} />
            <ProfileStat label="Currency" value={user?.settings.currency ?? "USDT"} />
            <ProfileStat
              label="Session"
              value={authStatus === "loading" ? "Checking" : user ? "Active" : "Guest"}
            />
          </div>

          {user ? (
            <button
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#293440] px-4 py-3 text-sm font-semibold text-[#edf1f5] transition hover:border-[#d34c45]/60 hover:text-red-300 disabled:opacity-50"
              onClick={logout}
              disabled={isLoggingOut}
              type="button"
            >
              <LogOut size={18} />
              {isLoggingOut ? "Logging out..." : "Logout"}
            </button>
          ) : (
            <button
              className="mt-5 w-full rounded-2xl bg-[#3b91f6] px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none"
              onClick={onOpenLogin}
              type="button"
            >
              Log In
            </button>
          )}
        </aside>

        <section className={`${panel} min-w-0 p-5`}>
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#3b91f6]">
              Profile
            </span>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-[#edf1f5]">
              Settings
            </h1>
          </div>

          <div className="mt-5 grid gap-3">
            {authStatus === "loading" ? (
              <InlineMessage tone="success" text="Loading profile..." />
            ) : null}
            {authStatus === "error" ? (
              <InlineMessage tone="error" text={authError ?? "Could not load profile."} />
            ) : null}
            {message ? <InlineMessage tone={message.tone} text={message.text} /> : null}
          </div>

          {user ? (
            <form className="mt-5 grid gap-4" onSubmit={saveSettings}>
              <label className="grid gap-1">
                <span className="text-xs font-bold uppercase tracking-wide text-[#8f9aa8]">
                  Language
                </span>
                <select
                  className="h-12 rounded-2xl border border-[#293440] bg-[#0f1318] px-3 text-sm font-semibold text-[#edf1f5] outline-none transition focus:border-[#3b91f6]/70"
                  value={language}
                  onChange={(event) =>
                    setLanguage(event.target.value as UserSettings["language"])
                  }
                >
                  <option value="en">English</option>
                  <option value="ar">Arabic</option>
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-bold uppercase tracking-wide text-[#8f9aa8]">
                  Country
                </span>
                <input
                  className="h-12 rounded-2xl border border-[#293440] bg-[#0f1318] px-3 text-sm font-semibold text-[#edf1f5] outline-none placeholder:text-[#8f9aa8] transition focus:border-[#3b91f6]/70"
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  placeholder="Optional"
                />
              </label>

              <Toggle
                label="Email notifications"
                checked={emailNotifications}
                onChange={setEmailNotifications}
              />
              <Toggle
                label="Market notifications"
                checked={marketNotifications}
                onChange={setMarketNotifications}
              />

              <button
                className="flex h-12 w-fit items-center justify-center gap-2 rounded-2xl bg-[#3b91f6] px-5 text-sm font-semibold text-white shadow-[0_4px_0_rgba(36,98,174,0.8)] transition hover:bg-blue-400 active:translate-y-0.5 active:shadow-none disabled:opacity-60"
                disabled={isSaving}
                type="submit"
              >
                <Save size={18} />
                {isSaving ? "Saving..." : "Save settings"}
              </button>
            </form>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-[#293440] bg-[#0f1318] p-8 text-center">
              <strong className="block text-base font-semibold text-[#edf1f5]">
                Sign in required
              </strong>
              <button
                className="mt-4 rounded-2xl bg-[#3b91f6] px-4 py-3 text-sm font-semibold text-white"
                onClick={onOpenLogin}
                type="button"
              >
                Log In
              </button>
            </div>
          )}
        </section>

        {user ? (
          <section className={`${panel} min-w-0 p-5 lg:col-start-2`}>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#3b91f6]">
              Security
            </span>
            <div className="mt-5 grid gap-5">
              {!user.emailVerified ? (
                <SecurityBlock
                  icon={<MailCheck size={21} />}
                  title="Email verification"
                  text="Verify your email to protect password recovery and account notices."
                  actionLabel="Send verification"
                  onAction={sendVerification}
                />
              ) : (
                <SecurityBlock
                  icon={<MailCheck size={21} />}
                  title="Email verified"
                  text="Your email address is verified."
                />
              )}

              <div className="rounded-2xl border border-[#293440] bg-[#0f1318] p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1d252e] text-[#3b91f6]">
                    <ShieldCheck size={21} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className="block text-sm font-semibold text-[#edf1f5]">
                      Two-factor authentication
                    </strong>
                    <p className="mt-1 text-sm font-medium text-[#8f9aa8]">
                      {twoFactorStatus?.enabled
                        ? "Enabled for this account."
                        : "Use an authenticator app or backup code during login."}
                    </p>
                    {twoFactorSetup ? (
                      <div className="mt-4 grid gap-3">
                        <div className="w-fit rounded-2xl border border-[#293440] bg-white p-2">
                          <img
                            alt="Two-factor setup QR code"
                            className="h-40 w-40"
                            src={twoFactorSetup.qrCodeDataUrl}
                          />
                        </div>
                        <code className="break-all rounded-2xl bg-[#171d24] p-3 text-xs text-[#edf1f5]">
                          {twoFactorSetup.otpauthUrl}
                        </code>
                        <p className="text-xs font-semibold text-[#8f9aa8]">
                          Backup codes: {twoFactorSetup.backupCodes.join(", ")}
                        </p>
                      </div>
                    ) : null}
                    {regeneratedBackupCodes.length > 0 ? (
                      <p className="mt-4 rounded-2xl bg-[#171d24] p-3 text-xs font-semibold text-[#edf1f5]">
                        New backup codes: {regeneratedBackupCodes.join(", ")}
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(twoFactorSetup || twoFactorStatus?.enabled) ? (
                        <input
                          className="h-10 rounded-2xl border border-[#293440] bg-[#171d24] px-3 text-sm font-semibold text-[#edf1f5] outline-none"
                          value={twoFactorCode}
                          onChange={(event) => setTwoFactorCode(event.target.value)}
                          placeholder="123456"
                        />
                      ) : null}
                      {twoFactorSetup ? (
                        <button className="rounded-2xl bg-[#3b91f6] px-4 py-2 text-sm font-semibold text-white" onClick={confirmTwoFactor} type="button">
                          Confirm
                        </button>
                      ) : twoFactorStatus?.enabled ? (
                        <>
                          <button className="rounded-2xl border border-[#293440] px-4 py-2 text-sm font-semibold text-[#edf1f5]" onClick={regenerateBackupCodes} type="button">
                            Regenerate backup codes
                          </button>
                          <button className="rounded-2xl border border-[#293440] px-4 py-2 text-sm font-semibold text-[#edf1f5]" onClick={turnOffTwoFactor} type="button">
                            Disable
                          </button>
                        </>
                      ) : (
                        <button className="rounded-2xl bg-[#3b91f6] px-4 py-2 text-sm font-semibold text-white" onClick={startTwoFactor} type="button">
                          Set up 2FA
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#293440] bg-[#0f1318] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1d252e] text-[#3b91f6]">
                      <Laptop size={21} />
                    </span>
                    <div>
                      <strong className="block text-sm font-semibold text-[#edf1f5]">
                        Sessions and devices
                      </strong>
                      <span className="text-sm font-medium text-[#8f9aa8]">
                        {sessions.length} active session{sessions.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button className="rounded-2xl border border-[#293440] px-3 py-2 text-xs font-semibold text-[#edf1f5]" onClick={revokeOthers} type="button">
                      Revoke others
                    </button>
                    <button className="rounded-2xl border border-red-500/40 px-3 py-2 text-xs font-semibold text-red-200" onClick={revokeAllSessions} type="button">
                      Log out all devices
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-2">
                  {sessions.map((session) => (
                    <div className="grid gap-2 rounded-2xl bg-[#171d24] p-3 text-sm font-semibold text-[#8f9aa8] md:grid-cols-[1fr_auto] md:items-center" key={session.id}>
                      <div className="min-w-0">
                        <span className="block truncate text-[#edf1f5]">
                          {session.userAgent ?? "Unknown device"} {session.current ? "(current)" : ""}
                        </span>
                        <span className="block text-xs">
                          Last seen {new Date(session.lastSeenAt).toLocaleString()} · {session.ipAddress ?? "unknown IP"}
                        </span>
                      </div>
                      <button className="rounded-2xl border border-[#293440] px-3 py-2 text-xs text-[#edf1f5]" onClick={() => revokeSession(session.id)} type="button">
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function SecurityBlock({
  icon,
  title,
  text,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[#293440] bg-[#0f1318] p-4">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#1d252e] text-[#3b91f6]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <strong className="block text-sm font-semibold text-[#edf1f5]">{title}</strong>
        <p className="mt-1 text-sm font-medium text-[#8f9aa8]">{text}</p>
      </div>
      {actionLabel && onAction ? (
        <button
          className="rounded-2xl border border-[#293440] px-3 py-2 text-xs font-semibold text-[#edf1f5]"
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#0f1318] px-3 py-2">
      <span>{label}</span>
      <strong className="min-w-0 truncate text-[#edf1f5]">{value}</strong>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-[#293440] bg-[#0f1318] px-4 py-3 text-sm font-semibold text-[#edf1f5]">
      <span>{label}</span>
      <input
        className="h-5 w-5 accent-[#3b91f6]"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
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
