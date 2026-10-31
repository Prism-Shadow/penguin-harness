/**
 * Workbench PWA manifests: the `GET /:id/manifest.webmanifest` route.
 *
 * The manifest is generated from the workbench's registration — `name` is the first tab's
 * title (the workbench's own name when it contributes none), `version` its package's,
 * `scope` and `start_url` its `ui/` mount — and its icon is the plugin icon a workbench
 * already ships as a plugin package (`package.json#penguin.icon`, `icon.svg` at the root,
 * read through the plugin library's own reader), inlined as a data URI; a workbench without
 * one falls back to the main app's penguin SVG. There is no `ui/icons/` convention. UI files
 * and api dispatch are untouched (covered by workbenches.test.ts).
 *
 * Like the loaded-once group there, each case runs the TypeScript compiler, so one app and
 * one compile are shared.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir, isSafeIconSvg } from "@prismshadow/penguin-core";
import type { WorkbenchInfo } from "../src/api/types.js";
import { MAIN_ICON } from "../src/workbenches/manifest.js";
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

/** The icon the first case ships: the same shape a plugin's `icon.svg` takes. */
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#0258f4"/></svg>';

/** The demo workbench, its one page and — when asked — its plugin icon. */
async function writeDemo(dir: string, opts: { icon?: boolean } = {}): Promise<void> {
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  if (opts.icon) await fs.writeFile(path.join(dir, "icon.svg"), ICON_SVG);
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

/** An app with the owner's Project and a demo workbench (with or without an icon) in its default Agent. */
async function workbenchApp(opts: { icon?: boolean } = {}) {
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
    ({ t, owner, dir } = await workbenchApp({ icon: true }));
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

  it("answers the tab's title, the workbench's own scope and its plugin icon inlined", async () => {
    const m = await manifest();
    expect(m.name).toBe("Board");
    expect(m.short_name).toBe("Demo");
    expect(m.version).toBe("1.0.0");
    expect(m.display).toBe("standalone");
    expect(m.scope).toBe(`${BASE}/${wf.id}/ui/`);
    expect(m.start_url).toBe(m.scope);
    const icons = m.icons as { src: string; sizes: string; type: string }[];
    expect(icons).toHaveLength(1);
    expect(icons[0]!.type).toBe("image/svg+xml");
    expect(icons[0]!.sizes).toBe("any");
    // Inlined, so it has no external reference and rides with the install — and the text
    // inside is exactly the SVG the package ships, safe by the plugin icon's own face.
    expect(icons[0]!.src).toMatch(/^data:image\/svg\+xml;base64,/);
    const decoded = Buffer.from(
      icons[0]!.src.slice("data:image/svg+xml;base64,".length),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe(ICON_SVG);
    expect(isSafeIconSvg(decoded)).toBe(true);
  });

  it("falls back to the main app's penguin SVG when the workbench ships no icon", async () => {
    await fs.rm(path.join(dir, "icon.svg"));
    const res = await owner.post(`${BASE}/${wf.id}/reload`);
    expect(res.status, await res.text()).toBe(200);
    const m = await manifest();
    expect(m.icons).toEqual([{ src: MAIN_ICON, sizes: "any", type: "image/svg+xml" }]);
    // The ui/icons convention does not exist: the fallback is not served from the workbench.
    expect((m.icons as { src: string }[])[0]!.src).not.toContain("/ui/");
  });

  it("404s for a workbench that does not exist", async () => {
    const res = await owner.get(`${BASE}/no-such/manifest.webmanifest`);
    expect(res.status).toBe(404);
  });
});
