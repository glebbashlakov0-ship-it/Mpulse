const formatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const currencyFormatter = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 2,
});

export function formatMoney(value: number) {
  return `$${formatter.format(value)}`;
}

export function formatUsdt(value: number) {
  return `${currencyFormatter.format(value)} USDT`;
}

export function formatSignedUsdt(value: number) {
  const prefix = value >= 0 ? "+" : "-";

  return `${prefix}${formatUsdt(Math.abs(value))}`;
}

export function formatShares(value: number) {
  return numberFormatter.format(value);
}

export function formatPercent(value: number | null) {
  if (value === null) {
    return "--";
  }

  return `${Math.round(value * 100)}%`;
}

export function formatSignedPercent(value: number) {
  const prefix = value >= 0 ? "+" : "-";

  return `${prefix}${Math.abs(value * 100).toFixed(2)}%`;
}

export function formatCents(value: number | null) {
  if (value === null) {
    return "--";
  }

  return `${Math.max(1, Math.round(value * 100))}¢`;
}

export function formatDate(value: string | null) {
  if (!value) {
    return "TBD";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatShortDate(value: string | null) {
  if (!value) {
    return "Apr 30";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatRelativeTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}
