import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
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
    <div className="min-h-screen bg-[#15191d] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[#1e2428] rounded-2xl shadow-xl p-8">
        <div className="text-center">
          {status === "verifying" && (
            <>
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-[#0093fd] mx-auto mb-4"></div>
              <h2 className="text-2xl font-bold text-white mb-2">Verifying Email</h2>
              <p className="text-[#697d91]">Please wait while we verify your email address...</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="rounded-full bg-[#3db468]/20 w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[#3db468]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Email Verified!</h2>
              <p className="text-[#697d91] mb-4">{message}</p>
              <p className="text-sm text-[#7b8996]">Redirecting to home page...</p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="rounded-full bg-[#cb3131]/20 w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-[#cb3131]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Verification Failed</h2>
              <p className="text-[#697d91] mb-6">{message}</p>
              <button
                onClick={() => navigate("/")}
                className="px-6 py-2 bg-[#0093fd] hover:bg-[#26a3fd] text-white rounded-2xl transition-colors"
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
