import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImportPlan, parseImportFile } from "../../../packages/import-core/src";
import { createRepository, type FinanceRepository } from "./repository";

const encoder = new TextEncoder();
let cleanupPaths: string[] = [];
let openRepos: FinanceRepository[] = [];

afterEach(() => {
  for (const repo of openRepos) {
    repo.close();
  }
  openRepos = [];
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanupPaths = [];
});

function tempVault() {
  const dir = mkdtempSync(join(tmpdir(), "artha-test-"));
  cleanupPaths.push(dir);
  const repo = createRepository(join(dir, "vault.sqlite"));
  openRepos.push(repo);
  return repo;
}

describe("finance repository", () => {
  test("initializes a local vault with India defaults", () => {
    const repo = tempVault();

    repo.initializeVault();

    expect(repo.getVault()?.profile).toMatchObject({
      country: "IN",
      baseCurrency: "INR",
      fiscalYearStartMonth: 4,
    });
  });

  test("commits imports, creates review items, resolves corrections, summarizes, exports, undoes, and deletes", () => {
    const repo = tempVault();
    repo.initializeVault();
    const account = repo.createAccount({
      name: "HDFC Salary",
      type: "bank",
      institution: "HDFC",
      currency: "INR",
      openingMonth: "2026-05",
      expectedMonthly: true,
    });

    const parsed = parseImportFile({
      filename: "hdfc-may.csv",
      sourceType: "csv",
      data: encoder.encode(`Date,Narration,Debit,Credit,Balance,Ref
01/05/2026,SALARY ACME,,120000,120000,SAL001
02/05/2026,UPI MYSTERY STORE,999,,119001,UPI001
03/05/2026,SIP NIFTY INDEX,10000,,109001,SIP001`),
    });
    const plan = buildImportPlan(parsed, { accountId: account.id, currency: "INR" });

    const commit = repo.commitImportPlan(plan);

    expect(commit.batch.rowCount).toBe(3);
    expect(repo.listTransactions()).toHaveLength(3);
    expect(repo.listTransactions().map((transaction) => transaction.category)).toEqual([
      "Income",
      "Uncategorized",
      "Investments",
    ]);
    expect(repo.listReviewItems().map((item) => item.type)).toContain("low_confidence_category");

    const review = repo.listReviewItems().find((item) => item.type === "low_confidence_category");
    expect(review).toBeDefined();
    repo.resolveReviewItem(review!.id, { category: "Shopping", status: "resolved" });

    const corrected = repo.listTransactions().find((transaction) => transaction.description.includes("MYSTERY"));
    expect(corrected?.category).toBe("Shopping");
    expect(repo.calculateLifetimeSummary()).toMatchObject({
      income: 120000,
      expenses: 999,
      investments: 10000,
      savings: 109001,
    });

    repo.addNetWorthSnapshot({
      snapshotDate: "2026-05-16",
      label: "Mutual funds",
      kind: "asset",
      assetType: "mutual_fund",
      value: 250000,
      currency: "INR",
      source: "manual",
    });

    expect(repo.calculateLifetimeSummary().currentNetWorth).toBe(250000);
    expect(repo.calculateCoverage(new Date("2026-05-16")).coveragePercent).toBe(50);

    const exported = repo.exportData();
    expect(exported.accounts).toHaveLength(1);
    expect(exported.transactions).toHaveLength(3);
    expect(exported.importBatches).toHaveLength(1);
    expect(exported.netWorthSnapshots).toHaveLength(1);
    expect(exported.auditEvents.some((event) => event.type === "review_resolved")).toBe(true);

    repo.undoImportBatch(commit.batch.id);
    expect(repo.listTransactions()).toHaveLength(0);
    expect(repo.exportData().importBatches[0].status).toBe("undone");

    const dbPath = repo.dbPath;
    repo.deleteVault();
    expect(existsSync(dbPath)).toBe(false);
  });
});
