import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SecretHygieneIssue = {
  code:
    | "TRACKED_ENV_FILE"
    | "PRIVATE_KEY_MATERIAL"
    | "LIVE_TOKEN_LITERAL"
    | "SENSITIVE_ENV_VALUE";
  file: string;
  line?: number;
  key?: string;
  message: string;
};

export type SecretHygieneReport = {
  ok: boolean;
  checkedFiles: number;
  issues: SecretHygieneIssue[];
};

const localEnvFilenames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".env.development.local",
  ".env.test.local",
]);
const envAssignmentPattern =
  /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/;
const sensitiveEnvKeyPattern =
  /^(?:[A-Z0-9_]*_)?(?:SECRET|PRIVATE_KEY|API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|DATABASE_URL|REDIS_URL|PASSWORD)$/;
const privateKeyPattern =
  /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/;
const liveTokenPattern =
  /\b(?:sk_live_[A-Za-z0-9]{16,}|pk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/;
const safePlaceholderTerms = [
  "change-this",
  "dev-only",
  "example",
  "localhost",
  "local",
  "placeholder",
  "replace-with",
  "test",
  "user:password",
  "your-",
];

export async function auditRepositorySecretHygiene(
  options: { files?: string[]; root?: string } = {},
): Promise<SecretHygieneReport> {
  const root = resolve(options.root ?? process.cwd());
  const files = options.files ?? (await listCandidateFiles(root));
  const issues: SecretHygieneIssue[] = [];

  for (const file of files) {
    const absolutePath = resolve(root, file);
    const displayPath = relative(root, absolutePath).replaceAll("\\", "/");
    const filename = displayPath.split("/").at(-1) ?? displayPath;
    if (localEnvFilenames.has(filename)) {
      issues.push({
        code: "TRACKED_ENV_FILE",
        file: displayPath,
        message: `${displayPath} must not be part of the repository candidate.`,
      });
      continue;
    }

    let content: string;
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }
    issues.push(...auditSecretContent(displayPath, content));
  }

  return {
    ok: issues.length === 0,
    checkedFiles: files.length,
    issues,
  };
}

export function auditSecretContent(
  file: string,
  content: string,
): SecretHygieneIssue[] {
  const issues: SecretHygieneIssue[] = [];

  content.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (privateKeyPattern.test(line)) {
      issues.push({
        code: "PRIVATE_KEY_MATERIAL",
        file,
        line: lineNumber,
        message: "Repository files must not contain private key material.",
      });
    }
    if (liveTokenPattern.test(line)) {
      issues.push({
        code: "LIVE_TOKEN_LITERAL",
        file,
        line: lineNumber,
        message: "Repository files must not contain live provider token literals.",
      });
    }

    const assignment = line.match(envAssignmentPattern);
    if (!assignment) return;
    const [, key = "", rawValue = ""] = assignment;
    if (!sensitiveEnvKeyPattern.test(key)) return;
    const value = normalizeEnvValue(rawValue);
    if (isSafePlaceholder(key, value)) return;
    issues.push({
      code: "SENSITIVE_ENV_VALUE",
      file,
      line: lineNumber,
      key,
      message: `${key} has a non-placeholder value in a repository file.`,
    });
  });

  return issues;
}

async function listCandidateFiles(root: string) {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, maxBuffer: 20 * 1024 * 1024 },
  );
  return stdout.split("\0").filter(Boolean);
}

function normalizeEnvValue(rawValue: string) {
  const trimmed = rawValue.trim();
  const commentIndex = trimmed.search(/\s#/);
  const withoutComment =
    commentIndex >= 0 ? trimmed.slice(0, commentIndex).trim() : trimmed;
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1).trim();
  }
  return withoutComment;
}

function isSafePlaceholder(key: string, value: string) {
  if (
    !value ||
    value === "\\" ||
    value.startsWith("$") ||
    value.startsWith("<")
  ) {
    return true;
  }
  const normalized = value.toLowerCase();
  if (["admin", "password", "local"].includes(normalized)) return true;
  if (key.endsWith("DATABASE_URL") || key.endsWith("REDIS_URL")) {
    try {
      const parsed = new URL(value);
      if (
        !parsed.password &&
        (!parsed.username ||
          safePlaceholderTerms.some((term) =>
            parsed.username.toLowerCase().includes(term),
          ))
      ) {
        return true;
      }
    } catch {
      // A malformed non-placeholder connection string remains an issue.
    }
  }
  return safePlaceholderTerms.some((term) => normalized.includes(term));
}
