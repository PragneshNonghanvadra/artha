# Manual Import Finance History App Design

## Summary

Build a local-first personal finance history app for manually imported financial data. The alpha proves a complete vertical slice: create a local vault, add accounts, import CSV/XLS/XLSX statements, map unknown columns, normalize transactions, detect likely categories/transfers/duplicates, review uncertain items, and see traceable lifetime/monthly financial summaries with coverage and net-worth snapshots.

The product is India-first by default and globally extensible through country, currency, fiscal-year, timezone, date-format, number-format, and source-format configuration. It excludes bank sync, credential collection, tax filing, tax advice, investment recommendations, automated trading, and automated money movement.

## Selected Scope

The first build is an alpha vertical slice with an isolated import worker core:

- Local web app with a React UI.
- Local Bun API backed by SQLite.
- Import and reconciliation logic separated into reusable packages.
- CSV/XLS/XLSX and user-maintained spreadsheet imports in scope.
- PDF/OCR/email/Account Aggregator/cloud backup/tax workflows out of scope.

This scope gives the user a real end-to-end answer to “What happened to all the money I have earned so far?” without pretending every future ingestion channel exists yet.

## Architecture

Use a small monorepo:

- `apps/web`: React app for vault onboarding, account setup, import preview/mapping, review inbox, dashboards, net-worth snapshots, export, and deletion.
- `apps/api`: local Bun HTTP API for vault lifecycle, SQLite persistence, import sessions, review decisions, summaries, exports, and destructive actions.
- `packages/import-core`: pure import engine for CSV/XLS/XLSX parsing, column inference, mapping application, row validation, normalization, and import-plan generation.
- `packages/finance-core`: pure financial meaning layer for categorization, duplicate candidates, transfer candidates, recurring detection, coverage, savings/investment/expense metrics, and dashboard summaries.
- `packages/shared`: shared TypeScript types, validation schemas, category constants, country defaults, and money/date helpers.

The API persists data and orchestrates workflows. The core packages avoid direct database or UI dependencies so they can be tested with fixtures and reused later for PDF, broker, mutual fund, or regulated-sync ingestion.

## Local Vault

SQLite is the source of truth. The alpha stores the vault in a local app data directory such as `.artha/vault.sqlite` during development. Production packaging can move this to an OS-appropriate application support directory.

Core tables:

- `vault_profile`: country, base currency, fiscal-year start month, timezone, date format, number format, and compliance pack.
- `accounts`: bank accounts, credit cards, wallets, investment accounts, loans, manual assets, and manual liabilities.
- `import_batches`: source filename, source type, account association, detected period, status, confidence, parser version, row counts, and undo state.
- `raw_import_rows`: original parsed row payload, row number, diagnostics, and import batch reference.
- `transactions`: canonical ledger rows with account, date, value date, description, reference, signed amount, direction, balance, category, confidence, source batch, duplicate status, transfer group, and review status.
- `rules`: user-visible column mapping and category rules, with match pattern, scope, priority, enabled state, and audit metadata.
- `review_items`: unresolved and resolved review tasks for uncertain categories, duplicates, transfers, recurring payments, unusual expenses, import issues, and missing periods.
- `net_worth_snapshots`: dated asset/liability values marked manual, imported, or estimated.
- `audit_events`: import commits, mapping changes, category corrections, review resolutions, undo operations, exports, deletions, and profile changes.

Every dashboard number must be traceable to transactions, accounts, snapshots, and import batches.

## Main Workflows

### Historical Backfill

1. User creates a vault with India defaults: INR, India, April-March financial year, Asia/Kolkata timezone, India compliance guardrails.
2. User creates or selects an account.
3. User uploads CSV/XLS/XLSX against an existing account, new account, or unknown account.
4. API creates an import session and calls `import-core`.
5. `import-core` previews rows, infers columns, detects date range, validates amounts, and returns an import plan.
6. UI shows sample rows, detected period, column mapping, confidence, parse issues, and possible opening/closing balance.
7. User confirms or adjusts mappings.
8. API commits the import plan into SQLite as one `import_batch`, raw rows, transactions, review items, and audit events.
9. `finance-core` computes category suggestions, duplicate candidates, transfer candidates, coverage, and summaries.
10. User resolves review items in grouped batches.
11. Dashboards update immediately and show missing-data warnings.

### Monthly Update

1. UI shows each account’s data-updated-through month and missing expected periods.
2. User imports the latest statement.
3. The remembered mapping is applied when compatible.
4. Overlaps and duplicates are detected before commit.
5. Only uncertain rows become review items.
6. Monthly dashboard, coverage, recurring payments, and lifetime metrics update.

## Import Core

`import-core` produces an `ImportPlan`, not database writes.

Responsibilities:

- Parse CSV, XLS, and XLSX files into normalized row objects.
- Infer header row and data range.
- Infer or apply column mappings for transaction date, value date, description, debit, credit, signed amount, balance, reference, and optional category.
- Support user-specified date and number formats while defaulting to India-friendly parsing.
- Validate dates, amounts, direction, required fields, duplicate row fingerprints, and balance continuity when balance exists.
- Preserve original row values and diagnostics.
- Generate stable transaction fingerprints from account, date, amount, normalized description, reference, and source row signals.
- Return confidence scores and actionable issues without silently dropping rows.

The alpha supports generic tabular imports before bank-specific templates. Mapping rules are remembered by source fingerprint and account/source type.

## Finance Core

`finance-core` operates on canonical transactions and snapshots.

Responsibilities:

- Categorize transactions into the initial category set: Income, Essentials, Food & Dining, Groceries, Travel, Shopping, Subscriptions, Healthcare, Family, Education, Insurance, Loans/EMI, Investments, Transfers, Cash, Fees & Charges, Uncategorized.
- Keep confidence conservative and send low-confidence rows to review.
- Apply user-visible rules before built-in heuristics.
- Detect duplicates within the same import, overlapping imports, and cross-source appearances.
- Detect likely transfers including bank-to-bank movement, credit card payments, wallet loads, broker funding, SIPs/investment transfers, cash withdrawals/deposits, refunds, reversals, and loan disbursements.
- Exclude confirmed transfers from expense totals.
- Avoid double-counting credit card payments when card purchases are imported.
- Calculate monthly, quarterly, yearly, and lifetime summaries.
- Calculate savings rate, investment rate, wealth retention ratio, recurring payments, category trends, and coverage confidence.
- Flag missing data and incomplete periods wherever summaries are shown.

## Review Inbox

Review items are grouped by decision type and impact:

- Unknown or low-confidence category.
- Possible duplicate.
- Possible transfer.
- Possible credit card payment.
- Possible investment transfer.
- Possible recurring payment.
- Unusual expense.
- Missing account period.
- Import issue.
- Manual snapshot refresh.

Users can resolve, skip, bulk-apply, or reverse decisions. Resolutions write audit events and update affected transactions/summaries immediately.

## Dashboards

The alpha includes:

- Lifetime dashboard: total earned, spent, invested, transfers, savings, current net worth, estimated wealth retained, unclassified amount, data coverage, largest categories, and missing-data impact.
- Monthly dashboard: income, expenses, investments, transfers, savings, savings rate, top categories, recurring payments, unusual transactions, missing imports, and review count.
- Yearly dashboard: yearly income, yearly expenses, yearly savings rate, investments, category trends, lifestyle inflation, and net-worth movement.
- Coverage map: account/month/year coverage, complete versus partial months, missing periods, source type, and confidence.
- Net worth: manual/imported/estimated asset and liability snapshots over time.

Every metric links back to the contributing accounts, periods, import batches, and transactions.

## Privacy, Security, and Compliance Guardrails

Alpha privacy rules:

- Local-first by default.
- No bank sync.
- No Account Aggregator.
- No net banking, broker, card, UPI, Aadhaar, PAN portal, email, OTP, PIN, or password collection.
- No hidden network transfer.
- No cloud AI by default.
- No financial values in telemetry.
- Data export and deletion available from the UI.
- Sensitive logs are scrubbed.

The UI should clearly state that the app is a personal data-management and analytics tool, not a tax filing app, investment adviser, broker, lender, or insurance adviser. India-specific compliance guardrails live in a profile/compliance pack rather than global core logic.

## API Surface

Initial endpoints:

- `GET /health`
- `POST /vault`
- `GET /vault`
- `DELETE /vault`
- `GET /accounts`
- `POST /accounts`
- `PATCH /accounts/:id`
- `POST /imports/preview`
- `POST /imports/:sessionId/mapping`
- `POST /imports/:sessionId/commit`
- `POST /imports/:batchId/undo`
- `GET /transactions`
- `GET /review-items`
- `POST /review-items/:id/resolve`
- `POST /review-items/bulk-resolve`
- `GET /coverage`
- `GET /summaries/lifetime`
- `GET /summaries/monthly`
- `GET /summaries/yearly`
- `GET /net-worth`
- `POST /net-worth/snapshots`
- `GET /export`

Use runtime validation for request and response bodies through shared schemas.

## UI Structure

Primary navigation:

- Overview
- Import
- Transactions
- Review
- Coverage
- Net Worth
- Settings

The first screen after vault creation should be the actual app workspace, not a marketing landing page. Empty states should guide the next import action without requiring full account setup or net-worth setup first.

## Error Handling

Imports are staged before commit. Failed imports must not corrupt existing data. The user can cancel, remap, save as draft, or commit. A committed batch can be undone, which marks its transactions/review items inactive while keeping audit history.

Validation errors should identify the affected column, row, and reason. The app must never silently ignore rows.

## Testing Strategy

Use TDD for implementation.

Core tests:

- Import parser fixtures for CSV and XLSX.
- Column mapping inference and user mapping override.
- Amount direction handling for debit/credit and signed amount formats.
- Duplicate fingerprinting across overlapping imports.
- Transfer candidate detection for bank transfer and credit card payment examples.
- Category rule application and low-confidence review creation.
- Coverage completeness and partial-month detection.
- Lifetime/monthly summaries excluding confirmed transfers and duplicates.
- Net-worth snapshot rollups.

API tests cover commit/undo/export/delete behavior against temporary SQLite vaults. UI tests cover the import preview/mapping flow, review resolution, and dashboard traceability using seeded data.

## Deferred Work

Deferred beyond alpha:

- Bank sync and Account Aggregator.
- Direct bank login, OTP, screen scraping, or credential capture.
- PDF, scanned PDF, screenshots, email attachments, ZIP uploads.
- Tax filing, tax advice, Form 16/AIS/TIS/Form 26AS workflows.
- Investment, insurance, loan, or product recommendations.
- Automated trading or money movement.
- Cloud backup, cloud AI, account sharing, and multi-device sync.

## Open Decisions Resolved

- Scope: alpha vertical slice.
- App model: local web app with SQLite backend.
- Architecture: import worker core separated into `packages/import-core`, with financial meaning in `packages/finance-core`.
- Defaults: India-first but globally extensible.
- Storage: local SQLite vault.
- First ingestion target: reliable tabular imports, not universal PDF support.
