import { useState } from "react";
import { useNavigate } from "react-router";
import { requestPasswordReset } from "../lib/api";

export function RequestPasswordResetPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    try {
      const data = await requestPasswordReset(email);
      setStatus("success");
      setMessage(data.message || "If the email exists, a password reset link has been sent.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Failed to send reset link.");
    }
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

        <h2 className="text-3xl font-bold text-white mb-2">Reset Password</h2>
        <p className="text-[#697d91] mb-6">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {status === "success" ? (
          <div className="bg-[#3db468]/10 border border-[#3db468]/20 rounded-2xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-[#3db468] mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-[#5fbe82] font-medium mb-1">Check your email</p>
                <p className="text-[#a6d2b6]/80 text-sm">{message}</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[#afbac5] mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2 bg-[#181d21] border border-[#2e3841] rounded-2xl text-white placeholder:text-[#7b8996] focus:outline-none focus:ring-2 focus:ring-[#0093fd] focus:border-transparent"
                placeholder="you@example.com"
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
              {status === "loading" ? "Sending..." : "Send Reset Link"}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate("/auth")}
            className="text-sm text-[#0093fd] hover:text-[#26a3fd] transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}
