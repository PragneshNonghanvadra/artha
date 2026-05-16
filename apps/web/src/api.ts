import type { ImportPlan, ColumnMapping } from "../../../packages/import-core/src";
import type {
  Account,
  CoverageResult,
  LifetimeSummary,
  NetWorthSnapshot,
  PeriodSummary,
  ReviewItem,
  Transaction,
  VaultProfile,
} from "../../../packages/shared/src";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:5173";

export interface VaultResponse {
  profile: VaultProfile;
  createdAt: string;
  updatedAt: string;
}

export interface PreviewResponse {
  sessionId: string;
  plan: ImportPlan;
}

export interface CommitResponse {
  batch: {
    id: string;
    filename: string;
    rowCount: number;
    confidence: number;
  };
  transactions: Transaction[];
  reviewItems: ReviewItem[];
}

export interface ExportPayload {
  profile: VaultProfile | null;
  accounts: Account[];
  transactions: Transaction[];
  reviewItems: ReviewItem[];
  netWorthSnapshots: NetWorthSnapshot[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed: ${response.status}`);
  }
  return data as T;
}

export const api = {
  health: () => request<{ ok: boolean }>("/health"),
  getVault: () => request<VaultResponse | null>("/vault"),
  createVault: () => request<VaultResponse>("/vault", { method: "POST" }),
  deleteVault: () => request<{ ok: boolean }>("/vault", { method: "DELETE" }),
  listAccounts: () => request<Account[]>("/accounts"),
  createAccount: (body: Partial<Account>) => request<Account>("/accounts", { method: "POST", body: JSON.stringify(body) }),
  previewImport: (accountId: string, file: File) => {
    const body = new FormData();
    body.set("accountId", accountId);
    body.set("file", file);
    return request<PreviewResponse>("/imports/preview", { method: "POST", body });
  },
  remapImport: (sessionId: string, mapping: ColumnMapping) =>
    request<PreviewResponse>(`/imports/${sessionId}/mapping`, {
      method: "POST",
      body: JSON.stringify({ mapping }),
    }),
  commitImport: (sessionId: string) => request<CommitResponse>(`/imports/${sessionId}/commit`, { method: "POST" }),
  undoImport: (batchId: string) => request<{ ok: boolean }>(`/imports/${batchId}/undo`, { method: "POST" }),
  listTransactions: () => request<Transaction[]>("/transactions"),
  listReviewItems: () => request<ReviewItem[]>("/review-items"),
  resolveReviewItem: (id: string, body: { status: "resolved" | "skipped"; category?: string }) =>
    request<ReviewItem>(`/review-items/${id}/resolve`, { method: "POST", body: JSON.stringify(body) }),
  getCoverage: () => request<CoverageResult>("/coverage"),
  getLifetimeSummary: () => request<LifetimeSummary>("/summaries/lifetime"),
  getMonthlySummary: (month: string) => request<PeriodSummary>(`/summaries/monthly?month=${month}`),
  getYearlySummary: (year: string) => request<PeriodSummary>(`/summaries/yearly?year=${year}`),
  listNetWorth: () => request<NetWorthSnapshot[]>("/net-worth"),
  addSnapshot: (body: Omit<NetWorthSnapshot, "id" | "createdAt">) =>
    request<NetWorthSnapshot>("/net-worth/snapshots", { method: "POST", body: JSON.stringify(body) }),
  exportData: () => request<ExportPayload>("/export"),
};
