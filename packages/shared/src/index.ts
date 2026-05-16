export const CATEGORIES = [
  "Income",
  "Essentials",
  "Food & Dining",
  "Groceries",
  "Travel",
  "Shopping",
  "Subscriptions",
  "Healthcare",
  "Family",
  "Education",
  "Insurance",
  "Loans/EMI",
  "Investments",
  "Transfers",
  "Cash",
  "Fees & Charges",
  "Uncategorized",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const REVIEW_TYPES = [
  "unknown_category",
  "low_confidence_category",
  "possible_duplicate",
  "possible_transfer",
  "possible_credit_card_payment",
  "possible_investment_transfer",
  "possible_recurring_payment",
  "unusual_expense",
  "missing_account_period",
  "import_issue",
  "snapshot_refresh",
] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

export type AccountType =
  | "bank"
  | "credit_card"
  | "wallet"
  | "investment"
  | "loan"
  | "manual_asset"
  | "manual_liability"
  | "cash";

export type SourceType = "csv" | "xls" | "xlsx" | "manual";

export interface VaultProfile {
  country: string;
  baseCurrency: string;
  fiscalYearStartMonth: number;
  timezone: string;
  dateFormat: string;
  numberFormat: string;
  compliancePack: string;
}

export const INDIA_DEFAULT_PROFILE: VaultProfile = {
  country: "IN",
  baseCurrency: "INR",
  fiscalYearStartMonth: 4,
  timezone: "Asia/Kolkata",
  dateFormat: "DD/MM/YYYY",
  numberFormat: "en-IN",
  compliancePack: "india-manual-import-alpha",
};

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution?: string;
  currency: string;
  openingMonth?: string;
  expectedMonthly?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  filename: string;
  sourceType: SourceType;
  status: "draft" | "committed" | "undone" | "failed";
  detectedStartDate?: string;
  detectedEndDate?: string;
  confidence: number;
  rowCount: number;
  committedAt?: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  importBatchId?: string;
  transactionDate: string;
  valueDate?: string;
  description: string;
  normalizedDescription: string;
  reference?: string;
  amount: number;
  direction: "inflow" | "outflow";
  balance?: number;
  currency: string;
  category: Category;
  categoryConfidence: number;
  status: "active" | "duplicate" | "excluded" | "inactive";
  transferGroupId?: string;
  sourceRowId?: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryRule {
  id: string;
  label: string;
  pattern: string;
  category: Category;
  accountId?: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewItem {
  id: string;
  type: ReviewType;
  status: "open" | "resolved" | "skipped";
  title: string;
  detail: string;
  impactAmount?: number;
  accountId?: string;
  transactionId?: string;
  relatedTransactionId?: string;
  importBatchId?: string;
  suggestedAction?: string;
  payload?: unknown;
  createdAt: string;
  resolvedAt?: string;
}

export interface NetWorthSnapshot {
  id: string;
  snapshotDate: string;
  label: string;
  kind: "asset" | "liability";
  assetType: string;
  value: number;
  currency: string;
  source: "manual" | "imported" | "estimated";
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  type: string;
  entityType: string;
  entityId?: string;
  payload?: unknown;
  createdAt: string;
}

export interface PeriodSummary {
  period: string;
  income: number;
  expenses: number;
  investments: number;
  transfers: number;
  refunds: number;
  fees: number;
  savings: number;
  savingsRate: number;
  unclassified: number;
  transactionCount: number;
}

export interface LifetimeSummary extends PeriodSummary {
  period: "lifetime";
  currentNetWorth: number;
  wealthRetentionRatio: number;
  dataCoveragePercent: number;
}

export interface CoverageMonth {
  accountId: string;
  month: string;
  status: "complete" | "partial" | "missing";
  transactionCount: number;
  confidence: number;
}

export interface CoverageResult {
  months: CoverageMonth[];
  completeMonths: number;
  partialMonths: number;
  missingMonths: number;
  coveragePercent: number;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function normalizeMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return null;
  }

  let text = String(value).trim();
  if (!text) {
    return null;
  }

  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  if (/\bdr\b/i.test(text)) {
    sign = -1;
  }

  text = text
    .replace(/[₹$€£]/g, "")
    .replace(/\b(cr|dr)\b/gi, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (text.startsWith("-")) {
    sign = -1;
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? Math.abs(parsed) * sign : null;
}

export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function monthKey(date: string | Date): string {
  const value = typeof date === "string" ? parseDate(date) : date;
  if (!value || Number.isNaN(value.getTime())) {
    throw new Error(`Invalid date for month key: ${String(date)}`);
  }
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function parseDate(value: unknown, preferredFormat = "DD/MM/YYYY"): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const iso = /^\d{4}-\d{2}-\d{2}/.test(raw) ? new Date(raw) : null;
  if (iso && !Number.isNaN(iso.getTime())) {
    return iso;
  }

  const parts = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!parts) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const year = Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3]);
  const day = preferredFormat.startsWith("MM") ? second : first;
  const month = preferredFormat.startsWith("MM") ? first : second;
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [startYear, start] = startMonth.split("-").map(Number);
  const [endYear, end] = endMonth.split("-").map(Number);
  let cursor = new Date(Date.UTC(startYear, start - 1, 1));
  const last = new Date(Date.UTC(endYear, end - 1, 1));

  while (cursor <= last) {
    months.push(monthKey(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return months;
}

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
      ...init?.headers,
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, { status });
}
