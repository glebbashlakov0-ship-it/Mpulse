/**
 * Shared utility functions used across the codebase.
 */

/**
 * Type guard to check if a value is a plain object (not null, not array).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Convert a Date or string to ISO 8601 string format.
 */
export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Convert a Date or string to ISO 8601 string format, or return null if the value is null.
 */
export function toIsoStringOrNull(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Convert a database numeric value (string or number) to a JavaScript number.
 */
export function numberFromDb(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return typeof value === "string" ? Number(value) : value;
}

/**
 * Recursively sort object keys and array elements for stable JSON serialization.
 */
export function sortJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = sortJsonValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
}

/**
 * Normalize JSON value by removing undefined values and converting to stable format.
 */
export function normalizeJsonValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }

  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val !== undefined) {
        normalized[key] = normalizeJsonValue(val);
      }
    }
    return normalized;
  }

  return value;
}

/**
 * Stable JSON stringify with sorted keys for consistent hashing/comparison.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(normalizeJsonValue(value)));
}
