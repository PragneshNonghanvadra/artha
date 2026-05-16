import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      country TEXT NOT NULL,
      base_currency TEXT NOT NULL,
      fiscal_year_start_month INTEGER NOT NULL,
      timezone TEXT NOT NULL,
      date_format TEXT NOT NULL,
      number_format TEXT NOT NULL,
      compliance_pack TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      institution TEXT,
      currency TEXT NOT NULL,
      opening_month TEXT,
      expected_monthly INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      filename TEXT NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL,
      detected_start_date TEXT,
      detected_end_date TEXT,
      confidence REAL NOT NULL,
      row_count INTEGER NOT NULL,
      committed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_import_rows (
      id TEXT PRIMARY KEY,
      import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
      row_number INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      import_batch_id TEXT REFERENCES import_batches(id),
      transaction_date TEXT NOT NULL,
      value_date TEXT,
      description TEXT NOT NULL,
      normalized_description TEXT NOT NULL,
      reference TEXT,
      amount REAL NOT NULL,
      direction TEXT NOT NULL,
      balance REAL,
      currency TEXT NOT NULL,
      category TEXT NOT NULL,
      category_confidence REAL NOT NULL,
      status TEXT NOT NULL,
      transfer_group_id TEXT,
      source_row_id TEXT REFERENCES raw_import_rows(id),
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_rules (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      account_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      impact_amount REAL,
      account_id TEXT,
      transaction_id TEXT,
      related_transaction_id TEXT,
      import_batch_id TEXT,
      suggested_action TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS net_worth_snapshots (
      id TEXT PRIMARY KEY,
      snapshot_date TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      value REAL NOT NULL,
      currency TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
