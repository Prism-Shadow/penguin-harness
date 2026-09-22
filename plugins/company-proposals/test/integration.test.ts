/**
 * The plugin on the real server: installed through a Project's config, loaded by the real
 * loader, its requirements resolved from the tree (the organization gateway included), its
 * page contributed to the web slots, and its routes mounted behind the cookie gate —
 * answering 404 while company mode is off, and 404 for an organization that does not exist
 * once it is on. Creating an organization needs a model to run its CEO, so the lifecycle
 * itself is exercised in service.test.ts over the gateway fake.
 *
 * Needs the server and this package built (see README).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultServerEntry,
  startHarness,
  type Harness,
  type HarnessApi,
  type HarnessApiError,
} from "@prismshadow/penguin-plugin-test";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "/api/projects/default_project/organizations/acme/proposals";

interface Contributions {
  pages: Array<{
    id: string;
    key: string;
    path: string;
    nav: string;
    renderer: { builtin?: string };
  }>;
}

async function status(run: Promise<unknown>): Promise<{ status: number; code?: string }> {
  return run.then(
    () => ({ status: 200 }),
    (e: HarnessApiError) => ({ status: e.status, code: (e as { code?: string }).code }),
  );
}

describe("the company-proposals plugin on a real server", () => {
  let harness: Harness;
  let api: HarnessApi;

  beforeAll(async () => {
    await fs.access(defaultServerEntry());
    harness = await startHarness({ plugins: [PLUGIN_DIR] });
    api = await harness.login();
  }, 90_000);
  afterAll(async () => {
    await harness?.stop();
  });

  it("is loaded, and contributes the proposals page as a company-mode page", async () => {
    const [row] = await harness.installedPlugins();
    expect(row).toMatchObject({ active: true, modules: ["CompanyProposalsPlugin"], replaces: [] });
    const { pages } = await api.get<Contributions>("/api/contributions");
    expect(pages.find((p) => p.id === "company-proposals.page")).toMatchObject({
      key: "org-proposals",
      path: "proposals/:number?",
      nav: "org",
      renderer: { builtin: "OrgProposalsPage" },
    });
  });

  it("answers 404 while company mode is off, and 404 for a missing organization once it is on", async () => {
    expect((await status(api.get(BASE))).status).toBe(404);
    await api.put("/api/admin/settings", { companyMode: true });
    const missing = await status(api.get(BASE));
    expect(missing.status).toBe(404);
    expect((await status(api.post(`${BASE}`, { author: "x", brief: "y" }))).status).toBe(404);
  });
});
