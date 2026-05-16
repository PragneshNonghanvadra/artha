import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepository, type FinanceRepository } from "./repository";
import { createApp } from "./server";

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

function testApp() {
  const dir = mkdtempSync(join(tmpdir(), "artha-api-test-"));
  cleanupPaths.push(dir);
  const repo = createRepository(join(dir, "vault.sqlite"));
  openRepos.push(repo);
  return createApp(repo);
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, any>>;
}

describe("local API server", () => {
  test("responds to health and initializes a vault", async () => {
    const app = testApp();

    expect(await json(await app(new Request("http://local/health")))).toEqual({ ok: true });
    expect((await app(new Request("http://local/vault", { method: "POST" }))).status).toBe(200);

    const vault = await json(await app(new Request("http://local/vault")));
    expect(vault.profile).toMatchObject({ country: "IN", baseCurrency: "INR" });
  });

  test("previews, maps, commits, and summarizes an imported CSV", async () => {
    const app = testApp();
    await app(new Request("http://local/vault", { method: "POST" }));
    const accountResponse = await app(
      new Request("http://local/accounts", {
        method: "POST",
        body: JSON.stringify({ name: "HDFC Salary", type: "bank", openingMonth: "2026-05" }),
        headers: { "content-type": "application/json" },
      }),
    );
    const account = await json(accountResponse);

    const body = new FormData();
    body.set("accountId", account.id);
    body.set(
      "file",
      new File(
        [
          `Date,Narration,Debit,Credit,Balance
01/05/2026,SALARY ACME,,120000,120000
02/05/2026,UPI MYSTERY STORE,999,,119001`,
        ],
        "hdfc.csv",
        { type: "text/csv" },
      ),
    );

    const preview = await json(
      await app(
        new Request("http://local/imports/preview", {
          method: "POST",
          body,
        }),
      ),
    );

    expect(typeof preview.sessionId).toBe("string");
    expect(preview.plan.transactions).toHaveLength(2);

    const commit = await json(
      await app(
        new Request(`http://local/imports/${preview.sessionId}/commit`, {
          method: "POST",
        }),
      ),
    );

    expect(commit.batch.rowCount).toBe(2);
    expect(await json(await app(new Request("http://local/summaries/lifetime")))).toMatchObject({
      income: 120000,
      unclassified: 999,
    });
  });
});
