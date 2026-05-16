import { Resend } from "resend";
import type { AppConfig } from "./config.js";

export type EmailProvider = {
  sendVerificationEmail(to: string, token: string, displayName: string): Promise<void>;
  sendPasswordResetEmail(to: string, token: string, displayName: string): Promise<void>;
  send2FACodeEmail(to: string, code: string, displayName: string): Promise<void>;
};

export class ResendEmailProvider implements EmailProvider {
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly baseUrl: string;

  constructor(config: { apiKey: string; fromEmail: string; baseUrl: string }) {
    this.resend = new Resend(config.apiKey);
    this.fromEmail = config.fromEmail;
    this.baseUrl = config.baseUrl;
  }

  async sendVerificationEmail(to: string, token: string, displayName: string) {
    const verifyUrl = `${this.baseUrl}/verify-email?token=${encodeURIComponent(token)}`;

    await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: "Verify your Pulse Market email",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to Pulse Market, ${escapeHtml(displayName)}!</h2>
          <p>Please verify your email address to complete your registration.</p>
          <p>
            <a href="${escapeHtml(verifyUrl)}" 
               style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">
              Verify Email
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            Or copy and paste this link into your browser:<br>
            ${escapeHtml(verifyUrl)}
          </p>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.
          </p>
        </div>
      `,
    });
  }

  async sendPasswordResetEmail(to: string, token: string, displayName: string) {
    const resetUrl = `${this.baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

    await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: "Reset your Pulse Market password",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>Hi ${escapeHtml(displayName)},</p>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <p>
            <a href="${escapeHtml(resetUrl)}" 
               style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px;">
              Reset Password
            </a>
          </p>
          <p style="color: #666; font-size: 14px;">
            Or copy and paste this link into your browser:<br>
            ${escapeHtml(resetUrl)}
          </p>
          <p style="color: #666; font-size: 14px;">
            This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
          </p>
        </div>
      `,
    });
  }

  async send2FACodeEmail(to: string, code: string, displayName: string) {
    await this.resend.emails.send({
      from: this.fromEmail,
      to,
      subject: "Your Pulse Market verification code",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Two-Factor Authentication</h2>
          <p>Hi ${escapeHtml(displayName)},</p>
          <p>Your verification code is:</p>
          <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f3f4f6; border-radius: 6px;">
            ${escapeHtml(code)}
          </p>
          <p style="color: #666; font-size: 14px;">
            This code will expire in 10 minutes. If you didn't request this code, please secure your account immediately.
          </p>
        </div>
      `,
    });
  }
}

export class ConsoleEmailProvider implements EmailProvider {
  private readonly logs: Array<{
    type: string;
    to: string;
    token?: string;
    code?: string;
    timestamp: string;
  }> = [];

  async sendVerificationEmail(to: string, token: string, displayName: string) {
    this.logs.push({
      type: "verification",
      to,
      token,
      timestamp: new Date().toISOString(),
    });
    console.log(`[ConsoleEmail] Verification email to ${to}: token=${token}`);
  }

  async sendPasswordResetEmail(to: string, token: string, displayName: string) {
    this.logs.push({
      type: "password_reset",
      to,
      token,
      timestamp: new Date().toISOString(),
    });
    console.log(`[ConsoleEmail] Password reset email to ${to}: token=${token}`);
  }

  async send2FACodeEmail(to: string, code: string, displayName: string) {
    this.logs.push({
      type: "2fa_code",
      to,
      code,
      timestamp: new Date().toISOString(),
    });
    console.log(`[ConsoleEmail] 2FA code email to ${to}: code=${code}`);
  }

  getLogs() {
    return [...this.logs];
  }

  clearLogs() {
    this.logs.length = 0;
  }
}

export function buildEmailProvider(config: AppConfig): EmailProvider {
  if (!config.resendApiKey || config.resendApiKey === "local") {
    return new ConsoleEmailProvider();
  }

  return new ResendEmailProvider({
    apiKey: config.resendApiKey,
    fromEmail: config.emailFromAddress,
    baseUrl: config.appBaseUrl,
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
