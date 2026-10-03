/**
 * The routes over the service: the reads at `…/roadmaps`, every write a roadmap Action run
 * through company-proposals' registry at `…/actions/<key>/runs` — the refusals and their codes,
 * the Session claim honoured only behind the local API token — and the generated manifest
 * agreeing with the code.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import plugin, {
  CLAIM_ID,
  CONFIG_GROUP,
  CompanyRoadmapsPlugin,
  DEFAULT_POLL_SECONDS,
  DEFAULT_RELAY_DEPTH,
  ROUTES_ID,
  RoadmapRoomClaim,
  RoadmapsRetirement,
  RETIRE_ID,
  configOf,
  roadmapRoutes,
} from "../src/index.js";
import { asAgent, world, writeChannel, type World } from "./fakes.js";
import { actionApp, codeOf, type ActionApp } from "./action-harness.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "/p/proj/o/acme/roadmaps";

let w: World;
let a: ActionApp;

beforeEach(async () => {
  w = await world();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
  a = actionApp({ gateway: w.gateway, root: w.root, service: w.service() });
});

const open = { name: "Queue", channelId: "room_a", employees: ["acme_dev", "acme_web"] };
const result = (r: { body: Record<string, unknown> }) =>
  r.body.result as { roadmap: Record<string, unknown> & { number: number }; hints: string[] };

describe("the routes", () => {
  it("answer 404 while company mode is off", async () => {
    w.gateway.enabled = false;
    expect((await a.get(BASE)).status).toBe(404);
    expect((await a.run("roadmap.open", "organization", open)).status).toBe(404);
  });

  it("open a roadmap for a person, and for an employee speaking from its session", async () => {
    const made = await a.run("roadmap.open", "organization", open);
    expect(made.status).toBe(200);
    expect(result(made).roadmap.number).toBe(1);
    const byEmployee = await a.run("roadmap.open", "organization", open, asAgent("acme_dev"));
    expect(byEmployee.status).toBe(200);
    expect(result(byEmployee).roadmap).toMatchObject({ number: 2, createdBy: "agent:acme_dev" });
  });

  it("drop a Session claim that only a cookie backs: the write is the person's", async () => {
    await a.run("roadmap.open", "organization", open);
    const claim = { sessionId: "desk-acme_web", agentId: "acme_web" };
    // Behind a cookie the claim is dropped: the rename is the person's.
    const res = await a.app.request("/p/proj/o/acme/actions/roadmap.rename/runs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-via": "password" },
      body: JSON.stringify({ subject: "roadmap:1", params: { name: "Renamed" }, ...claim }),
    });
    expect(res.status).toBe(200);
    // Behind the token the claim is honoured: the employee's rename is recorded as its own.
    const claimed = await a.run(
      "roadmap.rename",
      "roadmap:1",
      { name: "Again" },
      asAgent("acme_web"),
    );
    expect(claimed.status).toBe(200);
    const events = result(claimed).roadmap.events as Array<{ kind: string; by: string }>;
    expect(events.filter((e) => e.kind === "renamed").map((e) => e.by)).toEqual([
      "user:boss",
      "agent:acme_web",
    ]);
  });

  it("refuse a subject or params that do not fit, a missing roadmap, and a draft item that is not well formed", async () => {
    expect((await a.run("roadmap.open", "roadmap:1", open)).status).toBe(400);
    const missingParam = await a.run("roadmap.open", "organization", { name: "Q" });
    expect([missingParam.status, codeOf(missingParam)]).toEqual([400, "bad_params"]);
    expect((await a.get(`${BASE}/7`)).status).toBe(404);
    expect((await a.get(`${BASE}/x`)).status).toBe(404);
    expect((await a.run("roadmap.draft", "roadmap:7", { record: "x" })).status).toBe(404);
    await a.run("roadmap.open", "organization", open);
    const bad = await a.run("roadmap.draft", "roadmap:1", {
      items: [
        { key: "a", kind: "proposal", title: "T", brief: "B", owner: "nobody", cites: ["Why"] },
      ],
    });
    expect([bad.status, codeOf(bad)]).toEqual([400, "bad_request"]);
  });

  it("refuse to establish over a cite the body does not have (400 cite_unknown)", async () => {
    await a.run("roadmap.open", "organization", open);
    await a.run("roadmap.draft", "roadmap:1", {
      body: "## Why\n",
      items: [
        { key: "a", kind: "proposal", title: "T", brief: "B", owner: "acme_dev", cites: ["How"] },
      ],
    });
    const refused = await a.run("roadmap.establish", "roadmap:1");
    expect([refused.status, codeOf(refused)]).toEqual([400, "cite_unknown"]);
  });

  it("have no write routes of their own: writes are Actions", async () => {
    await a.run("roadmap.open", "organization", open);
    for (const [method, url] of [
      ["POST", BASE],
      ["PATCH", `${BASE}/1`],
      ["PUT", `${BASE}/1/draft`],
      ["POST", `${BASE}/1/establish`],
      ["POST", `${BASE}/1/archive`],
    ] as const) {
      const res = await a.app.request(url, {
        method,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);
    }
    const one = await a.get(`${BASE}/1`);
    expect(one.body.status).toBe("discussing");
    expect(one.body).not.toHaveProperty("archived");
  });

  it("list a room's roadmaps, and filter by status", async () => {
    await a.run("roadmap.open", "organization", open);
    const listed = await a.get(`${BASE}?channel=room_a&status=discussing`);
    expect((listed.body.roadmaps as unknown[]).length).toBe(1);
    expect(((await a.get(`${BASE}?channel=room_b`)).body.roadmaps as unknown[]).length).toBe(0);
    expect(((await a.get(`${BASE}?status=established`)).body.roadmaps as unknown[]).length).toBe(0);
  });

  it("are read routes alone", () => {
    const routes = roadmapRoutes(w.service()).routes.map((r) => `${r.method} ${r.path}`);
    expect(routes.filter((r) => !r.startsWith("GET "))).toEqual([]);
  });
});

describe("the manifest", () => {
  const table = () =>
    JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<string, { contributes: Record<string, unknown[]> }>;
      plugin: { modules: string[] };
    };

  it("names the three modules, their contributions, and what each requires of the harness", () => {
    expect(plugin.modules).toEqual([CompanyRoadmapsPlugin, RoadmapRoomClaim, RoadmapsRetirement]);
    const t = table();
    expect(t.plugin.modules).toEqual([
      "CompanyRoadmapsPlugin",
      "RoadmapRoomClaim",
      "RoadmapsRetirement",
    ]);
    const retirement = t.modules.RoadmapsRetirement;
    expect(
      (retirement?.contributes["OrganizationModule.retirements"]?.[0] as { id: string }).id,
    ).toBe(RETIRE_ID);
    expect(JSON.stringify(retirement)).not.toContain("CompanyModule");
    const claim = t.modules.RoadmapRoomClaim;
    expect((claim?.contributes["OrganizationModule.channelClaims"]?.[0] as { id: string }).id).toBe(
      CLAIM_ID,
    );
    // The claim node must not require what the organization module provides: that is a cycle.
    expect(JSON.stringify(claim)).not.toContain("CompanyModule");
    const manifest = t.modules.CompanyRoadmapsPlugin;
    expect((manifest?.contributes["HttpModule.routes"]?.[0] as { id: string }).id).toBe(ROUTES_ID);
    const text = JSON.stringify(manifest);
    for (const from of [
      "CompanyModule",
      "SessionRuntimeModule",
      "RuntimeModule",
      "PluginConfigModule",
    ]) {
      expect(text).toContain(from);
    }
  });

  it("declares the settings group config.ts reads: the same id and defaults", () => {
    const [group] = (table().modules.CompanyRoadmapsPlugin?.contributes[
      "PluginConfigProvider.groups"
    ] ?? []) as Array<{
      id: string;
      properties: Record<string, { type: string; default: number }>;
    }>;
    expect(group?.id).toBe(CONFIG_GROUP);
    expect(group?.properties.relayDepth).toMatchObject({
      type: "number",
      default: DEFAULT_RELAY_DEPTH,
    });
    expect(group?.properties.pollSeconds).toMatchObject({
      type: "number",
      default: DEFAULT_POLL_SECONDS,
    });
    expect(configOf({})).toEqual({
      relayDepth: DEFAULT_RELAY_DEPTH,
      pollSeconds: DEFAULT_POLL_SECONDS,
    });
    expect(configOf({ relayDepth: 99, pollSeconds: 0 })).toEqual(configOf({}));
  });
});
