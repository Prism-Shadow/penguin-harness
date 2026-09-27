/**
 * The routes over the service: the refusals and their codes, the Session claim honoured only
 * behind the local API token, and the generated manifest agreeing with the code.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import plugin, {
  CONFIG_GROUP,
  CompanyRoadmapsPlugin,
  DEFAULT_POLL_SECONDS,
  DEFAULT_RELAY_DEPTH,
  ROUTES_ID,
  configOf,
  roadmapRoutes,
} from "../src/index.js";
import { world, writeChannel, type World } from "./fakes.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "/p/proj/o/acme/roadmaps";

let w: World;
let app: Hono;

beforeEach(async () => {
  w = await world();
  await writeChannel(w.root, "room_a", ["user:boss", "agent:acme_dev", "agent:acme_web"]);
  app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { userId: "boss" } as never);
    c.set("sessionVia" as never, (c.req.header("x-via") ?? "password") as never);
    await next();
  });
  app.route("/p/:projectId/o/:orgId/roadmaps", roadmapRoutes(w.service()));
});

async function call(
  method: string,
  url: string,
  body?: unknown,
  via = "password",
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request(url, {
    method,
    headers: { "content-type": "application/json", "x-via": via },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const code = (r: { json: Record<string, unknown> }) => (r.json.error as { code: string }).code;
const open = { name: "Queue", channelId: "room_a", employees: ["acme_dev", "acme_web"] };

describe("the routes", () => {
  it("answer 404 while company mode is off", async () => {
    w.gateway.enabled = false;
    expect((await call("GET", BASE)).status).toBe(404);
    expect((await call("POST", BASE, open)).status).toBe(404);
  });

  it("open a roadmap for a person (201), and refuse an employee speaking from its session (403)", async () => {
    const made = await call("POST", BASE, open);
    expect(made.status).toBe(201);
    expect((made.json.roadmap as { number: number }).number).toBe(1);
    const claim = { sessionId: "desk-acme_dev", agentId: "acme_dev" };
    const refused = await call("POST", BASE, { ...open, ...claim }, "token");
    expect([refused.status, code(refused)]).toEqual([403, "people_only"]);
  });

  it("drop a Session claim that only a cookie backs: the write is the person's", async () => {
    await call("POST", BASE, open);
    const claim = { sessionId: "desk-acme_web", agentId: "acme_web" };
    // acme_web is not the moderator — behind the token its draft is refused, behind a cookie it is the person's.
    const asEmployee = await call("PUT", `${BASE}/1/draft`, { record: "x", ...claim }, "token");
    expect([asEmployee.status, code(asEmployee)]).toEqual([403, "not_moderator"]);
    expect((await call("PUT", `${BASE}/1/draft`, { record: "x", ...claim })).status).toBe(200);
  });

  it("refuse a body that is not a JSON object, a missing roadmap, and a draft item that is not well formed", async () => {
    expect((await call("POST", BASE, "[1]")).status).toBe(400);
    expect((await call("POST", BASE, "{no")).status).toBe(400);
    expect((await call("GET", `${BASE}/7`)).status).toBe(404);
    expect((await call("GET", `${BASE}/x`)).status).toBe(404);
    await call("POST", BASE, open);
    const bad = await call("PUT", `${BASE}/1/draft`, {
      items: [{ key: "a", kind: "proposal", title: "T", brief: "B", owner: "nobody", cites: ["Why"] }],
    });
    expect([bad.status, code(bad)]).toEqual([400, "bad_request"]);
  });

  it("refuse to establish over a cite the body does not have (400 cite_unknown)", async () => {
    await call("POST", BASE, open);
    await call("PUT", `${BASE}/1/draft`, {
      body: "## Why\n",
      items: [{ key: "a", kind: "proposal", title: "T", brief: "B", owner: "acme_dev", cites: ["How"] }],
    });
    const refused = await call("POST", `${BASE}/1/establish`, {});
    expect([refused.status, code(refused)]).toEqual([400, "cite_unknown"]);
  });

  it("list a room's roadmaps, and filter by status", async () => {
    await call("POST", BASE, open);
    const listed = await call("GET", `${BASE}?channel=room_a&status=discussing`);
    expect((listed.json.roadmaps as unknown[]).length).toBe(1);
    expect(((await call("GET", `${BASE}?channel=room_b`)).json.roadmaps as unknown[]).length).toBe(0);
    expect(((await call("GET", `${BASE}?status=established`)).json.roadmaps as unknown[]).length).toBe(0);
  });
});

describe("the manifest", () => {
  const table = () =>
    JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as {
      modules: Record<string, { contributes: Record<string, unknown[]> }>;
      plugin: { modules: string[] };
    };

  it("names the one module, its routes, and what it requires of the harness", () => {
    expect(plugin.modules).toEqual([CompanyRoadmapsPlugin]);
    const t = table();
    expect(t.plugin.modules).toEqual(["CompanyRoadmapsPlugin"]);
    const manifest = t.modules.CompanyRoadmapsPlugin;
    expect((manifest?.contributes["HttpModule.routes"]?.[0] as { id: string }).id).toBe(ROUTES_ID);
    const text = JSON.stringify(manifest);
    for (const from of ["CompanyModule", "SessionRuntimeModule", "RuntimeModule", "PluginConfigModule"]) {
      expect(text).toContain(from);
    }
  });

  it("declares the settings group config.ts reads: the same id and defaults", () => {
    const [group] = (table().modules.CompanyRoadmapsPlugin?.contributes["PluginConfigProvider.groups"] ??
      []) as Array<{
      id: string;
      properties: Record<string, { type: string; default: number }>;
    }>;
    expect(group?.id).toBe(CONFIG_GROUP);
    expect(group?.properties.relayDepth).toMatchObject({ type: "number", default: DEFAULT_RELAY_DEPTH });
    expect(group?.properties.pollSeconds).toMatchObject({ type: "number", default: DEFAULT_POLL_SECONDS });
    expect(configOf({})).toEqual({ relayDepth: DEFAULT_RELAY_DEPTH, pollSeconds: DEFAULT_POLL_SECONDS });
    expect(configOf({ relayDepth: 99, pollSeconds: 0 })).toEqual(configOf({}));
  });
});
