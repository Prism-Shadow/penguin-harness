/**
 * The plugin on the real server: installed through a Project's config, loaded by the real
 * loader, its requirements resolved from the tree (the organization gateway included), its
 * page contributed to the web slots, the Action registry's slot declared by the plugin and filled
 * by its proposals module, and its routes mounted behind the cookie gate —
 * answering 404 while company mode is off, and 404 for an organization that does not exist
 * once it is on — and its settings group, declared on the Plugins page. Creating an organization needs a model to run its CEO, so the lifecycle
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
import { DEFAULT_TEST_GROUPS } from "../src/config.js";
import { fetchProbe } from "../src/deployments.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "/api/projects/default_project/organizations/acme/proposals";
/** The Action routes: every write, the Activity. */
const ACTIONS = "/api/projects/default_project/organizations/acme/actions";

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
    (e: HarnessApiError) => ({
      status: e.status,
      code: (e.body as { error?: { code?: string } } | null)?.error?.code,
    }),
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

  it("is loaded — the proposals module and the Action registry, whose slot the proposals module fills — and contributes the proposals page as a company-mode page", async () => {
    const [row] = await harness.installedPlugins();
    expect(row).toMatchObject({
      active: true,
      modules: ["CompanyProposalsPlugin", "CompanyActionRegistry", "ProposalsRetirement"],
      replaces: [],
    });
    const { pages } = await api.get<Contributions>("/api/contributions");
    expect(pages.find((p) => p.id === "company-proposals.page")).toMatchObject({
      key: "org-proposals",
      path: "proposals/:number?",
      nav: "org",
      renderer: { builtin: "OrgProposalsPage" },
    });
  });

  it("reads a real server's identity and commit over its public /api/install, as the registry does for a server deployment", async () => {
    const identity = await fetchProbe()(harness.baseUrl);
    const version = await api.get<{ commit: string | null; describe: string }>("/api/version");
    expect(identity.installId).toMatch(/\S/);
    // A source build run from a checkout knows its commit; the registry reads the same one.
    expect(identity.commit).toBe(version.commit);
    expect(identity.describe).toBe(version.describe);
    await expect(fetchProbe()(`${harness.baseUrl}/nothing-here`)).rejects.toThrow();
  });

  it("declares its settings group on the Plugins page: the default test groups, and a line that is not `id: description` refused", async () => {
    const read = await api.get<{
      plugins: Array<{ name: string; values: Record<string, unknown> }>;
    }>("/api/admin/plugin-config");
    const entry = read.plugins.find((p) => p.name === "company-proposals");
    expect(entry?.values.testGroups).toEqual([...DEFAULT_TEST_GROUPS]);
    const bad = await status(
      api.put("/api/admin/plugin-config", {
        name: "company-proposals",
        values: { testGroups: ["unit: one module", "Perf"] },
      }),
    );
    expect(bad.status).toBe(400);
    await api.put("/api/admin/plugin-config", {
      name: "company-proposals",
      values: { testGroups: ["e2e: the product end to end", "unit: one module"] },
    });
    const saved = await api.get<{
      plugins: Array<{ name: string; values: Record<string, unknown> }>;
    }>("/api/admin/plugin-config");
    expect(saved.plugins.find((p) => p.name === "company-proposals")?.values.testGroups).toEqual([
      "e2e: the product end to end",
      "unit: one module",
    ]);
  });

  it("answers 404 while company mode is off, and 404 for a missing organization once it is on", async () => {
    const create = () =>
      status(
        api.post(`${ACTIONS}/proposal.create/runs`, {
          subject: "organization",
          params: { author: "x", brief: "y" },
        }),
      );
    expect((await status(api.get(BASE))).status).toBe(404);
    expect((await create()).status).toBe(404);
    expect((await status(api.get(ACTIONS))).status).toBe(404);
    await api.put("/api/admin/settings", { companyMode: true });
    const missing = await status(api.get(BASE));
    expect(missing.status).toBe(404);
    expect((await create()).status).toBe(404);
    expect(await status(api.get(ACTIONS))).toEqual({ status: 404, code: "org_not_found" });
    expect((await status(api.get(`${ACTIONS}/runs`))).status).toBe(404);
  });
});
