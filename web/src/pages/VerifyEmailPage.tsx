import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { verifyEmailToken } from "../lib/api";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    
    if (!token) {
      setStatus("error");
      setMessage("Verification token is missing.");
      return;
    }

    const verificationToken = token;

    async function verifyEmail() {
      try {
        await verifyEmailToken(verificationToken);
        setStatus("success");
        setMessage("Your email has been verified successfully!");
        setTimeout(() => {
          navigate("/");
        }, 3000);
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Verification failed.");
      }
    }

    verifyEmail();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-xl p-8">
        <div className="text-center">
          {status === "verifying" && (
            <>
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
              <h2 className="text-2xl font-bold text-white mb-2">Verifying Email</h2>
              <p className="text-gray-400">Please wait while we verify your email address...</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="rounded-full bg-green-500/20 w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Email Verified!</h2>
              <p className="text-gray-400 mb-4">{message}</p>
              <p className="text-sm text-gray-500">Redirecting to home page...</p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="rounded-full bg-red-500/20 w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Verification Failed</h2>
              <p className="text-gray-400 mb-6">{message}</p>
              <button
                onClick={() => navigate("/")}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl transition-colors"
              >
                Go to Home
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
