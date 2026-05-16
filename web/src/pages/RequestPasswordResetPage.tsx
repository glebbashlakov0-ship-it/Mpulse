import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-xl p-8">
        <div className="mb-6">
          <button
            onClick={() => navigate("/")}
            className="text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
        </div>

        <h2 className="text-3xl font-bold text-white mb-2">Reset Password</h2>
        <p className="text-gray-400 mb-6">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {status === "success" ? (
          <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-green-400 font-medium mb-1">Check your email</p>
                <p className="text-green-300/80 text-sm">{message}</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-2xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="you@example.com"
                disabled={status === "loading"}
              />
            </div>

            {status === "error" && message && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3">
                <p className="text-red-400 text-sm">{message}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-2xl transition-colors"
            >
              {status === "loading" ? "Sending..." : "Send Reset Link"}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate("/auth")}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}
