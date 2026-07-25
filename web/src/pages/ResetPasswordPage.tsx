import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { resetPassword } from "../lib/api";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const token = searchParams.get("token");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!token) {
      setStatus("error");
      setMessage("Reset token is missing.");
      return;
    }

    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    if (password.length < 10) {
      setStatus("error");
      setMessage("Password must be at least 10 characters long.");
      return;
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setStatus("error");
      setMessage("Password must include both letters and numbers.");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      await resetPassword({ token, password });
      setStatus("success");
      setMessage("Your password has been reset successfully!");
      setTimeout(() => {
        navigate("/auth");
      }, 2000);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to reset password.");
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-[#15191d] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-[#1e2428] rounded-2xl shadow-xl p-8 text-center">
          <div className="rounded-full bg-[#cb3131]/20 w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#cb3131]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Invalid Link</h2>
          <p className="text-[#697d91] mb-6">This password reset link is invalid or missing.</p>
          <button
            onClick={() => navigate("/request-password-reset")}
            className="px-6 py-2 bg-[#0093fd] hover:bg-[#26a3fd] text-white rounded-2xl transition-colors"
          >
            Request New Link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#15191d] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[#1e2428] rounded-2xl shadow-xl p-8">
        <div className="mb-6">
          <button
            onClick={() => navigate("/")}
            className="text-[#697d91] hover:text-white transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>

        <h2 className="text-3xl font-bold text-white mb-2">Set New Password</h2>
        <p className="text-[#697d91] mb-6">
          Enter your new password below.
        </p>

        {status === "success" ? (
          <div className="bg-[#3db468]/10 border border-[#3db468]/20 rounded-2xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-[#3db468] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-[#5fbe82] font-medium mb-1">Password Reset!</p>
                <p className="text-[#a6d2b6]/80 text-sm">{message}</p>
                <p className="text-[#a6d2b6]/60 text-sm mt-1">Redirecting to login...</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[#afbac5] mb-2">
                New Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2 bg-[#181d21] border border-[#2e3841] rounded-2xl text-white placeholder:text-[#7b8996] focus:outline-none focus:ring-2 focus:ring-[#0093fd] focus:border-transparent"
                placeholder="Enter new password"
                disabled={status === "loading"}
              />
              <p className="text-xs text-[#7b8996] mt-1">
                Must be 10+ characters with letters and numbers
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-[#afbac5] mb-2">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-4 py-2 bg-[#181d21] border border-[#2e3841] rounded-2xl text-white placeholder:text-[#7b8996] focus:outline-none focus:ring-2 focus:ring-[#0093fd] focus:border-transparent"
                placeholder="Confirm new password"
                disabled={status === "loading"}
              />
            </div>

            {status === "error" && message && (
              <div className="bg-[#cb3131]/10 border border-[#cb3131]/20 rounded-2xl p-3">
                <p className="text-[#d05959] text-sm">{message}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full px-4 py-2 bg-[#0093fd] hover:bg-[#26a3fd] disabled:bg-[#2e3841] disabled:cursor-not-allowed text-white font-medium rounded-2xl transition-colors"
            >
              {status === "loading" ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
