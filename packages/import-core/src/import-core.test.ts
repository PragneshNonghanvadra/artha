import { describe, expect, test } from "bun:test";
import {
  buildImportPlan,
  generateTransactionFingerprint,
  inferColumnMapping,
  parseImportFile,
} from "./index";

const encoder = new TextEncoder();

function csvFile(contents: string) {
  return {
    filename: "hdfc-may-2026.csv",
    sourceType: "csv" as const,
    data: encoder.encode(contents),
  };
}

describe("import-core", () => {
  test("parses CSV files and infers debit-credit bank statement columns", () => {
    const parsed = parseImportFile(
      csvFile(`Date,Narration,Debit,Credit,Balance,Ref
01/05/2026,SALARY ACME,,120000,125000,SAL001
03/05/2026,UPI SWIGGY,850,,124150,UPI001
05/05/2026,SIP NIFTY INDEX,10000,,114150,SIP001`),
    );

    expect(parsed.headers).toEqual(["Date", "Narration", "Debit", "Credit", "Balance", "Ref"]);
    expect(parsed.rows).toHaveLength(3);

    const plan = buildImportPlan(parsed, { accountId: "acc_bank", currency: "INR" });

    expect(plan.detectedStartDate).toBe("2026-05-01");
    expect(plan.detectedEndDate).toBe("2026-05-05");
    expect(plan.mapping.debitAmount).toBe("Debit");
    expect(plan.mapping.creditAmount).toBe("Credit");
    expect(plan.transactions.map((tx) => tx.amount)).toEqual([120000, -850, -10000]);
    expect(plan.transactions[1].direction).toBe("outflow");
    expect(plan.transactions[1].balance).toBe(124150);
    expect(plan.issues).toEqual([]);
  });

  test("honors user mapping for single signed amount files", () => {
    const parsed = parseImportFile(
      csvFile(`Posted,Memo,Amount
2026-05-08,Card Cashback,250
2026-05-09,Amazon Purchase,-1999`),
    );

    const plan = buildImportPlan(parsed, {
      accountId: "acc_card",
      currency: "INR",
      mapping: {
        transactionDate: "Posted",
        description: "Memo",
        signedAmount: "Amount",
      },
    });

    expect(plan.mapping.signedAmount).toBe("Amount");
    expect(plan.transactions.map((tx) => tx.amount)).toEqual([250, -1999]);
    expect(plan.transactions.map((tx) => tx.direction)).toEqual(["inflow", "outflow"]);
  });

  test("returns row-level diagnostics without silently dropping invalid rows", () => {
    const parsed = parseImportFile(
      csvFile(`Date,Narration,Debit,Credit
not-a-date,Bad Row,100,
10/05/2026,No Amount,,`),
    );

    const plan = buildImportPlan(parsed, { accountId: "acc_bank", currency: "INR" });

    expect(plan.transactions).toHaveLength(0);
    expect(plan.issues).toHaveLength(2);
    expect(plan.issues[0]).toMatchObject({ rowNumber: 2, code: "invalid_date" });
    expect(plan.issues[1]).toMatchObject({ rowNumber: 3, code: "missing_amount" });
  });

  test("infers common column synonyms and creates stable fingerprints", () => {
    expect(inferColumnMapping(["Txn Date", "Description", "Withdrawal", "Deposit", "Closing Balance"])).toEqual({
      transactionDate: "Txn Date",
      description: "Description",
      debitAmount: "Withdrawal",
      creditAmount: "Deposit",
      balance: "Closing Balance",
    });

    const first = generateTransactionFingerprint({
      accountId: "acc_bank",
      transactionDate: "2026-05-03",
      amount: -850,
      description: "UPI SWIGGY",
      reference: "UPI001",
    });
    const second = generateTransactionFingerprint({
      accountId: "acc_bank",
      transactionDate: "2026-05-03",
      amount: -850,
      description: " upi   swiggy ",
      reference: "UPI001",
    });

    expect(first).toBe(second);
  });
});
