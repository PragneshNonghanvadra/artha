import {
  ArrowDownToLine,
  Banknote,
  BarChart3,
  Check,
  CircleAlert,
  ClipboardCheck,
  Database,
  FileInput,
  Landmark,
  ListChecks,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ColumnMapping, ImportPlan } from "../../../packages/import-core/src";
import type { Account, Category, CoverageResult, LifetimeSummary, NetWorthSnapshot, ReviewItem, Transaction } from "../../../packages/shared/src";
import { CATEGORIES } from "../../../packages/shared/src";
import { api, type ExportPayload, type PreviewResponse, type VaultResponse } from "./api";

type Tab = "overview" | "import" | "transactions" | "review" | "coverage" | "net-worth" | "settings";

const tabs: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "import", label: "Import", icon: FileInput },
  { id: "transactions", label: "Transactions", icon: ListChecks },
  { id: "review", label: "Review", icon: ClipboardCheck },
  { id: "coverage", label: "Coverage", icon: Database },
  { id: "net-worth", label: "Net Worth", icon: Landmark },
  { id: "settings", label: "Settings", icon: Shield },
];

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [vault, setVault] = useState<VaultResponse | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [summary, setSummary] = useState<LifetimeSummary | null>(null);
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([]);
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(null);
  const [status, setStatus] = useState("Loading local vault");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    const currentVault = await api.getVault();
    setVault(currentVault);
    if (!currentVault) {
      setStatus("Vault not created");
      setAccounts([]);
      setTransactions([]);
      setReviewItems([]);
      setCoverage(null);
      setSummary(null);
      setSnapshots([]);
      return;
    }

    const [nextAccounts, nextTransactions, nextReviews, nextCoverage, nextSummary, nextSnapshots] = await Promise.all([
      api.listAccounts(),
      api.listTransactions(),
      api.listReviewItems(),
      api.getCoverage(),
      api.getLifetimeSummary(),
      api.listNetWorth(),
    ]);
    setAccounts(nextAccounts);
    setTransactions(nextTransactions);
    setReviewItems(nextReviews);
    setCoverage(nextCoverage);
    setSummary(nextSummary);
    setSnapshots(nextSnapshots);
    setStatus("Local vault ready");
  }

  useEffect(() => {
    refresh().catch((caught) => setError(caught instanceof Error ? caught.message : "Failed to load app"));
  }, []);

  async function createVault() {
    await api.createVault();
    await refresh();
  }

  async function deleteVault() {
    await api.deleteVault();
    setExportPayload(null);
    await refresh();
  }

  const reviewAmount = reviewItems.reduce((total, item) => total + (item.impactAmount ?? 0), 0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <strong>Artha</strong>
            <span>Finance history vault</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={activeTab === tab.id ? "nav-item active" : "nav-item"} onClick={() => setActiveTab(tab.id)}>
                <Icon size={18} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="vault-state">
          <span className={vault ? "dot ok" : "dot warn"} />
          <span>{status}</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Manual-import alpha</p>
            <h1>{tabs.find((tab) => tab.id === activeTab)?.label}</h1>
          </div>
          <button className="icon-button" onClick={() => refresh()} title="Refresh vault data">
            <RefreshCw size={18} />
          </button>
        </header>

        {error ? (
          <div className="notice danger">
            <CircleAlert size={18} />
            <span>{error}</span>
          </div>
        ) : null}

        {!vault ? (
          <section className="panel action-panel">
            <Shield size={28} />
            <div>
              <h2>Local vault</h2>
              <p>INR, India, April-March financial year, no credential collection.</p>
            </div>
            <button className="primary-button" onClick={createVault}>
              <Database size={18} />
              Create Vault
            </button>
          </section>
        ) : null}

        {vault && activeTab === "overview" ? (
          <Overview summary={summary} coverage={coverage} accounts={accounts} transactions={transactions} reviewCount={reviewItems.length} reviewAmount={reviewAmount} />
        ) : null}
        {vault && activeTab === "import" ? <ImportView accounts={accounts} onRefresh={refresh} /> : null}
        {vault && activeTab === "transactions" ? <TransactionsView transactions={transactions} /> : null}
        {vault && activeTab === "review" ? <ReviewView items={reviewItems} onRefresh={refresh} /> : null}
        {vault && activeTab === "coverage" ? <CoverageView coverage={coverage} accounts={accounts} /> : null}
        {vault && activeTab === "net-worth" ? <NetWorthView snapshots={snapshots} onRefresh={refresh} /> : null}
        {vault && activeTab === "settings" ? (
          <SettingsView profile={vault.profile} exportPayload={exportPayload} onExport={async () => setExportPayload(await api.exportData())} onDelete={deleteVault} />
        ) : null}
      </main>
    </div>
  );
}

function Overview({
  summary,
  coverage,
  accounts,
  transactions,
  reviewCount,
  reviewAmount,
}: {
  summary: LifetimeSummary | null;
  coverage: CoverageResult | null;
  accounts: Account[];
  transactions: Transaction[];
  reviewCount: number;
  reviewAmount: number;
}) {
  const metrics = [
    ["Total earned", summary?.income ?? 0],
    ["Total spent", summary?.expenses ?? 0],
    ["Total invested", summary?.investments ?? 0],
    ["Total saved", summary?.savings ?? 0],
    ["Net worth", summary?.currentNetWorth ?? 0],
    ["Review impact", reviewAmount],
  ];

  return (
    <div className="stack">
      <section className="metric-grid">
        {metrics.map(([label, value]) => (
          <div className="metric-card" key={label}>
            <span>{label}</span>
            <strong>{money.format(Number(value))}</strong>
          </div>
        ))}
      </section>

      <section className="panel split-panel">
        <div>
          <h2>Lifetime Money Map</h2>
          <div className="summary-list">
            <Row label="Accounts" value={String(accounts.length)} />
            <Row label="Transactions" value={String(transactions.length)} />
            <Row label="Savings rate" value={`${summary?.savingsRate ?? 0}%`} />
            <Row label="Wealth retained" value={`${summary?.wealthRetentionRatio ?? 0}%`} />
            <Row label="Coverage" value={`${coverage?.coveragePercent ?? 0}%`} />
            <Row label="Open review" value={String(reviewCount)} />
          </div>
        </div>
        <div className="notice">
          <CircleAlert size={18} />
          <span>{coverage?.missingMonths ? `${coverage.missingMonths} account-months are missing.` : "Coverage warnings will appear here."}</span>
        </div>
      </section>
    </div>
  );
}

function ImportView({ accounts, onRefresh }: { accounts: Account[]; onRefresh: () => Promise<void> }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState<Account["type"]>("bank");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId && accounts[0]) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  async function addAccount(event: React.FormEvent) {
    event.preventDefault();
    const account = await api.createAccount({ name: accountName, type: accountType, currency: "INR", openingMonth: currentMonth });
    setAccountId(account.id);
    setAccountName("");
    await onRefresh();
  }

  async function previewFile() {
    if (!file || !accountId) {
      setMessage("Select an account and file.");
      return;
    }
    const nextPreview = await api.previewImport(accountId, file);
    setPreview(nextPreview);
    setMapping(nextPreview.plan.mapping);
    setMessage(`Preview ready: ${nextPreview.plan.transactions.length} rows`);
  }

  async function remap() {
    if (!preview) {
      return;
    }
    const nextPreview = await api.remapImport(preview.sessionId, mapping);
    setPreview(nextPreview);
    setMessage("Mapping refreshed");
  }

  async function commit() {
    if (!preview) {
      return;
    }
    const result = await api.commitImport(preview.sessionId);
    setPreview(null);
    setFile(null);
    setMessage(`Committed ${result.transactions.length} transactions`);
    await onRefresh();
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Accounts</h2>
        <form className="inline-form" onSubmit={addAccount}>
          <input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Account name" required />
          <select value={accountType} onChange={(event) => setAccountType(event.target.value as Account["type"])}>
            <option value="bank">Bank</option>
            <option value="credit_card">Credit card</option>
            <option value="wallet">Wallet</option>
            <option value="investment">Investment</option>
            <option value="loan">Loan</option>
          </select>
          <button className="secondary-button" type="submit">
            <Banknote size={18} />
            Add
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Statement Import</h2>
        <div className="import-row">
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">Select account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <input type="file" accept=".csv,.xls,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <button className="primary-button" type="button" onClick={previewFile}>
            <Upload size={18} />
            Preview
          </button>
        </div>
        {message ? <p className="status-line">{message}</p> : null}
      </section>

      {preview ? <ImportPreview plan={preview.plan} mapping={mapping} setMapping={setMapping} onRemap={remap} onCommit={commit} /> : null}
    </div>
  );
}

function ImportPreview({
  plan,
  mapping,
  setMapping,
  onRemap,
  onCommit,
}: {
  plan: ImportPlan;
  mapping: ColumnMapping;
  setMapping: (mapping: ColumnMapping) => void;
  onRemap: () => Promise<void>;
  onCommit: () => Promise<void>;
}) {
  const mappingFields: Array<keyof ColumnMapping> = ["transactionDate", "description", "debitAmount", "creditAmount", "signedAmount", "balance", "reference"];
  const columns = Object.keys(plan.transactions[0]?.raw ?? {});

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Preview</h2>
          <p>{plan.detectedStartDate ?? "Unknown"} to {plan.detectedEndDate ?? "Unknown"} · Confidence {Math.round(plan.confidence * 100)}%</p>
        </div>
        <div className="button-row">
          <button className="secondary-button" onClick={onRemap}>
            <RefreshCw size={18} />
            Remap
          </button>
          <button className="primary-button" onClick={onCommit}>
            <Check size={18} />
            Commit
          </button>
        </div>
      </div>

      <div className="mapping-grid">
        {mappingFields.map((field) => (
          <label key={field}>
            <span>{field}</span>
            <select value={mapping[field] ?? ""} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value || undefined })}>
              <option value="">Not mapped</option>
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {plan.issues.length ? (
        <div className="notice danger">
          <CircleAlert size={18} />
          <span>{plan.issues.length} rows need import review.</span>
        </div>
      ) : null}

      <DataTable
        columns={["Date", "Description", "Amount", "Balance", "Fingerprint"]}
        rows={plan.transactions.slice(0, 8).map((transaction) => [
          transaction.transactionDate,
          transaction.description,
          money.format(transaction.amount),
          transaction.balance === undefined ? "-" : money.format(transaction.balance),
          transaction.fingerprint,
        ])}
      />
    </section>
  );
}

function TransactionsView({ transactions }: { transactions: Transaction[] }) {
  return (
    <section className="panel">
      <h2>Ledger</h2>
      <DataTable
        columns={["Date", "Account", "Description", "Category", "Amount", "Source"]}
        rows={transactions.map((transaction) => [
          transaction.transactionDate,
          transaction.accountId,
          transaction.description,
          transaction.category,
          money.format(transaction.amount),
          transaction.importBatchId ?? "manual",
        ])}
      />
    </section>
  );
}

function ReviewView({ items, onRefresh }: { items: ReviewItem[]; onRefresh: () => Promise<void> }) {
  const [categoryChoices, setCategoryChoices] = useState<Record<string, Category>>({});

  async function resolve(item: ReviewItem, category?: Category) {
    await api.resolveReviewItem(item.id, { status: "resolved", category });
    await onRefresh();
  }

  async function skip(item: ReviewItem) {
    await api.resolveReviewItem(item.id, { status: "skipped" });
    await onRefresh();
  }

  return (
    <div className="review-list">
      {items.length === 0 ? <section className="panel empty">No open review items.</section> : null}
      {items.map((item) => (
        <section className="panel review-item" key={item.id}>
          <div>
            <p className="eyebrow">{item.type.replaceAll("_", " ")}</p>
            <h2>{item.title}</h2>
            <p>{item.detail}</p>
            {item.impactAmount ? <strong>{money.format(item.impactAmount)}</strong> : null}
          </div>
          <div className="review-actions">
            {item.type.includes("category") ? (
              <>
                <select
                  value={categoryChoices[item.id] ?? "Shopping"}
                  onChange={(event) => setCategoryChoices({ ...categoryChoices, [item.id]: event.target.value as Category })}
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <button className="secondary-button" onClick={() => resolve(item, categoryChoices[item.id] ?? "Shopping")}>
                  <Check size={18} />
                  Apply
                </button>
              </>
            ) : (
              <button className="secondary-button" onClick={() => resolve(item)}>
                <Check size={18} />
                Resolve
              </button>
            )}
            <button className="ghost-button" onClick={() => skip(item)}>
              Skip
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

function CoverageView({ coverage, accounts }: { coverage: CoverageResult | null; accounts: Account[] }) {
  const accountName = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);
  return (
    <section className="panel">
      <h2>Historical Coverage</h2>
      <div className="coverage-strip">
        <span>Complete {coverage?.completeMonths ?? 0}</span>
        <span>Partial {coverage?.partialMonths ?? 0}</span>
        <span>Missing {coverage?.missingMonths ?? 0}</span>
        <strong>{coverage?.coveragePercent ?? 0}%</strong>
      </div>
      <DataTable
        columns={["Account", "Month", "Status", "Rows", "Confidence"]}
        rows={(coverage?.months ?? []).map((month) => [
          accountName.get(month.accountId) ?? month.accountId,
          month.month,
          month.status,
          String(month.transactionCount),
          `${Math.round(month.confidence * 100)}%`,
        ])}
      />
    </section>
  );
}

function NetWorthView({ snapshots, onRefresh }: { snapshots: NetWorthSnapshot[]; onRefresh: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [kind, setKind] = useState<"asset" | "liability">("asset");
  const total = snapshots.reduce((sum, snapshot) => sum + (snapshot.kind === "asset" ? snapshot.value : -snapshot.value), 0);

  async function addSnapshot(event: React.FormEvent) {
    event.preventDefault();
    await api.addSnapshot({
      snapshotDate: new Date().toISOString().slice(0, 10),
      label,
      kind,
      assetType: kind === "asset" ? "other_asset" : "other_liability",
      value: Number(value),
      currency: "INR",
      source: "manual",
    });
    setLabel("");
    setValue("");
    await onRefresh();
  }

  return (
    <div className="stack">
      <section className="metric-grid">
        <div className="metric-card">
          <span>Current net worth</span>
          <strong>{money.format(total)}</strong>
        </div>
        <div className="metric-card">
          <span>Snapshots</span>
          <strong>{snapshots.length}</strong>
        </div>
      </section>
      <section className="panel">
        <h2>Snapshot</h2>
        <form className="inline-form" onSubmit={addSnapshot}>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label" required />
          <select value={kind} onChange={(event) => setKind(event.target.value as "asset" | "liability")}>
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
          </select>
          <input value={value} onChange={(event) => setValue(event.target.value)} type="number" min="0" placeholder="Value" required />
          <button className="primary-button" type="submit">
            <WalletCards size={18} />
            Add
          </button>
        </form>
      </section>
      <section className="panel">
        <DataTable columns={["Date", "Label", "Kind", "Value", "Source"]} rows={snapshots.map((snapshot) => [snapshot.snapshotDate, snapshot.label, snapshot.kind, money.format(snapshot.value), snapshot.source])} />
      </section>
    </div>
  );
}

function SettingsView({
  profile,
  exportPayload,
  onExport,
  onDelete,
}: {
  profile: VaultResponse["profile"];
  exportPayload: ExportPayload | null;
  onExport: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="stack">
      <section className="panel split-panel">
        <div>
          <h2>Profile</h2>
          <div className="summary-list">
            <Row label="Country" value={profile.country} />
            <Row label="Currency" value={profile.baseCurrency} />
            <Row label="Fiscal year start" value={`Month ${profile.fiscalYearStartMonth}`} />
            <Row label="Timezone" value={profile.timezone} />
          </div>
        </div>
        <div className="privacy-list">
          <span>No credential collection</span>
          <span>No OTP collection</span>
          <span>No bank sync</span>
          <span>No cloud AI by default</span>
        </div>
      </section>

      <section className="panel">
        <div className="button-row">
          <button className="secondary-button" onClick={onExport}>
            <ArrowDownToLine size={18} />
            Export
          </button>
          <button className="danger-button" onClick={onDelete}>
            <Trash2 size={18} />
            Delete Vault
          </button>
        </div>
        {exportPayload ? <pre className="export-box">{JSON.stringify(exportPayload, null, 2)}</pre> : null}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>No rows</td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${row.join("|")}-${index}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${cell}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
