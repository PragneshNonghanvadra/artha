import { describe, expect, test } from "bun:test";
import type { Account, CategoryRule, NetWorthSnapshot, Transaction } from "../../shared/src";
import {
  calculateCoverage,
  calculateLifetimeSummary,
  calculateMonthlySummary,
  categorizeTransaction,
  detectRecurringPayments,
  findDuplicateCandidates,
  findTransferCandidates,
} from "./index";

const baseTime = "2026-05-16T00:00:00.000Z";

function tx(overrides: Partial<Transaction>): Transaction {
  const amount = overrides.amount ?? -100;
  return {
    id: overrides.id ?? `tx_${Math.random()}`,
    accountId: overrides.accountId ?? "acc_bank",
    transactionDate: overrides.transactionDate ?? "2026-05-01",
    description: overrides.description ?? "UPI TEST",
    normalizedDescription: overrides.normalizedDescription ?? overrides.description?.toLowerCase() ?? "upi test",
    amount,
    direction: amount >= 0 ? "inflow" : "outflow",
    currency: "INR",
    category: overrides.category ?? "Uncategorized",
    categoryConfidence: overrides.categoryConfidence ?? 0.3,
    status: overrides.status ?? "active",
    fingerprint: overrides.fingerprint ?? `fp_${overrides.id ?? "default"}`,
    createdAt: baseTime,
    updatedAt: baseTime,
    ...overrides,
  };
}

describe("finance-core", () => {
  test("categorizes transactions conservatively and lets user rules win", () => {
    expect(categorizeTransaction(tx({ description: "SALARY ACME MAY" }), [])).toMatchObject({
      category: "Income",
      confidence: 0.95,
    });
    expect(categorizeTransaction(tx({ description: "UPI SWIGGY ORDER" }), [])).toMatchObject({
      category: "Food & Dining",
    });
    expect(categorizeTransaction(tx({ description: "SIP NIFTY INDEX" }), [])).toMatchObject({
      category: "Investments",
    });

    const rules: CategoryRule[] = [
      {
        id: "rule_1",
        label: "Treat Swiggy as shopping",
        pattern: "swiggy",
        category: "Shopping",
        enabled: true,
        priority: 10,
        createdAt: baseTime,
        updatedAt: baseTime,
      },
    ];

    expect(categorizeTransaction(tx({ description: "UPI SWIGGY ORDER" }), rules)).toMatchObject({
      category: "Shopping",
      source: "rule",
      confidence: 1,
    });
  });

  test("finds duplicate candidates from repeated fingerprints", () => {
    const duplicates = findDuplicateCandidates([
      tx({ id: "a", fingerprint: "same" }),
      tx({ id: "b", fingerprint: "same" }),
      tx({ id: "c", fingerprint: "different" }),
    ]);

    expect(duplicates).toEqual([
      {
        transactionIds: ["a", "b"],
        fingerprint: "same",
        confidence: 1,
      },
    ]);
  });

  test("finds likely transfer candidates across accounts", () => {
    const transfers = findTransferCandidates([
      tx({
        id: "bank_out",
        accountId: "acc_bank",
        transactionDate: "2026-05-05",
        amount: -25000,
        description: "NEFT SELF ICICI",
      }),
      tx({
        id: "bank_in",
        accountId: "acc_icici",
        transactionDate: "2026-05-06",
        amount: 25000,
        description: "NEFT FROM HDFC SELF",
      }),
    ]);

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      outflowTransactionId: "bank_out",
      inflowTransactionId: "bank_in",
      amount: 25000,
      kind: "self_transfer",
    });
  });

  test("detects recurring payments by merchant, cadence, and amount", () => {
    const recurring = detectRecurringPayments([
      tx({ id: "n1", transactionDate: "2026-03-10", amount: -649, description: "NETFLIX COM" }),
      tx({ id: "n2", transactionDate: "2026-04-10", amount: -649, description: "NETFLIX COM" }),
      tx({ id: "n3", transactionDate: "2026-05-10", amount: -649, description: "NETFLIX COM" }),
    ]);

    expect(recurring).toEqual([
      {
        merchant: "netflix com",
        amount: 649,
        cadence: "monthly",
        transactionIds: ["n1", "n2", "n3"],
        confidence: 0.9,
      },
    ]);
  });

  test("calculates account-month coverage with missing and partial months", () => {
    const accounts: Account[] = [
      {
        id: "acc_bank",
        name: "HDFC Salary",
        type: "bank",
        currency: "INR",
        openingMonth: "2026-04",
        expectedMonthly: true,
        createdAt: baseTime,
        updatedAt: baseTime,
      },
    ];

    const coverage = calculateCoverage(accounts, [tx({ transactionDate: "2026-05-10" })], new Date("2026-06-16"));

    expect(coverage.months).toEqual([
      { accountId: "acc_bank", month: "2026-04", status: "missing", transactionCount: 0, confidence: 0 },
      { accountId: "acc_bank", month: "2026-05", status: "complete", transactionCount: 1, confidence: 1 },
      { accountId: "acc_bank", month: "2026-06", status: "partial", transactionCount: 0, confidence: 0.5 },
    ]);
    expect(coverage.coveragePercent).toBe(50);
  });

  test("summaries exclude transfers and duplicates from expenses", () => {
    const transactions = [
      tx({ id: "salary", amount: 120000, category: "Income" }),
      tx({ id: "rent", amount: -30000, category: "Essentials" }),
      tx({ id: "sip", amount: -20000, category: "Investments" }),
      tx({ id: "transfer", amount: -10000, category: "Transfers" }),
      tx({ id: "fee", amount: -250, category: "Fees & Charges" }),
      tx({ id: "dup", amount: -30000, category: "Essentials", status: "duplicate" }),
      tx({ id: "uncat", amount: -1000, category: "Uncategorized" }),
    ];
    const snapshots: NetWorthSnapshot[] = [
      {
        id: "snap_asset",
        snapshotDate: "2026-05-16",
        label: "Mutual funds",
        kind: "asset",
        assetType: "mutual_fund",
        value: 300000,
        currency: "INR",
        source: "manual",
        createdAt: baseTime,
      },
      {
        id: "snap_liability",
        snapshotDate: "2026-05-16",
        label: "Credit card outstanding",
        kind: "liability",
        assetType: "credit_card",
        value: 20000,
        currency: "INR",
        source: "manual",
        createdAt: baseTime,
      },
    ];

    expect(calculateMonthlySummary(transactions, "2026-05")).toMatchObject({
      income: 120000,
      expenses: 30250,
      investments: 20000,
      transfers: 10000,
      savings: 69750,
      unclassified: 1000,
    });
    expect(calculateLifetimeSummary(transactions, snapshots)).toMatchObject({
      period: "lifetime",
      income: 120000,
      expenses: 30250,
      investments: 20000,
      currentNetWorth: 280000,
    });
  });
});
