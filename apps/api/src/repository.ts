import type { Database } from "bun:sqlite";
import { existsSync, unlinkSync } from "node:fs";
import {
  calculateCoverage as calculateCoverageCore,
  calculateLifetimeSummary as calculateLifetimeSummaryCore,
  calculateMonthlySummary,
  calculateYearlySummary,
  categorizeTransaction,
  detectRecurringPayments,
  findDuplicateCandidates,
  findTransferCandidates,
} from "../../../packages/finance-core/src";
import type { ImportPlan } from "../../../packages/import-core/src";
import {
  Account,
  AccountType,
  AuditEvent,
  Category,
  CategoryRule,
  CoverageResult,
  INDIA_DEFAULT_PROFILE,
  ImportBatch,
  LifetimeSummary,
  makeId,
  NetWorthSnapshot,
  normalizeDescription,
  nowIso,
  PeriodSummary,
  ReviewItem,
  Transaction,
  VaultProfile,
} from "../../../packages/shared/src";
import { openDatabase } from "./db";

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  institution?: string;
  currency?: string;
  openingMonth?: string;
  expectedMonthly?: boolean;
}

export interface ResolveReviewDecision {
  status: "resolved" | "skipped";
  category?: Category;
}

export interface CreateSnapshotInput {
  snapshotDate: string;
  label: string;
  kind: "asset" | "liability";
  assetType: string;
  value: number;
  currency: string;
  source: "manual" | "imported" | "estimated";
}

export interface CommitResult {
  batch: ImportBatch;
  transactions: Transaction[];
  reviewItems: ReviewItem[];
}

export interface ExportPayload {
  profile: VaultProfile | null;
  accounts: Account[];
  importBatches: ImportBatch[];
  transactions: Transaction[];
  reviewItems: ReviewItem[];
  rules: CategoryRule[];
  netWorthSnapshots: NetWorthSnapshot[];
  auditEvents: AuditEvent[];
}

export interface FinanceRepository {
  dbPath: string;
  initializeVault(profile?: VaultProfile): void;
  getVault(): { profile: VaultProfile; createdAt: string; updatedAt: string } | null;
  createAccount(input: CreateAccountInput): Account;
  listAccounts(): Account[];
  commitImportPlan(plan: ImportPlan): CommitResult;
  listTransactions(options?: { includeInactive?: boolean }): Transaction[];
  listReviewItems(options?: { includeResolved?: boolean }): ReviewItem[];
  resolveReviewItem(id: string, decision: ResolveReviewDecision): ReviewItem;
  addNetWorthSnapshot(input: CreateSnapshotInput): NetWorthSnapshot;
  listNetWorthSnapshots(): NetWorthSnapshot[];
  calculateCoverage(now?: Date): CoverageResult;
  calculateLifetimeSummary(): LifetimeSummary;
  calculateMonthlySummary(month: string): PeriodSummary;
  calculateYearlySummary(year: string | number): PeriodSummary;
  exportData(): ExportPayload;
  undoImportBatch(batchId: string): void;
  deleteVault(): void;
  close(): void;
}

export function createRepository(dbPath = ".artha/vault.sqlite"): FinanceRepository {
  return new SqliteFinanceRepository(dbPath);
}

class SqliteFinanceRepository implements FinanceRepository {
  readonly dbPath: string;
  private db: Database;
  private closed = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = openDatabase(dbPath);
  }

  initializeVault(profile = INDIA_DEFAULT_PROFILE): void {
    const timestamp = nowIso();
    this.db
      .query(
        `INSERT INTO vault_profile (
          id, country, base_currency, fiscal_year_start_month, timezone, date_format,
          number_format, compliance_pack, created_at, updated_at
        ) VALUES (1, $country, $baseCurrency, $fiscalYearStartMonth, $timezone, $dateFormat,
          $numberFormat, $compliancePack, $createdAt, $updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          country = excluded.country,
          base_currency = excluded.base_currency,
          fiscal_year_start_month = excluded.fiscal_year_start_month,
          timezone = excluded.timezone,
          date_format = excluded.date_format,
          number_format = excluded.number_format,
          compliance_pack = excluded.compliance_pack,
          updated_at = excluded.updated_at`,
      )
      .run({
        country: profile.country,
        baseCurrency: profile.baseCurrency,
        fiscalYearStartMonth: profile.fiscalYearStartMonth,
        timezone: profile.timezone,
        dateFormat: profile.dateFormat,
        numberFormat: profile.numberFormat,
        compliancePack: profile.compliancePack,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    this.audit("vault_initialized", "vault", "vault", { country: profile.country, baseCurrency: profile.baseCurrency });
  }

  getVault(): { profile: VaultProfile; createdAt: string; updatedAt: string } | null {
    const row = this.db.query("SELECT * FROM vault_profile WHERE id = 1").get() as DbVaultProfile | null;
    return row
      ? {
          profile: mapVaultProfile(row),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null;
  }

  createAccount(input: CreateAccountInput): Account {
    const timestamp = nowIso();
    const account: Account = {
      id: makeId("acc"),
      name: input.name,
      type: input.type,
      institution: input.institution,
      currency: input.currency ?? this.getVault()?.profile.baseCurrency ?? "INR",
      openingMonth: input.openingMonth,
      expectedMonthly: input.expectedMonthly ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .query(
        `INSERT INTO accounts (
          id, name, type, institution, currency, opening_month, expected_monthly, created_at, updated_at
        ) VALUES ($id, $name, $type, $institution, $currency, $openingMonth, $expectedMonthly, $createdAt, $updatedAt)`,
      )
      .run({
        id: account.id,
        name: account.name,
        type: account.type,
        institution: account.institution ?? null,
        currency: account.currency,
        openingMonth: account.openingMonth ?? null,
        expectedMonthly: account.expectedMonthly === false ? 0 : 1,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      });
    this.audit("account_created", "account", account.id, { name: account.name, type: account.type });
    return account;
  }

  listAccounts(): Account[] {
    return this.db.query("SELECT * FROM accounts ORDER BY created_at ASC").all().map((row) => mapAccount(row as DbAccount));
  }

  commitImportPlan(plan: ImportPlan): CommitResult {
    const timestamp = nowIso();
    const batch: ImportBatch = {
      id: makeId("batch"),
      accountId: plan.accountId,
      filename: plan.filename,
      sourceType: plan.sourceType,
      status: "committed",
      detectedStartDate: plan.detectedStartDate,
      detectedEndDate: plan.detectedEndDate,
      confidence: plan.confidence,
      rowCount: plan.rowCount,
      committedAt: timestamp,
      createdAt: timestamp,
    };
    const reviewItems: ReviewItem[] = [];
    const transactions: Transaction[] = [];
    const rules = this.listRules();

    const write = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO import_batches (
            id, account_id, filename, source_type, status, detected_start_date, detected_end_date,
            confidence, row_count, committed_at, created_at
          ) VALUES ($id, $accountId, $filename, $sourceType, $status, $detectedStartDate, $detectedEndDate,
            $confidence, $rowCount, $committedAt, $createdAt)`,
        )
        .run({
          id: batch.id,
          accountId: batch.accountId,
          filename: batch.filename,
          sourceType: batch.sourceType,
          status: batch.status,
          detectedStartDate: batch.detectedStartDate ?? null,
          detectedEndDate: batch.detectedEndDate ?? null,
          confidence: batch.confidence,
          rowCount: batch.rowCount,
          committedAt: batch.committedAt ?? null,
          createdAt: batch.createdAt,
        });

      for (const planned of plan.transactions) {
        const rawRowId = makeId("raw");
        this.db
          .query(
            `INSERT INTO raw_import_rows (
              id, import_batch_id, row_number, payload_json, diagnostics_json, created_at
            ) VALUES ($id, $importBatchId, $rowNumber, $payloadJson, $diagnosticsJson, $createdAt)`,
          )
          .run({
            id: rawRowId,
            importBatchId: batch.id,
            rowNumber: planned.sourceRowNumber,
            payloadJson: JSON.stringify(planned.raw),
            diagnosticsJson: "[]",
            createdAt: timestamp,
          });

        const suggestion = categorizeTransaction(
          {
            description: planned.description,
            normalizedDescription: normalizeDescription(planned.description),
          },
          rules,
        );
        const transaction: Transaction = {
          id: makeId("txn"),
          accountId: planned.accountId,
          importBatchId: batch.id,
          transactionDate: planned.transactionDate,
          valueDate: planned.valueDate,
          description: planned.description,
          normalizedDescription: normalizeDescription(planned.description),
          reference: planned.reference,
          amount: planned.amount,
          direction: planned.direction,
          balance: planned.balance,
          currency: planned.currency,
          category: suggestion.category,
          categoryConfidence: suggestion.confidence,
          status: "active",
          sourceRowId: rawRowId,
          fingerprint: planned.fingerprint,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        this.insertTransaction(transaction);
        transactions.push(transaction);

        if (suggestion.category === "Uncategorized" || suggestion.confidence < 0.75) {
          const reviewItem = this.insertReviewItem({
            type: "low_confidence_category",
            title: `Review category for ${transaction.description}`,
            detail: `Suggested category is ${suggestion.category} with ${Math.round(suggestion.confidence * 100)}% confidence.`,
            impactAmount: Math.abs(transaction.amount),
            accountId: transaction.accountId,
            transactionId: transaction.id,
            importBatchId: batch.id,
            suggestedAction: "Confirm or choose a category.",
            payload: { suggestedCategory: suggestion.category, reason: suggestion.reason },
          });
          reviewItems.push(reviewItem);
        }
      }

      for (const issue of plan.issues) {
        reviewItems.push(
          this.insertReviewItem({
            type: "import_issue",
            title: `Import issue on row ${issue.rowNumber}`,
            detail: issue.message,
            importBatchId: batch.id,
            suggestedAction: "Fix the source row or remap columns, then re-import.",
            payload: issue,
          }),
        );
      }

      this.audit("import_committed", "import_batch", batch.id, {
        filename: batch.filename,
        transactionCount: transactions.length,
        issueCount: plan.issues.length,
      });
    });

    write();
    this.createCandidateReviewItems(batch.id);
    return {
      batch,
      transactions,
      reviewItems: this.listReviewItems().filter((item) => item.importBatchId === batch.id),
    };
  }

  listTransactions(options: { includeInactive?: boolean } = {}): Transaction[] {
    const rows = this.db.query("SELECT * FROM transactions ORDER BY transaction_date ASC, created_at ASC").all() as DbTransaction[];
    return rows
      .map(mapTransaction)
      .filter((transaction) => options.includeInactive || transaction.status === "active");
  }

  listReviewItems(options: { includeResolved?: boolean } = {}): ReviewItem[] {
    const rows = this.db.query("SELECT * FROM review_items ORDER BY created_at ASC").all() as DbReviewItem[];
    return rows.map(mapReviewItem).filter((item) => options.includeResolved || item.status === "open");
  }

  resolveReviewItem(id: string, decision: ResolveReviewDecision): ReviewItem {
    const item = this.getReviewItem(id);
    if (!item) {
      throw new Error(`Review item not found: ${id}`);
    }

    const timestamp = nowIso();
    if (decision.category && item.transactionId) {
      this.db
        .query("UPDATE transactions SET category = $category, category_confidence = 1, updated_at = $updatedAt WHERE id = $id")
        .run({ category: decision.category, updatedAt: timestamp, id: item.transactionId });
    }

    this.db
      .query("UPDATE review_items SET status = $status, resolved_at = $resolvedAt WHERE id = $id")
      .run({ status: decision.status, resolvedAt: timestamp, id: id });
    this.audit("review_resolved", "review_item", id, { decision });

    const resolved = this.getReviewItem(id, true);
    if (!resolved) {
      throw new Error(`Review item disappeared after resolution: ${id}`);
    }
    return resolved;
  }

  addNetWorthSnapshot(input: CreateSnapshotInput): NetWorthSnapshot {
    const snapshot: NetWorthSnapshot = {
      id: makeId("snap"),
      createdAt: nowIso(),
      ...input,
    };

    this.db
      .query(
        `INSERT INTO net_worth_snapshots (
          id, snapshot_date, label, kind, asset_type, value, currency, source, created_at
        ) VALUES ($id, $snapshotDate, $label, $kind, $assetType, $value, $currency, $source, $createdAt)`,
      )
      .run({
        id: snapshot.id,
        snapshotDate: snapshot.snapshotDate,
        label: snapshot.label,
        kind: snapshot.kind,
        assetType: snapshot.assetType,
        value: snapshot.value,
        currency: snapshot.currency,
        source: snapshot.source,
        createdAt: snapshot.createdAt,
      });
    this.audit("net_worth_snapshot_added", "net_worth_snapshot", snapshot.id, { label: snapshot.label, value: snapshot.value });
    return snapshot;
  }

  listNetWorthSnapshots(): NetWorthSnapshot[] {
    return (this.db.query("SELECT * FROM net_worth_snapshots ORDER BY snapshot_date ASC").all() as DbSnapshot[]).map(mapSnapshot);
  }

  calculateCoverage(now = new Date()): CoverageResult {
    return calculateCoverageCore(this.listAccounts(), this.listTransactions(), now);
  }

  calculateLifetimeSummary(): LifetimeSummary {
    const coverage = this.calculateCoverage();
    return {
      ...calculateLifetimeSummaryCore(this.listTransactions(), this.listNetWorthSnapshots()),
      dataCoveragePercent: coverage.coveragePercent,
    };
  }

  calculateMonthlySummary(month: string): PeriodSummary {
    return calculateMonthlySummary(this.listTransactions(), month);
  }

  calculateYearlySummary(year: string | number): PeriodSummary {
    return calculateYearlySummary(this.listTransactions(), year);
  }

  exportData(): ExportPayload {
    return {
      profile: this.getVault()?.profile ?? null,
      accounts: this.listAccounts(),
      importBatches: this.listImportBatches(),
      transactions: this.listTransactions({ includeInactive: true }),
      reviewItems: this.listReviewItems({ includeResolved: true }),
      rules: this.listRules(),
      netWorthSnapshots: this.listNetWorthSnapshots(),
      auditEvents: this.listAuditEvents(),
    };
  }

  undoImportBatch(batchId: string): void {
    const timestamp = nowIso();
    this.db
      .query("UPDATE import_batches SET status = 'undone' WHERE id = $id")
      .run({ id: batchId });
    this.db
      .query("UPDATE transactions SET status = 'inactive', updated_at = $updatedAt WHERE import_batch_id = $batchId")
      .run({ updatedAt: timestamp, batchId: batchId });
    this.db
      .query("UPDATE review_items SET status = 'resolved', resolved_at = $resolvedAt WHERE import_batch_id = $batchId AND status = 'open'")
      .run({ resolvedAt: timestamp, batchId: batchId });
    this.audit("import_undone", "import_batch", batchId);
  }

  deleteVault(): void {
    this.audit("vault_deleted", "vault", "vault");
    this.close();
    for (const path of [this.dbPath, `${this.dbPath}-wal`, `${this.dbPath}-shm`]) {
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
  }

  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }

  private listImportBatches(): ImportBatch[] {
    return (this.db.query("SELECT * FROM import_batches ORDER BY created_at ASC").all() as DbImportBatch[]).map(mapImportBatch);
  }

  private listRules(): CategoryRule[] {
    return (this.db.query("SELECT * FROM category_rules WHERE enabled = 1 ORDER BY priority DESC").all() as DbRule[]).map(mapRule);
  }

  private listAuditEvents(): AuditEvent[] {
    return (this.db.query("SELECT * FROM audit_events ORDER BY created_at ASC").all() as DbAuditEvent[]).map(mapAuditEvent);
  }

  private insertTransaction(transaction: Transaction): void {
    this.db
      .query(
        `INSERT INTO transactions (
          id, account_id, import_batch_id, transaction_date, value_date, description,
          normalized_description, reference, amount, direction, balance, currency, category,
          category_confidence, status, transfer_group_id, source_row_id, fingerprint, created_at, updated_at
        ) VALUES ($id, $accountId, $importBatchId, $transactionDate, $valueDate, $description,
          $normalizedDescription, $reference, $amount, $direction, $balance, $currency, $category,
          $categoryConfidence, $status, $transferGroupId, $sourceRowId, $fingerprint, $createdAt, $updatedAt)`,
      )
      .run({
        id: transaction.id,
        accountId: transaction.accountId,
        importBatchId: transaction.importBatchId ?? null,
        transactionDate: transaction.transactionDate,
        valueDate: transaction.valueDate ?? null,
        description: transaction.description,
        normalizedDescription: transaction.normalizedDescription,
        reference: transaction.reference ?? null,
        amount: transaction.amount,
        direction: transaction.direction,
        balance: transaction.balance ?? null,
        currency: transaction.currency,
        category: transaction.category,
        categoryConfidence: transaction.categoryConfidence,
        status: transaction.status,
        transferGroupId: transaction.transferGroupId ?? null,
        sourceRowId: transaction.sourceRowId ?? null,
        fingerprint: transaction.fingerprint,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      });
  }

  private insertReviewItem(input: {
    type: ReviewItem["type"];
    title: string;
    detail: string;
    impactAmount?: number;
    accountId?: string;
    transactionId?: string;
    relatedTransactionId?: string;
    importBatchId?: string;
    suggestedAction?: string;
    payload?: unknown;
  }): ReviewItem {
    const item: ReviewItem = {
      id: makeId("review"),
      status: "open",
      createdAt: nowIso(),
      ...input,
    };
    this.db
      .query(
        `INSERT INTO review_items (
          id, type, status, title, detail, impact_amount, account_id, transaction_id,
          related_transaction_id, import_batch_id, suggested_action, payload_json, created_at, resolved_at
        ) VALUES ($id, $type, $status, $title, $detail, $impactAmount, $accountId, $transactionId,
          $relatedTransactionId, $importBatchId, $suggestedAction, $payloadJson, $createdAt, $resolvedAt)`,
      )
      .run({
        id: item.id,
        type: item.type,
        status: item.status,
        title: item.title,
        detail: item.detail,
        impactAmount: item.impactAmount ?? null,
        accountId: item.accountId ?? null,
        transactionId: item.transactionId ?? null,
        relatedTransactionId: item.relatedTransactionId ?? null,
        importBatchId: item.importBatchId ?? null,
        suggestedAction: item.suggestedAction ?? null,
        payloadJson: JSON.stringify(item.payload ?? {}),
        createdAt: item.createdAt,
        resolvedAt: item.resolvedAt ?? null,
      });
    return item;
  }

  private createCandidateReviewItems(batchId: string): void {
    const transactions = this.listTransactions();
    const createdFor = new Set(this.listReviewItems({ includeResolved: true }).map((item) => `${item.type}:${item.transactionId}:${item.relatedTransactionId}`));

    for (const duplicate of findDuplicateCandidates(transactions)) {
      const [first, second] = duplicate.transactionIds;
      const key = `possible_duplicate:${first}:${second}`;
      if (createdFor.has(key)) {
        continue;
      }
      this.insertReviewItem({
        type: "possible_duplicate",
        title: "Possible duplicate transaction",
        detail: "Two transactions have the same statement fingerprint.",
        transactionId: first,
        relatedTransactionId: second,
        importBatchId: batchId,
        suggestedAction: "Confirm whether one row should be excluded.",
        payload: duplicate,
      });
    }

    for (const transfer of findTransferCandidates(transactions)) {
      const key = `possible_transfer:${transfer.outflowTransactionId}:${transfer.inflowTransactionId}`;
      if (createdFor.has(key)) {
        continue;
      }
      this.insertReviewItem({
        type: "possible_transfer",
        title: "Possible transfer",
        detail: `Potential ${transfer.kind.replaceAll("_", " ")} of ${transfer.amount}.`,
        impactAmount: transfer.amount,
        transactionId: transfer.outflowTransactionId,
        relatedTransactionId: transfer.inflowTransactionId,
        importBatchId: batchId,
        suggestedAction: "Confirm transfer so it is excluded from expenses.",
        payload: transfer,
      });
    }

    for (const recurring of detectRecurringPayments(transactions)) {
      this.insertReviewItem({
        type: "possible_recurring_payment",
        title: `Possible recurring payment: ${recurring.merchant}`,
        detail: `Detected ${recurring.cadence} payments around ${recurring.amount}.`,
        impactAmount: recurring.amount,
        importBatchId: batchId,
        suggestedAction: "Confirm if this should be tracked as recurring.",
        payload: recurring,
      });
    }
  }

  private getReviewItem(id: string, includeResolved = false): ReviewItem | null {
    const row = this.db.query("SELECT * FROM review_items WHERE id = $id").get({ id: id }) as DbReviewItem | null;
    if (!row) {
      return null;
    }
    const item = mapReviewItem(row);
    return includeResolved || item.status === "open" ? item : null;
  }

  private audit(type: string, entityType: string, entityId?: string, payload: Record<string, unknown> = {}): void {
    this.db
      .query(
        `INSERT INTO audit_events (id, type, entity_type, entity_id, payload_json, created_at)
         VALUES ($id, $type, $entityType, $entityId, $payloadJson, $createdAt)`,
      )
      .run({
        id: makeId("audit"),
        type: type,
        entityType: entityType,
        entityId: entityId ?? null,
        payloadJson: JSON.stringify(payload),
        createdAt: nowIso(),
      });
  }
}

interface DbVaultProfile {
  country: string;
  base_currency: string;
  fiscal_year_start_month: number;
  timezone: string;
  date_format: string;
  number_format: string;
  compliance_pack: string;
  created_at: string;
  updated_at: string;
}

interface DbAccount {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  opening_month: string | null;
  expected_monthly: number;
  created_at: string;
  updated_at: string;
}

interface DbImportBatch {
  id: string;
  account_id: string;
  filename: string;
  source_type: ImportBatch["sourceType"];
  status: ImportBatch["status"];
  detected_start_date: string | null;
  detected_end_date: string | null;
  confidence: number;
  row_count: number;
  committed_at: string | null;
  created_at: string;
}

interface DbTransaction {
  id: string;
  account_id: string;
  import_batch_id: string | null;
  transaction_date: string;
  value_date: string | null;
  description: string;
  normalized_description: string;
  reference: string | null;
  amount: number;
  direction: Transaction["direction"];
  balance: number | null;
  currency: string;
  category: Category;
  category_confidence: number;
  status: Transaction["status"];
  transfer_group_id: string | null;
  source_row_id: string | null;
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

interface DbReviewItem {
  id: string;
  type: ReviewItem["type"];
  status: ReviewItem["status"];
  title: string;
  detail: string;
  impact_amount: number | null;
  account_id: string | null;
  transaction_id: string | null;
  related_transaction_id: string | null;
  import_batch_id: string | null;
  suggested_action: string | null;
  payload_json: string;
  created_at: string;
  resolved_at: string | null;
}

interface DbRule {
  id: string;
  label: string;
  pattern: string;
  category: Category;
  account_id: string | null;
  enabled: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface DbSnapshot {
  id: string;
  snapshot_date: string;
  label: string;
  kind: NetWorthSnapshot["kind"];
  asset_type: string;
  value: number;
  currency: string;
  source: NetWorthSnapshot["source"];
  created_at: string;
}

interface DbAuditEvent {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string | null;
  payload_json: string;
  created_at: string;
}

function mapVaultProfile(row: DbVaultProfile): VaultProfile {
  return {
    country: row.country,
    baseCurrency: row.base_currency,
    fiscalYearStartMonth: row.fiscal_year_start_month,
    timezone: row.timezone,
    dateFormat: row.date_format,
    numberFormat: row.number_format,
    compliancePack: row.compliance_pack,
  };
}

function mapAccount(row: DbAccount): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    institution: row.institution ?? undefined,
    currency: row.currency,
    openingMonth: row.opening_month ?? undefined,
    expectedMonthly: Boolean(row.expected_monthly),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapImportBatch(row: DbImportBatch): ImportBatch {
  return {
    id: row.id,
    accountId: row.account_id,
    filename: row.filename,
    sourceType: row.source_type,
    status: row.status,
    detectedStartDate: row.detected_start_date ?? undefined,
    detectedEndDate: row.detected_end_date ?? undefined,
    confidence: row.confidence,
    rowCount: row.row_count,
    committedAt: row.committed_at ?? undefined,
    createdAt: row.created_at,
  };
}

function mapTransaction(row: DbTransaction): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    importBatchId: row.import_batch_id ?? undefined,
    transactionDate: row.transaction_date,
    valueDate: row.value_date ?? undefined,
    description: row.description,
    normalizedDescription: row.normalized_description,
    reference: row.reference ?? undefined,
    amount: row.amount,
    direction: row.direction,
    balance: row.balance ?? undefined,
    currency: row.currency,
    category: row.category,
    categoryConfidence: row.category_confidence,
    status: row.status,
    transferGroupId: row.transfer_group_id ?? undefined,
    sourceRowId: row.source_row_id ?? undefined,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReviewItem(row: DbReviewItem): ReviewItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    title: row.title,
    detail: row.detail,
    impactAmount: row.impact_amount ?? undefined,
    accountId: row.account_id ?? undefined,
    transactionId: row.transaction_id ?? undefined,
    relatedTransactionId: row.related_transaction_id ?? undefined,
    importBatchId: row.import_batch_id ?? undefined,
    suggestedAction: row.suggested_action ?? undefined,
    payload: JSON.parse(row.payload_json || "{}"),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function mapRule(row: DbRule): CategoryRule {
  return {
    id: row.id,
    label: row.label,
    pattern: row.pattern,
    category: row.category,
    accountId: row.account_id ?? undefined,
    enabled: Boolean(row.enabled),
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSnapshot(row: DbSnapshot): NetWorthSnapshot {
  return {
    id: row.id,
    snapshotDate: row.snapshot_date,
    label: row.label,
    kind: row.kind,
    assetType: row.asset_type,
    value: row.value,
    currency: row.currency,
    source: row.source,
    createdAt: row.created_at,
  };
}

function mapAuditEvent(row: DbAuditEvent): AuditEvent {
  return {
    id: row.id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id ?? undefined,
    payload: JSON.parse(row.payload_json || "{}"),
    createdAt: row.created_at,
  };
}
