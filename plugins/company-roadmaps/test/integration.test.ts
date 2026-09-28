/**
 * The plugin on the real server: installed through a Project's config, loaded by the real
 * loader, and its requirements — the organization gateway (CompanyModule) and the session
 * runtime (SessionRuntimeModule), which is what lets it clone a desk for a room and feed it —
 * resolved from the real module tree, and its channel claim contributed to the organization
 * module by a node of its own (the tree refuses a node that contributes there while requiring
 * the gateway: a cycle); its settings group declared on the Plugins page; its
 * routes mounted behind the cookie gate, answering 404 while company mode is off and for an
 * organization that does not exist once it is on. Creating an organization needs a model to
 * run its CEO, so the lifecycle itself is exercised in service.test.ts over the fakes.
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
import { CONFIG_GROUP, DEFAULT_POLL_SECONDS, DEFAULT_RELAY_DEPTH } from "../src/config.js";
import { PAGE_SRC } from "../src/page.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "/api/projects/default_project/organizations/acme/roadmaps";

async function status(run: Promise<unknown>): Promise<number> {
  return run.then(
    () => 200,
    (e: HarnessApiError) => e.status,
  );
}

describe("the company-roadmaps plugin on a real server", () => {
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

  it("is loaded, both nodes: the gateway and the session runtime resolved, and the claim taken by the organization module without a cycle", async () => {
    const [row] = await harness.installedPlugins();
    expect(row).toMatchObject({
      active: true,
      modules: ["CompanyRoadmapsPlugin", "RoadmapRoomClaim"],
      replaces: [],
    });
  });

  it("contributes the roadmaps page as a company-mode iframe page, and serves it behind the cookie gate", async () => {
    const { pages } = await api.get<{ pages: Array<Record<string, unknown>> }>(
      "/api/contributions",
    );
    expect(pages.find((p) => p.key === "roadmaps")).toMatchObject({
      nav: "org",
      path: "roadmaps/:number?",
      renderer: { iframe: { src: PAGE_SRC } },
    });
    const res = await api.request("GET", PAGE_SRC);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await res.text()).toContain('<main id="main"><h1>Roadmaps</h1>');
    const anonymous = await fetch(`${harness.baseUrl}${PAGE_SRC}`);
    expect(anonymous.status).toBe(401);
  });

  it("declares its settings group on the Plugins page", async () => {
    const read = await api.get<{
      plugins: Array<{ name: string; values: Record<string, unknown> }>;
    }>("/api/admin/plugin-config");
    expect(read.plugins.find((p) => p.name === CONFIG_GROUP)?.values).toMatchObject({
      relayDepth: DEFAULT_RELAY_DEPTH,
      pollSeconds: DEFAULT_POLL_SECONDS,
    });
  });

  it("answers 404 while company mode is off, and 404 for a missing organization once it is on", async () => {
    expect(await status(api.get(BASE))).toBe(404);
    await api.put("/api/admin/settings", { companyMode: true });
    expect(await status(api.get(BASE))).toBe(404);
    expect(await status(api.post(BASE, { name: "x", channelId: "room_a", employees: ["a"] }))).toBe(
      404,
    );
  });
});
