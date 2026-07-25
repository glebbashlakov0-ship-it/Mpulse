import { auditRepositorySecretHygiene } from "../src/secretHygiene.js";

const report = await auditRepositorySecretHygiene();
console.log(JSON.stringify({ secretHygiene: report }, null, 2));

if (!report.ok) {
  process.exit(1);
}
