import { readdir } from "node:fs/promises";
import {
  intentionallyOmittedMigrationNumbers,
  migrations,
} from "../src/migrationPlan.js";

const migrationFilenamePattern = /^\d{3}_[a-z0-9_]+\.sql$/;

type MigrationPlanCheck = {
  ok: boolean;
  planned: string[];
  files: string[];
  errors: Array<{
    code: string;
    message: string;
    filenames?: string[];
  }>;
};

const files = (await readdir("migrations"))
  .filter((filename) => filename.endsWith(".sql"))
  .sort();
const planned: string[] = [...migrations];
const errors: MigrationPlanCheck["errors"] = [];

const addError = (code: string, message: string, filenames?: string[]) => {
  errors.push({ code, message, filenames });
};

const plannedSet = new Set(planned);
const fileSet = new Set(files);
const duplicatePlanned = planned.filter((filename, index) => planned.indexOf(filename) !== index);
const missingInPlan = files.filter((filename) => !plannedSet.has(filename));
const missingOnDisk = planned.filter((filename) => !fileSet.has(filename));
const invalidFilenames = [...new Set([...files, ...planned])]
  .filter((filename) => !migrationFilenamePattern.test(filename))
  .sort();
const sortedPlanned = [...planned].sort();

if (duplicatePlanned.length > 0) {
  addError(
    "MIGRATION_PLAN_DUPLICATE",
    "Migration plan contains duplicate filenames.",
    [...new Set(duplicatePlanned)],
  );
}

if (missingInPlan.length > 0) {
  addError(
    "MIGRATION_FILE_NOT_PLANNED",
    "Migration files exist on disk but are not listed in src/migrationPlan.ts.",
    missingInPlan,
  );
}

if (missingOnDisk.length > 0) {
  addError(
    "MIGRATION_PLAN_FILE_MISSING",
    "Migration plan references files that do not exist on disk.",
    missingOnDisk,
  );
}

if (invalidFilenames.length > 0) {
  addError(
    "MIGRATION_FILENAME_INVALID",
    "Migration filenames must use the 000_description.sql format.",
    invalidFilenames,
  );
}

if (planned.join("\n") !== sortedPlanned.join("\n")) {
  addError(
    "MIGRATION_PLAN_ORDER_INVALID",
    "Migration plan order must match filename order.",
    planned,
  );
}

const numbers = planned.map((filename) => Number(filename.slice(0, 3)));
const plannedNumbers = new Set(numbers);
const omittedNumbers = new Set<number>(intentionallyOmittedMigrationNumbers);
const highestNumber = Math.max(...numbers);
const undeclaredGaps = Array.from(
  { length: highestNumber },
  (_, index) => index + 1,
).filter((number) => !plannedNumbers.has(number) && !omittedNumbers.has(number));
const conflictingOmissions = [...omittedNumbers].filter((number) =>
  plannedNumbers.has(number),
);

if (undeclaredGaps.length > 0 || conflictingOmissions.length > 0) {
  addError(
    "MIGRATION_PLAN_NUMBERING_INVALID",
    "Migration plan numbering must be contiguous from 001 except for explicitly declared clean-port omissions.",
    planned,
  );
}

const report: MigrationPlanCheck = {
  ok: errors.length === 0,
  planned,
  files,
  errors,
};

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exit(1);
}
