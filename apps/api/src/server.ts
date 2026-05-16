import { buildImportPlan, ColumnMapping, ParsedImportFile, parseImportFile } from "../../../packages/import-core/src";
import { errorResponse, jsonResponse, makeId, type VaultProfile } from "../../../packages/shared/src";
import { createRepository, FinanceRepository, type CreateSnapshotInput, type ResolveReviewDecision } from "./repository";

interface ImportSession {
  id: string;
  parsed: ParsedImportFile;
  accountId: string;
  currency: string;
  plan: ReturnType<typeof buildImportPlan>;
}

const DEFAULT_PORT = 5173;

export function createApp(repository: FinanceRepository = createRepository()): (request: Request) => Promise<Response> {
  const sessions = new Map<string, ImportSession>();

  return async function handle(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return jsonResponse({ ok: true });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, "") || "/";
      const segments = path.split("/").filter(Boolean);

      if (request.method === "GET" && path === "/health") {
        return jsonResponse({ ok: true });
      }

      if (path === "/vault" && request.method === "POST") {
        const profile = await optionalJson(request);
        repository.initializeVault(profile && Object.keys(profile).length ? (profile as VaultProfile) : undefined);
        return jsonResponse(repository.getVault());
      }

      if (path === "/vault" && request.method === "GET") {
        return jsonResponse(repository.getVault());
      }

      if (path === "/vault" && request.method === "DELETE") {
        repository.deleteVault();
        return jsonResponse({ ok: true });
      }

      if (path === "/accounts" && request.method === "GET") {
        return jsonResponse(repository.listAccounts());
      }

      if (path === "/accounts" && request.method === "POST") {
        const body = await requireJson(request);
        return jsonResponse(
          repository.createAccount({
            name: String(body.name ?? "Untitled account"),
            type: body.type ?? "bank",
            institution: body.institution,
            currency: body.currency,
            openingMonth: body.openingMonth,
            expectedMonthly: body.expectedMonthly,
          }),
        );
      }

      if (segments[0] === "accounts" && segments[1] && request.method === "PATCH") {
        return errorResponse("Account editing is not implemented in the alpha API yet.", 501);
      }

      if (path === "/imports/preview" && request.method === "POST") {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return errorResponse("A statement file is required.", 400);
        }

        const accountId = String(form.get("accountId") ?? "");
        if (!accountId) {
          return errorResponse("accountId is required for alpha imports.", 400);
        }

        const sourceType = sourceTypeFromFilename(file.name);
        const parsed = parseImportFile({
          filename: file.name,
          sourceType,
          data: await file.arrayBuffer(),
        });
        const account = repository.listAccounts().find((candidate) => candidate.id === accountId);
        const currency = account?.currency ?? "INR";
        const plan = buildImportPlan(parsed, { accountId, currency });
        const session: ImportSession = {
          id: makeId("session"),
          parsed,
          accountId,
          currency,
          plan,
        };
        sessions.set(session.id, session);
        return jsonResponse({ sessionId: session.id, plan });
      }

      if (segments[0] === "imports" && segments[1] && segments[2] === "mapping" && request.method === "POST") {
        const session = sessions.get(segments[1]);
        if (!session) {
          return errorResponse("Import session not found.", 404);
        }
        const body = await requireJson(request);
        const mapping = body.mapping as ColumnMapping;
        session.plan = buildImportPlan(session.parsed, {
          accountId: session.accountId,
          currency: session.currency,
          mapping,
        });
        sessions.set(session.id, session);
        return jsonResponse({ sessionId: session.id, plan: session.plan });
      }

      if (segments[0] === "imports" && segments[1] && segments[2] === "commit" && request.method === "POST") {
        const session = sessions.get(segments[1]);
        if (!session) {
          return errorResponse("Import session not found.", 404);
        }
        const commit = repository.commitImportPlan(session.plan);
        sessions.delete(session.id);
        return jsonResponse(commit);
      }

      if (segments[0] === "imports" && segments[1] && segments[2] === "undo" && request.method === "POST") {
        repository.undoImportBatch(segments[1]);
        return jsonResponse({ ok: true });
      }

      if (path === "/transactions" && request.method === "GET") {
        return jsonResponse(repository.listTransactions());
      }

      if (path === "/review-items" && request.method === "GET") {
        return jsonResponse(repository.listReviewItems());
      }

      if (segments[0] === "review-items" && segments[1] && segments[2] === "resolve" && request.method === "POST") {
        return jsonResponse(repository.resolveReviewItem(segments[1], (await requireJson(request)) as ResolveReviewDecision));
      }

      if (path === "/review-items/bulk-resolve" && request.method === "POST") {
        const body = await requireJson(request);
        const ids = Array.isArray(body.ids) ? body.ids : [];
        const decision = body.decision ?? { status: "resolved" };
        return jsonResponse(ids.map((id) => repository.resolveReviewItem(String(id), decision)));
      }

      if (path === "/coverage" && request.method === "GET") {
        return jsonResponse(repository.calculateCoverage());
      }

      if (path === "/summaries/lifetime" && request.method === "GET") {
        return jsonResponse(repository.calculateLifetimeSummary());
      }

      if (path === "/summaries/monthly" && request.method === "GET") {
        return jsonResponse(repository.calculateMonthlySummary(url.searchParams.get("month") ?? currentMonth()));
      }

      if (path === "/summaries/yearly" && request.method === "GET") {
        return jsonResponse(repository.calculateYearlySummary(url.searchParams.get("year") ?? new Date().getFullYear()));
      }

      if (path === "/net-worth" && request.method === "GET") {
        return jsonResponse(repository.listNetWorthSnapshots());
      }

      if (path === "/net-worth/snapshots" && request.method === "POST") {
        return jsonResponse(repository.addNetWorthSnapshot((await requireJson(request)) as CreateSnapshotInput));
      }

      if (path === "/export" && request.method === "GET") {
        return jsonResponse(repository.exportData());
      }

      return errorResponse(`No route for ${request.method} ${path}`, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown API error";
      return errorResponse(message, 500);
    }
  };
}

async function optionalJson(request: Request): Promise<Record<string, any> | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }
  const text = await request.text();
  return text ? JSON.parse(text) : null;
}

async function requireJson(request: Request): Promise<Record<string, any>> {
  const body = await optionalJson(request);
  return body ?? {};
}

function sourceTypeFromFilename(filename: string): "csv" | "xls" | "xlsx" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    return "xlsx";
  }
  if (lower.endsWith(".xls")) {
    return "xls";
  }
  return "csv";
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

if (import.meta.main) {
  const repository = createRepository();
  const app = createApp(repository);
  Bun.serve({
    port: DEFAULT_PORT,
    hostname: "127.0.0.1",
    fetch: app,
  });
  console.info(`Artha local API listening on http://127.0.0.1:${DEFAULT_PORT}`);
}
