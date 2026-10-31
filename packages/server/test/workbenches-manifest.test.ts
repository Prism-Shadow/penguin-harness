/**
 * Workbench PWA manifests: the `GET /:id/manifest.webmanifest` route.
 *
 * The manifest is generated from the workbench's registration — `name` is the first tab's
 * title (the workbench's own name when it contributes none), `version` its package's,
 * `scope` and `start_url` its `ui/` mount — and its icons are the ones its `ui/icons/`
 * ships, the main app's penguin icons when it ships none. UI files and api dispatch are
 * untouched (covered by workbenches.test.ts).
 *
 * Like the loaded-once group there, each case runs the TypeScript compiler, so one app and
 * one compile are shared.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir } from "@prismshadow/penguin-core";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import type { WorkbenchInfo } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const PROJECT = "owner-wf";
const AGENT = "default_agent";
const BASE = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches`;
const HOST_KEY = "@prismshadow/penguin-server#WorkbenchHost";
const MAIN_KEY = "@prismshadow/penguin-server#WorkbenchMain";

const TAB = {
  id: "demo.board",
  key: "board",
  title: "Board",
  titleZh: "看板",
  renderer: { iframe: { src: "ui/index.html" } },
};

const MANIFEST = {
  name: "Workbench",
  requires: { host: { iface: HOST_KEY, from: "Host" } },
  provides: { main: MAIN_KEY },
  contributes: { "WebModule.sessionTabs": [TAB] },
  children: [],
};

/** Rewrites the table the harness wrote into the folder: the workbench was written against an OLDER one. */
async function writtenAgainst(dir: string, edit: (table: IfaceTable) => void): Promise<void> {
  const file = path.join(dir, ".harness", "ifaces.json");
  const table = JSON.parse(await fs.readFile(file, "utf8")) as IfaceTable;
  edit(table);
  await fs.writeFile(file, JSON.stringify(table));
}

/** The demo workbench, its one page and — when asked — its icons. */
async function writeDemo(dir: string, opts: { icons?: boolean } = {}): Promise<void> {
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  if (opts.icons) {
    await fs.mkdir(path.join(dir, "ui", "icons"), { recursive: true });
    // A 1×1 transparent PNG, the smallest thing a browser accepts as an icon.
    await fs.writeFile(
      path.join(dir, "ui", "icons", "icon-192.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
  }
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "Demo",
      version: "1.0.0",
      description: "A demo workbench",
      type: "module",
      penguin: { modules: [MANIFEST] },
    }),
  );
  await fs.writeFile(
    path.join(dir, "index.ts"),
    `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";

export default {
  modules: {
    Workbench: {
      create() {
        return { api: { main: { async handle() { return { body: { greeting: "hello" } }; } } } };
      },
    },
  },
} satisfies WorkbenchPackage;
`,
  );
  await fs.writeFile(path.join(dir, "ui", "index.html"), "<h1>demo v1</h1>");
}

/** An app with the owner's Project and a demo workbench (with or without icons) in its default Agent. */
async function workbenchApp(opts: { icons?: boolean } = {}) {
  const t = await createTestApp();
  const a = await provisionUser(t.app, "owner");
  const owner = apiClient(t.app, a.cookie);
  const created = await owner.post("/api/projects", { projectId: PROJECT, name: "wf" });
  expect(created.status, await created.text()).toBe(201);
  const dir = path.join(agentDir(t.root, PROJECT, AGENT), "workbenches", "demo");
  await writeDemo(dir, opts);
  return { t, owner, dir };
}

describe("workbench manifest route", { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let owner: ReturnType<typeof apiClient>;
  let dir: string;
  let wf: WorkbenchInfo;

  // One real compiler load, shared by both cases (see the loaded-once note in workbenches.test.ts).
  beforeAll(async () => {
    ({ t, owner, dir } = await workbenchApp());
    const res = await owner.get(BASE);
    expect(res.status).toBe(200);
    wf = ((await res.json()) as { workbenches: WorkbenchInfo[] }).workbenches[0]!;
  }, 30_000);
  afterAll(async () => {
    await t.cleanup();
  });

  const manifest = async () => {
    const res = await owner.get(`${BASE}/${wf.id}/manifest.webmanifest`);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    return JSON.parse(text) as Record<string, unknown>;
  };

  it("answers the tab's title and the workbench's own scope, and falls back to the main app's icons", async () => {
    const m = await manifest();
    expect(m.name).toBe("Board");
    expect(m.short_name).toBe("Demo");
    expect(m.version).toBe("1.0.0");
    expect(m.display).toBe("standalone");
    expect(String(m.scope)).toBe(`${BASE}/${wf.id}/ui/`);
    expect(m.start_url).toBe(m.scope);
    const icons = m.icons as { src: string; sizes: string; type: string }[];
    expect(icons).toEqual([
      { src: "/penguin-logo-192.png", sizes: "192x192", type: "image/png" },
      { src: "/penguin-logo-512.png", sizes: "512x512", type: "image/png" },
    ]);
  });

  it("serves the workbench's own ui/icons when it ships them", async () => {
    await writeDemo(dir, { icons: true });
    const res = await owner.post(`${BASE}/${wf.id}/reload`);
    expect(res.status, await res.text()).toBe(200);
    const m = await manifest();
    const icons = m.icons as { src: string; sizes: string; type: string }[];
    expect(icons).toEqual([
      { src: `${BASE}/${wf.id}/ui/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
    ]);
    // And the icon itself is served through the same ui/ route as the pages.
    const icon = await owner.get(`${BASE}/${wf.id}/ui/icons/icon-192.png`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toBe("image/png");
  });

  it("404s for a workbench that does not exist", async () => {
    const res = await owner.get(`${BASE}/no-such/manifest.webmanifest`);
    expect(res.status).toBe(404);
  });
});
