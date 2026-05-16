import {
  Account,
  Category,
  CategoryRule,
  CoverageResult,
  LifetimeSummary,
  monthKey,
  monthRange,
  NetWorthSnapshot,
  normalizeDescription,
  PeriodSummary,
  Transaction,
} from "../../shared/src";

export interface CategorySuggestion {
  category: Category;
  confidence: number;
  source: "rule" | "heuristic" | "fallback";
  reason: string;
}

export interface DuplicateCandidate {
  transactionIds: string[];
  fingerprint: string;
  confidence: number;
}

export interface TransferCandidate {
  outflowTransactionId: string;
  inflowTransactionId: string;
  amount: number;
  kind: "self_transfer" | "credit_card_payment" | "investment_transfer" | "wallet_load" | "cash_movement";
  confidence: number;
}

export interface RecurringPayment {
  merchant: string;
  amount: number;
  cadence: "monthly";
  transactionIds: string[];
  confidence: number;
}

const HEURISTICS: Array<{ category: Category; confidence: number; reason: string; patterns: RegExp[] }> = [
  { category: "Income", confidence: 0.95, reason: "income keyword", patterns: [/salary/, /bonus/, /payroll/, /dividend/, /interest credit/] },
  { category: "Investments", confidence: 0.9, reason: "investment keyword", patterns: [/sip/, /mutual/, /zerodha/, /groww/, /nifty/, /demat/, /broker/, /ppf/, /epf/, /nps/, /\bfd\b/] },
  { category: "Transfers", confidence: 0.8, reason: "transfer keyword", patterns: [/self/, /neft/, /imps/, /rtgs/, /credit card payment/, /wallet load/] },
  { category: "Food & Dining", confidence: 0.85, reason: "food merchant", patterns: [/swiggy/, /zomato/, /restaurant/, /cafe/, /food/] },
  { category: "Groceries", confidence: 0.85, reason: "grocery merchant", patterns: [/grocery/, /bigbasket/, /dmart/, /blinkit/, /zepto/] },
  { category: "Subscriptions", confidence: 0.85, reason: "subscription merchant", patterns: [/netflix/, /spotify/, /prime/, /hotstar/, /subscription/] },
  { category: "Travel", confidence: 0.8, reason: "travel keyword", patterns: [/uber/, /ola/, /irctc/, /flight/, /hotel/, /metro/, /fuel/] },
  { category: "Healthcare", confidence: 0.8, reason: "healthcare keyword", patterns: [/hospital/, /pharmacy/, /medical/, /doctor/] },
  { category: "Insurance", confidence: 0.8, reason: "insurance keyword", patterns: [/insurance/, /premium/] },
  { category: "Loans/EMI", confidence: 0.85, reason: "loan keyword", patterns: [/\bemi\b/, /loan/] },
  { category: "Cash", confidence: 0.75, reason: "cash keyword", patterns: [/\batm\b/, /cash withdrawal/, /cash deposit/] },
  { category: "Fees & Charges", confidence: 0.8, reason: "fee keyword", patterns: [/fee/, /charge/, /gst/, /penalty/] },
  { category: "Essentials", confidence: 0.75, reason: "essential keyword", patterns: [/rent/, /electricity/, /water bill/, /broadband/, /gas bill/] },
  { category: "Shopping", confidence: 0.65, reason: "shopping keyword", patterns: [/amazon/, /flipkart/, /myntra/, /shopping/] },
];

export function categorizeTransaction(transaction: Pick<Transaction, "description" | "normalizedDescription">, rules: CategoryRule[]): CategorySuggestion {
  const normalized = normalizeDescription(transaction.normalizedDescription || transaction.description);
  const matchingRule = [...rules]
    .filter((rule) => rule.enabled)
    .sort((left, right) => right.priority - left.priority)
    .find((rule) => normalized.includes(normalizeDescription(rule.pattern)));

  if (matchingRule) {
    return {
      category: matchingRule.category,
      confidence: 1,
      source: "rule",
      reason: matchingRule.label,
    };
  }

  for (const heuristic of HEURISTICS) {
    if (heuristic.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        category: heuristic.category,
        confidence: heuristic.confidence,
        source: "heuristic",
        reason: heuristic.reason,
      };
    }
  }

  return {
    category: "Uncategorized",
    confidence: 0.2,
    source: "fallback",
    reason: "No matching rule or high-confidence heuristic.",
  };
}

export function findDuplicateCandidates(transactions: Transaction[]): DuplicateCandidate[] {
  const groups = activeTransactions(transactions).reduce<Map<string, Transaction[]>>((map, transaction) => {
    const group = map.get(transaction.fingerprint) ?? [];
    group.push(transaction);
    map.set(transaction.fingerprint, group);
    return map;
  }, new Map());

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([fingerprint, group]) => ({
      transactionIds: group.map((transaction) => transaction.id),
      fingerprint,
      confidence: 1,
    }));
}

export function findTransferCandidates(transactions: Transaction[]): TransferCandidate[] {
  const active = activeTransactions(transactions);
  const outflows = active.filter((transaction) => transaction.amount < 0);
  const inflows = active.filter((transaction) => transaction.amount > 0);
  const candidates: TransferCandidate[] = [];

  for (const outflow of outflows) {
    for (const inflow of inflows) {
      if (outflow.accountId === inflow.accountId) {
        continue;
      }
      if (Math.abs(Math.abs(outflow.amount) - inflow.amount) > 1) {
        continue;
      }
      if (Math.abs(daysBetween(outflow.transactionDate, inflow.transactionDate)) > 3) {
        continue;
      }

      candidates.push({
        outflowTransactionId: outflow.id,
        inflowTransactionId: inflow.id,
        amount: inflow.amount,
        kind: transferKind(outflow, inflow),
        confidence: transferConfidence(outflow, inflow),
      });
    }
  }

  return candidates;
}

export function detectRecurringPayments(transactions: Transaction[]): RecurringPayment[] {
  const groups = activeTransactions(transactions)
    .filter((transaction) => transaction.amount < 0 && transaction.category !== "Transfers")
    .reduce<Map<string, Transaction[]>>((map, transaction) => {
      const key = `${merchantKey(transaction)}|${Math.round(Math.abs(transaction.amount))}`;
      const group = map.get(key) ?? [];
      group.push(transaction);
      map.set(key, group);
      return map;
    }, new Map());

  return [...groups.values()]
    .map((group) => group.sort((left, right) => left.transactionDate.localeCompare(right.transactionDate)))
    .filter((group) => group.length >= 3 && hasMonthlyCadence(group))
    .map((group) => ({
      merchant: merchantKey(group[0]),
      amount: Math.abs(group[0].amount),
      cadence: "monthly" as const,
      transactionIds: group.map((transaction) => transaction.id),
      confidence: 0.9,
    }));
}

export function calculateCoverage(accounts: Account[], transactions: Transaction[], now = new Date()): CoverageResult {
  const currentMonth = monthKey(now);
  const months = accounts
    .filter((account) => account.expectedMonthly !== false)
    .flatMap((account) => {
      const accountTransactions = activeTransactions(transactions).filter((transaction) => transaction.accountId === account.id);
      const firstTransactionMonth = accountTransactions.map((transaction) => monthKey(transaction.transactionDate)).sort()[0];
      const startMonth = account.openingMonth ?? firstTransactionMonth ?? currentMonth;
      return monthRange(startMonth, currentMonth).map((month) => {
        const transactionCount = accountTransactions.filter((transaction) => monthKey(transaction.transactionDate) === month).length;
        const isCurrent = month === currentMonth;
        const status: "complete" | "partial" | "missing" = transactionCount > 0 && !isCurrent ? "complete" : isCurrent ? "partial" : "missing";
        return {
          accountId: account.id,
          month,
          status,
          transactionCount,
          confidence: status === "complete" ? 1 : status === "partial" ? 0.5 : 0,
        };
      });
    });

  const completeMonths = months.filter((coverage) => coverage.status === "complete").length;
  const partialMonths = months.filter((coverage) => coverage.status === "partial").length;
  const missingMonths = months.filter((coverage) => coverage.status === "missing").length;
  const weighted = completeMonths + partialMonths * 0.5;
  const coveragePercent = months.length ? Math.round((weighted / months.length) * 100) : 0;

  return {
    months,
    completeMonths,
    partialMonths,
    missingMonths,
    coveragePercent,
  };
}

export function calculateLifetimeSummary(transactions: Transaction[], snapshots: NetWorthSnapshot[] = []): LifetimeSummary {
  const base = summarizeTransactions(activeTransactions(transactions), "lifetime");
  const currentNetWorth = snapshots.reduce((total, snapshot) => total + (snapshot.kind === "asset" ? snapshot.value : -snapshot.value), 0);

  return {
    ...base,
    period: "lifetime",
    currentNetWorth,
    wealthRetentionRatio: base.income > 0 ? roundMoney((currentNetWorth / base.income) * 100) : 0,
    dataCoveragePercent: transactions.length > 0 ? 100 : 0,
  };
}

export function calculateMonthlySummary(transactions: Transaction[], month: string): PeriodSummary {
  return summarizeTransactions(
    activeTransactions(transactions).filter((transaction) => monthKey(transaction.transactionDate) === month),
    month,
  );
}

export function calculateYearlySummary(transactions: Transaction[], year: string | number): PeriodSummary {
  const yearText = String(year);
  return summarizeTransactions(
    activeTransactions(transactions).filter((transaction) => transaction.transactionDate.startsWith(yearText)),
    yearText,
  );
}

function summarizeTransactions(transactions: Transaction[], period: string): PeriodSummary {
  const summary = transactions.reduce(
    (totals, transaction) => {
      const amount = transaction.amount;
      const absolute = Math.abs(amount);

      if (transaction.category === "Transfers") {
        totals.transfers += absolute;
      } else if (transaction.category === "Investments" && amount < 0) {
        totals.investments += absolute;
      } else if (transaction.category === "Fees & Charges" && amount < 0) {
        totals.expenses += absolute;
        totals.fees += absolute;
      } else if (transaction.category === "Uncategorized") {
        totals.unclassified += absolute;
      } else if (transaction.category === "Income" && amount > 0) {
        totals.income += amount;
      } else if (amount > 0) {
        totals.refunds += amount;
      } else if (amount < 0) {
        totals.expenses += absolute;
      }

      totals.transactionCount += 1;
      return totals;
    },
    {
      period,
      income: 0,
      expenses: 0,
      investments: 0,
      transfers: 0,
      refunds: 0,
      fees: 0,
      savings: 0,
      savingsRate: 0,
      unclassified: 0,
      transactionCount: 0,
    },
  );

  summary.income = roundMoney(summary.income);
  summary.expenses = roundMoney(summary.expenses);
  summary.investments = roundMoney(summary.investments);
  summary.transfers = roundMoney(summary.transfers);
  summary.refunds = roundMoney(summary.refunds);
  summary.fees = roundMoney(summary.fees);
  summary.unclassified = roundMoney(summary.unclassified);
  summary.savings = roundMoney(summary.income + summary.refunds - summary.expenses - summary.investments);
  summary.savingsRate = summary.income > 0 ? roundMoney((summary.savings / summary.income) * 100) : 0;

  return summary;
}

function activeTransactions(transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) => transaction.status === "active");
}

function merchantKey(transaction: Transaction): string {
  return normalizeDescription(transaction.normalizedDescription || transaction.description)
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

function hasMonthlyCadence(group: Transaction[]): boolean {
  const months = group.map((transaction) => monthKey(transaction.transactionDate));
  const unique = [...new Set(months)];
  if (unique.length < 3) {
    return false;
  }
  for (let index = 1; index < unique.length; index += 1) {
    if (monthDistance(unique[index - 1], unique[index]) !== 1) {
      return false;
    }
  }
  return true;
}

function monthDistance(left: string, right: string): number {
  const [leftYear, leftMonth] = left.split("-").map(Number);
  const [rightYear, rightMonth] = right.split("-").map(Number);
  return (rightYear - leftYear) * 12 + (rightMonth - leftMonth);
}

function daysBetween(left: string, right: string): number {
  const leftDate = new Date(`${left}T00:00:00.000Z`);
  const rightDate = new Date(`${right}T00:00:00.000Z`);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / (24 * 60 * 60 * 1000));
}

function transferKind(outflow: Transaction, inflow: Transaction): TransferCandidate["kind"] {
  const text = `${normalizeDescription(outflow.description)} ${normalizeDescription(inflow.description)}`;
  if (/credit card|card payment/.test(text)) {
    return "credit_card_payment";
  }
  if (/wallet/.test(text)) {
    return "wallet_load";
  }
  if (/cash|atm/.test(text)) {
    return "cash_movement";
  }
  if (/broker|zerodha|groww|sip|mutual/.test(text)) {
    return "investment_transfer";
  }
  return "self_transfer";
}

function transferConfidence(outflow: Transaction, inflow: Transaction): number {
  const text = `${normalizeDescription(outflow.description)} ${normalizeDescription(inflow.description)}`;
  const hasTransferWords = /self|neft|imps|rtgs|transfer|payment/.test(text);
  return hasTransferWords ? 0.9 : 0.7;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
