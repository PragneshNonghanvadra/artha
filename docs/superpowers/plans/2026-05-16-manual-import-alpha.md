# Manual Import Alpha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local SQLite-backed alpha vertical slice for manually importing finance statements into a traceable ledger with review, coverage, summaries, net worth, export, and deletion.

**Architecture:** A Bun-powered local API owns SQLite persistence and orchestrates workflows. `packages/import-core` parses and normalizes tabular files into import plans; `packages/finance-core` classifies transactions, finds duplicate/transfer candidates, and calculates summaries. `apps/web` is a React UI for the actual finance workspace.

**Tech Stack:** Bun, TypeScript, React, Vite, SQLite via `bun:sqlite`, SheetJS `xlsx`, Bun test runner, CSS modules/plain CSS.

---

### Task 1: Workspace Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `apps/api/src/.gitkeep`
- Create: `apps/web/src/.gitkeep`
- Create: `packages/shared/src/.gitkeep`
- Create: `packages/import-core/src/.gitkeep`
- Create: `packages/finance-core/src/.gitkeep`

- [ ] **Step 1: Add workspace metadata and scripts**

Create `package.json` with:

```json
{
  "name": "artha",
  "private": true,
  "type": "module",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "build:web": "vite build --config apps/web/vite.config.ts",
    "dev:api": "bun --watch apps/api/src/server.ts",
    "dev:web": "vite --host 127.0.0.1 --port 5174 --config apps/web/vite.config.ts"
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "vite": "latest",
    "typescript": "latest",
    "react": "latest",
    "react-dom": "latest",
    "lucide-react": "latest",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@types/react": "latest",
    "@types/react-dom": "latest"
  }
}
```

- [ ] **Step 2: Add TypeScript configuration**

Create `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `bun install`

Expected: dependencies install and `bun.lock` is created.

- [ ] **Step 4: Run baseline verification**

Run: `bun test`

Expected: 0 tests discovered or a clean pass.

### Task 2: Shared Types and Defaults

**Files:**
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/shared.test.ts`

- [ ] **Step 1: Write failing shared defaults test**

```ts
import { describe, expect, test } from "bun:test";
import { INDIA_DEFAULT_PROFILE, CATEGORIES, normalizeMoney } from "./index";

describe("shared finance defaults", () => {
  test("uses India-first vault defaults without hard-coding global assumptions", () => {
    expect(INDIA_DEFAULT_PROFILE.country).toBe("IN");
    expect(INDIA_DEFAULT_PROFILE.baseCurrency).toBe("INR");
    expect(INDIA_DEFAULT_PROFILE.fiscalYearStartMonth).toBe(4);
    expect(INDIA_DEFAULT_PROFILE.timezone).toBe("Asia/Kolkata");
  });

  test("keeps the initial category set stable", () => {
    expect(CATEGORIES).toContain("Income");
    expect(CATEGORIES).toContain("Investments");
    expect(CATEGORIES).toContain("Transfers");
    expect(CATEGORIES).toContain("Uncategorized");
  });

  test("normalizes Indian formatted money strings", () => {
    expect(normalizeMoney("₹1,23,456.70")).toBe(123456.7);
    expect(normalizeMoney("-2,500")).toBe(-2500);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run: `bun test packages/shared/src/shared.test.ts`

Expected: FAIL because `packages/shared/src/index.ts` does not export the required symbols.

- [ ] **Step 3: Implement shared types/defaults/helpers**

`packages/shared/src/index.ts` should define category constants, profile defaults, account/transaction/review/net-worth/import types, date helpers, `normalizeMoney`, `normalizeDescription`, `monthKey`, and simple JSON response helpers.

- [ ] **Step 4: Run test to verify GREEN**

Run: `bun test packages/shared/src/shared.test.ts`

Expected: PASS.

### Task 3: Import Core

**Files:**
- Create: `packages/import-core/src/index.ts`
- Test: `packages/import-core/src/import-core.test.ts`

- [ ] **Step 1: Write failing import-core tests**

Tests must cover CSV parsing, column inference, user mapping override, signed amount imports, debit/credit imports, row diagnostics, and stable fingerprints.

- [ ] **Step 2: Run tests to verify RED**

Run: `bun test packages/import-core/src/import-core.test.ts`

Expected: FAIL because `parseImportFile`, `buildImportPlan`, and related functions are missing.

- [ ] **Step 3: Implement import-core**

Implement:

```ts
parseImportFile(input: ImportFileInput): ParsedImportFile
buildImportPlan(parsed: ParsedImportFile, options: BuildImportPlanOptions): ImportPlan
inferColumnMapping(headers: string[]): ColumnMapping
normalizeParsedRow(row: ParsedRow, mapping: ColumnMapping, accountId: string): PlannedTransaction
```

CSV parsing can be hand-rolled for quoted values. XLS/XLSX parsing uses `xlsx`. No database writes occur in this package.

- [ ] **Step 4: Run test to verify GREEN**

Run: `bun test packages/import-core/src/import-core.test.ts`

Expected: PASS.

### Task 4: Finance Core

**Files:**
- Create: `packages/finance-core/src/index.ts`
- Test: `packages/finance-core/src/finance-core.test.ts`

- [ ] **Step 1: Write failing finance-core tests**

Tests must cover category heuristics, user rule precedence, duplicate candidate detection, transfer candidate detection, recurring payment detection, coverage calculation, lifetime/monthly summaries, and transfer exclusion from expenses.

- [ ] **Step 2: Run tests to verify RED**

Run: `bun test packages/finance-core/src/finance-core.test.ts`

Expected: FAIL because finance-core exports are missing.

- [ ] **Step 3: Implement finance-core**

Implement:

```ts
categorizeTransaction(tx, rules): CategorySuggestion
findDuplicateCandidates(transactions): DuplicateCandidate[]
findTransferCandidates(transactions): TransferCandidate[]
detectRecurringPayments(transactions): RecurringPayment[]
calculateCoverage(accounts, transactions, now): CoverageResult
calculateLifetimeSummary(transactions, snapshots): LifetimeSummary
calculateMonthlySummary(transactions, month): PeriodSummary
calculateYearlySummary(transactions, year): PeriodSummary
```

- [ ] **Step 4: Run test to verify GREEN**

Run: `bun test packages/finance-core/src/finance-core.test.ts`

Expected: PASS.

### Task 5: SQLite Repository and API

**Files:**
- Create: `apps/api/src/db.ts`
- Create: `apps/api/src/repository.ts`
- Create: `apps/api/src/server.ts`
- Test: `apps/api/src/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Tests must use a temporary SQLite path and cover vault initialization, account creation, import commit, review item creation/resolution, summaries, export payload, undo import, and delete vault.

- [ ] **Step 2: Run tests to verify RED**

Run: `bun test apps/api/src/repository.test.ts`

Expected: FAIL because repository functions are missing.

- [ ] **Step 3: Implement database schema and repository**

Implement migrations for the tables in the design spec. Repository methods should wrap writes in transactions and store audit events.

- [ ] **Step 4: Run repository tests to verify GREEN**

Run: `bun test apps/api/src/repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Implement local API routes**

`apps/api/src/server.ts` should expose:

```text
GET /health
POST /vault
GET /vault
DELETE /vault
GET /accounts
POST /accounts
PATCH /accounts/:id
POST /imports/preview
POST /imports/:sessionId/mapping
POST /imports/:sessionId/commit
POST /imports/:batchId/undo
GET /transactions
GET /review-items
POST /review-items/:id/resolve
POST /review-items/bulk-resolve
GET /coverage
GET /summaries/lifetime
GET /summaries/monthly
GET /summaries/yearly
GET /net-worth
POST /net-worth/snapshots
GET /export
```

- [ ] **Step 6: Smoke test API**

Run: `bun run dev:api`

Expected: API starts on `http://127.0.0.1:5173` and `GET /health` returns `{"ok":true}`.

### Task 6: React Web App

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/styles.css`

- [ ] **Step 1: Build the app shell**

Create a real workspace UI with navigation for Overview, Import, Transactions, Review, Coverage, Net Worth, and Settings.

- [ ] **Step 2: Build import flow**

The Import screen must support account creation/selection, file upload, preview, mapping corrections, commit, and import status.

- [ ] **Step 3: Build review and dashboard views**

The Review screen groups review items and supports resolve/skip flows. Overview, Coverage, Transactions, and Net Worth read from the API and show traceable source metadata and incomplete-data warnings.

- [ ] **Step 4: Build privacy/settings controls**

Settings must show privacy guardrails, export JSON, and delete vault.

- [ ] **Step 5: Build web bundle**

Run: `bun run build:web`

Expected: Vite build succeeds.

### Task 7: Full Verification

**Files:**
- Re-run and adjust the exact files changed in Tasks 1-6 if any verification command reports a concrete failure.

- [ ] **Step 1: Run all tests**

Run: `bun test`

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 3: Run frontend build**

Run: `bun run build:web`

Expected: build succeeds.

- [ ] **Step 4: Start local servers**

Run API: `bun run dev:api`

Run web: `bun run dev:web`

Expected:

- API available at `http://127.0.0.1:5173/health`
- Web app available at `http://127.0.0.1:5174`

- [ ] **Step 5: Browser smoke test**

Open the app, create a vault, add an account, import a sample CSV, commit it, resolve at least one review item, add a net-worth snapshot, export data, and confirm the dashboards update.
