import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
      <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-xl p-8 text-center">
          <div className="rounded-full bg-red-500/20 w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Invalid Link</h2>
          <p className="text-gray-400 mb-6">This password reset link is invalid or missing.</p>
          <button
            onClick={() => navigate("/request-password-reset")}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl transition-colors"
          >
            Request New Link
          </button>
        </div>
      </div>
    );
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

        <h2 className="text-3xl font-bold text-white mb-2">Set New Password</h2>
        <p className="text-gray-400 mb-6">
          Enter your new password below.
        </p>

        {status === "success" ? (
          <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="text-green-400 font-medium mb-1">Password Reset!</p>
                <p className="text-green-300/80 text-sm">{message}</p>
                <p className="text-green-300/60 text-sm mt-1">Redirecting to login...</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                New Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-2xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter new password"
                disabled={status === "loading"}
              />
              <p className="text-xs text-gray-500 mt-1">
                Must be 10+ characters with letters and numbers
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-2">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-2xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Confirm new password"
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
              {status === "loading" ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
