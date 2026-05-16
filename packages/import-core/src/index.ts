import * as XLSX from "xlsx";
import {
  normalizeDescription,
  normalizeMoney,
  parseDate,
  SourceType,
  toDateOnly,
} from "../../shared/src";

export interface ImportFileInput {
  filename: string;
  sourceType: SourceType;
  data: Uint8Array | ArrayBuffer;
}

export interface ParsedRow {
  rowNumber: number;
  values: Record<string, string>;
}

export interface ParsedImportFile {
  filename: string;
  sourceType: SourceType;
  headers: string[];
  rows: ParsedRow[];
}

export interface ColumnMapping {
  transactionDate?: string;
  valueDate?: string;
  description?: string;
  debitAmount?: string;
  creditAmount?: string;
  signedAmount?: string;
  balance?: string;
  reference?: string;
  category?: string;
}

export interface ImportIssue {
  rowNumber: number;
  code:
    | "missing_date"
    | "invalid_date"
    | "missing_description"
    | "missing_amount"
    | "ambiguous_amount"
    | "missing_required_mapping";
  message: string;
  column?: string;
}

export interface PlannedTransaction {
  accountId: string;
  transactionDate: string;
  valueDate?: string;
  description: string;
  reference?: string;
  amount: number;
  direction: "inflow" | "outflow";
  balance?: number;
  currency: string;
  fingerprint: string;
  sourceRowNumber: number;
  raw: Record<string, string>;
}

export interface ImportPlan {
  filename: string;
  sourceType: SourceType;
  accountId: string;
  currency: string;
  mapping: ColumnMapping;
  confidence: number;
  detectedStartDate?: string;
  detectedEndDate?: string;
  rowCount: number;
  transactions: PlannedTransaction[];
  issues: ImportIssue[];
}

export interface BuildImportPlanOptions {
  accountId: string;
  currency: string;
  mapping?: ColumnMapping;
  dateFormat?: string;
}

export interface FingerprintInput {
  accountId: string;
  transactionDate: string;
  amount: number;
  description: string;
  reference?: string;
}

const COLUMN_SYNONYMS: Record<keyof ColumnMapping, RegExp[]> = {
  transactionDate: [/^date$/, /txn.*date/, /transaction.*date/, /posted/, /posting.*date/],
  valueDate: [/value.*date/],
  description: [/description/, /narration/, /memo/, /particular/, /details/, /remarks/],
  debitAmount: [/debit/, /withdrawal/, /paid/, /dr amount/, /outflow/],
  creditAmount: [/credit/, /deposit/, /received/, /cr amount/, /inflow/],
  signedAmount: [/^amount$/, /signed.*amount/, /transaction.*amount/],
  balance: [/balance/, /closing/],
  reference: [/ref/, /reference/, /utr/, /txn id/, /transaction id/],
  category: [/category/],
};

export function parseImportFile(input: ImportFileInput): ParsedImportFile {
  if (input.sourceType === "xls" || input.sourceType === "xlsx") {
    return parseWorkbook(input);
  }

  const text = new TextDecoder().decode(input.data);
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim()));
  const headers = headerIndex >= 0 ? rows[headerIndex].map((cell) => cell.trim()) : [];
  const parsedRows = rows
    .slice(headerIndex + 1)
    .map((row, index) => ({
      rowNumber: headerIndex + index + 2,
      values: rowToObject(headers, row),
    }))
    .filter((row) => Object.values(row.values).some((value) => value.trim()));

  return {
    filename: input.filename,
    sourceType: input.sourceType,
    headers,
    rows: parsedRows,
  };
}

export function inferColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    for (const [field, patterns] of Object.entries(COLUMN_SYNONYMS) as [keyof ColumnMapping, RegExp[]][]) {
      if (mapping[field]) {
        continue;
      }
      if (patterns.some((pattern) => pattern.test(normalized))) {
        mapping[field] = header;
      }
    }
  }

  if (mapping.signedAmount && (mapping.debitAmount || mapping.creditAmount)) {
    delete mapping.signedAmount;
  }

  return mapping;
}

export function buildImportPlan(parsed: ParsedImportFile, options: BuildImportPlanOptions): ImportPlan {
  const mapping = { ...inferColumnMapping(parsed.headers), ...options.mapping };
  const issues: ImportIssue[] = [];
  const transactions: PlannedTransaction[] = [];

  if (!mapping.transactionDate) {
    issues.push({
      rowNumber: 1,
      code: "missing_required_mapping",
      message: "Transaction date column is required.",
    });
  }
  if (!mapping.description) {
    issues.push({
      rowNumber: 1,
      code: "missing_required_mapping",
      message: "Description column is required.",
    });
  }
  if (!mapping.signedAmount && !mapping.debitAmount && !mapping.creditAmount) {
    issues.push({
      rowNumber: 1,
      code: "missing_required_mapping",
      message: "Amount, debit, or credit column is required.",
    });
  }

  if (issues.some((issue) => issue.rowNumber === 1)) {
    return {
      filename: parsed.filename,
      sourceType: parsed.sourceType,
      accountId: options.accountId,
      currency: options.currency,
      mapping,
      confidence: 0,
      rowCount: parsed.rows.length,
      transactions: [],
      issues,
    };
  }

  for (const row of parsed.rows) {
    const transaction = normalizeParsedRow(row, mapping, options.accountId, options.currency, options.dateFormat);
    if ("issue" in transaction) {
      issues.push(transaction.issue);
      continue;
    }
    transactions.push(transaction);
  }

  const dates = transactions.map((transaction) => transaction.transactionDate).sort();
  const confidence = calculateConfidence(parsed.rows.length, transactions.length, issues.length, mapping);

  return {
    filename: parsed.filename,
    sourceType: parsed.sourceType,
    accountId: options.accountId,
    currency: options.currency,
    mapping,
    confidence,
    detectedStartDate: dates[0],
    detectedEndDate: dates.at(-1),
    rowCount: parsed.rows.length,
    transactions,
    issues,
  };
}

export function normalizeParsedRow(
  row: ParsedRow,
  mapping: ColumnMapping,
  accountId: string,
  currency = "INR",
  dateFormat = "DD/MM/YYYY",
): PlannedTransaction | { issue: ImportIssue } {
  const dateColumn = mapping.transactionDate;
  const descriptionColumn = mapping.description;
  const rawDate = dateColumn ? row.values[dateColumn] : "";
  const parsedDate = parseDate(rawDate, dateFormat);

  if (!rawDate) {
    return {
      issue: {
        rowNumber: row.rowNumber,
        code: "missing_date",
        message: "Transaction date is missing.",
        column: dateColumn,
      },
    };
  }

  if (!parsedDate) {
    return {
      issue: {
        rowNumber: row.rowNumber,
        code: "invalid_date",
        message: `Could not parse transaction date "${rawDate}".`,
        column: dateColumn,
      },
    };
  }

  const description = descriptionColumn ? row.values[descriptionColumn]?.trim() : "";
  if (!description) {
    return {
      issue: {
        rowNumber: row.rowNumber,
        code: "missing_description",
        message: "Description is missing.",
        column: descriptionColumn,
      },
    };
  }

  const amount = readAmount(row.values, mapping);
  if (amount === null) {
    return {
      issue: {
        rowNumber: row.rowNumber,
        code: "missing_amount",
        message: "Could not find a debit, credit, or signed amount.",
      },
    };
  }

  if (amount === 0) {
    return {
      issue: {
        rowNumber: row.rowNumber,
        code: "ambiguous_amount",
        message: "Zero-amount rows need review before import.",
      },
    };
  }

  const valueDate = mapping.valueDate ? parseDate(row.values[mapping.valueDate], dateFormat) : null;
  const balance = mapping.balance ? normalizeMoney(row.values[mapping.balance]) : null;
  const reference = mapping.reference ? row.values[mapping.reference]?.trim() || undefined : undefined;
  const transactionDate = toDateOnly(parsedDate);

  return {
    accountId,
    transactionDate,
    valueDate: valueDate ? toDateOnly(valueDate) : undefined,
    description,
    reference,
    amount,
    direction: amount >= 0 ? "inflow" : "outflow",
    balance: balance ?? undefined,
    currency,
    fingerprint: generateTransactionFingerprint({
      accountId,
      transactionDate,
      amount,
      description,
      reference,
    }),
    sourceRowNumber: row.rowNumber,
    raw: row.values,
  };
}

export function generateTransactionFingerprint(input: FingerprintInput): string {
  const material = [
    input.accountId,
    input.transactionDate,
    input.amount.toFixed(2),
    normalizeDescription(input.description),
    normalizeDescription(input.reference ?? ""),
  ].join("|");

  return stableHash(material);
}

function parseWorkbook(input: ImportFileInput): ParsedImportFile {
  const workbook = XLSX.read(input.data, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Array<string | number | Date | null>>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const stringRows = rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
  const headerIndex = stringRows.findIndex((row) => row.some((cell) => cell.trim()));
  const headers = headerIndex >= 0 ? stringRows[headerIndex] : [];
  const parsedRows = stringRows
    .slice(headerIndex + 1)
    .map((row, index) => ({
      rowNumber: headerIndex + index + 2,
      values: rowToObject(headers, row),
    }))
    .filter((row) => Object.values(row.values).some((value) => value.trim()));

  return {
    filename: input.filename,
    sourceType: input.sourceType,
    headers,
    rows: parsedRows,
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows;
}

function rowToObject(headers: string[], row: string[]): Record<string, string> {
  return headers.reduce<Record<string, string>>((values, header, index) => {
    values[header] = row[index]?.trim() ?? "";
    return values;
  }, {});
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readAmount(values: Record<string, string>, mapping: ColumnMapping): number | null {
  if (mapping.signedAmount) {
    return normalizeMoney(values[mapping.signedAmount]);
  }

  const debit = mapping.debitAmount ? normalizeMoney(values[mapping.debitAmount]) : null;
  const credit = mapping.creditAmount ? normalizeMoney(values[mapping.creditAmount]) : null;

  if (debit !== null && debit > 0 && credit !== null && credit > 0) {
    return null;
  }
  if (credit !== null && credit !== 0) {
    return Math.abs(credit);
  }
  if (debit !== null && debit !== 0) {
    return -Math.abs(debit);
  }

  return null;
}

function calculateConfidence(rowCount: number, transactionCount: number, issueCount: number, mapping: ColumnMapping): number {
  if (rowCount === 0) {
    return 0;
  }

  const mappingScore =
    Number(Boolean(mapping.transactionDate)) +
    Number(Boolean(mapping.description)) +
    Number(Boolean(mapping.signedAmount || mapping.debitAmount || mapping.creditAmount)) +
    Number(Boolean(mapping.balance));
  const mappingConfidence = mappingScore / 4;
  const rowConfidence = transactionCount / rowCount;
  const issuePenalty = Math.min(0.3, issueCount * 0.05);

  return Math.max(0, Math.min(1, Number(((mappingConfidence + rowConfidence) / 2 - issuePenalty).toFixed(2))));
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `txn_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
