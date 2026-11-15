/**
 * Workbench PWA manifests: the `GET /:id/manifest.webmanifest` route.
 *
 * The manifest is generated from the workbench's registration — `name` is the first tab's
 * title (the workbench's own name when it contributes none), `version` its package's,
 * `scope` and `start_url` its full-page app route (the page whose manifest link names this
 * manifest) — and its icon is the plugin icon a workbench already ships as a plugin package
 * (`package.json#penguin.icon`, `icon.svg` at the root, read through the plugin library's own
 * reader), inlined as a data URI; a workbench without one falls back to the main app's
 * penguin SVG. There is no `ui/icons/` convention. UI files and api dispatch are untouched
 * (covered by workbenches.test.ts).
 *
 * Like the loaded-once group there, each case runs the TypeScript compiler, so one app and
 * one compile are shared.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir, isSafeIconSvg } from "@prismshadow/penguin-core";
import type { WorkbenchInfo } from "../src/api/types.js";
import { MAIN_ICON } from "../src/workbenches/manifest.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const PROJECT = "owner-wf";
const AGENT = "default_agent";
const BASE = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches`;
/** The seeded admin's own project, for the cold anonymous-read app (its workbench is pre-seeded). */
const DEFAULT_PROJECT = "default_project";
const COLD_BASE = `/api/projects/${DEFAULT_PROJECT}/agents/${AGENT}/workbenches`;
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

/** A real PNG header (the first 16 bytes of a 1×1): what a `.png`-faced icon must begin with. */
const PNG_BYTES_BASE64 = Buffer.from(
  Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  ]),
).toString("base64");

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

/** The compile/boot lifecycle writes `.build/` into the folder; its absence says nothing ran. */
async function assertDoesNotExit(p: string): Promise<void> {
  await expect(fs.access(p)).rejects.toThrow();
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

/**
 * A cold app for the anonymous-read case: the demo workbench is written BEFORE boot (under
 * the seeded admin's own project — creating it here is why the POST route is not used: the
 * project directory would already exist and the create would 409). A folder present at boot
 * is watched, never polled-and-listed: the first-workbench poller only arms for a folder
 * that appears after boot, and its appearing IS a compile+boot. Nothing here has ever asked
 * the session-gated list, so a `.build/` in the folder after an anonymous manifest read
 * would be the read's own doing.
 */
async function coldWorkbenchApp(opts: { icon?: boolean } = {}) {
  const t = await createTestApp({
    beforeSeed: async (root) => {
      await writeDemo(
        path.join(agentDir(root, DEFAULT_PROJECT, AGENT), "workbenches", "demo"),
        opts,
      );
    },
  });
  const a = await loginAdmin(t.app);
  const owner = apiClient(t.app, a.cookie);
  const dir = path.join(agentDir(t.root, DEFAULT_PROJECT, AGENT), "workbenches", "demo");
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

  it("answers the tab's title, the app route as its scope and its plugin icon inlined", async () => {
    const m = await manifest();
    expect(m.name).toBe("Board");
    // Same source as `name` — the first tab's title, not the package name: the browser shows
    // one in the install prompt and the other as the launcher label, and two different
    // strings read as two different apps (a workbench titled "Sakana" on a folder "shot"
    // installed as "shot"). See the 2026-10-31 read on the deployed instance.
    expect(m.short_name).toBe("Board");
    expect(m.version).toBe("1.0.0");
    expect(m.display).toBe("standalone");
    expect(m.scope).toBe(`/app/owner-wf/default_agent/${wf.id}`);
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

  it("takes the app icon from the FIRST tab — the one the manifest is named for", async () => {
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "Demo",
        version: "1.0.0",
        type: "module",
        penguin: {
          modules: [
            {
              ...MANIFEST,
              contributes: {
                "WebModule.sessionTabs": [
                  { ...TAB, icon: { kind: "png", data: PNG_BYTES_BASE64 } },
                  {
                    ...TAB,
                    id: "demo.svg",
                    key: "svg",
                    title: "Svg",
                    renderer: { iframe: { src: "ui/index.html" } },
                    icon: { kind: "svg", data: ICON_SVG },
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    const res = await owner.post(`${BASE}/${wf.id}/reload`);
    expect(res.status, await res.text()).toBe(200);
    // The whole manifest is named for and opens the FIRST tab — its icon comes with it, not
    // some later tab's: name, page and icon are one face (the plugin icon would only be
    // asked when the first tab declares none).
    const m = (await (await owner.get(`${BASE}/${wf.id}/manifest.webmanifest`)).json()) as {
      icons: { src: string; type: string }[];
    };
    expect(m.icons).toHaveLength(1);
    expect(m.icons[0]!.type).toBe("image/png");
    expect(m.icons[0]!.src).toBe(`data:image/png;base64,${PNG_BYTES_BASE64}`);
    // The other tab's own manifest takes ITS icon.
    const svg = (await (
      await owner.get(`${BASE}/${wf.id}/tabs/svg/manifest.webmanifest`)
    ).json()) as { icons: { src: string; type: string }[] };
    expect(svg.icons[0]!.type).toBe("image/svg+xml");
    expect(svg.icons[0]!.src).toBe(
      `data:image/svg+xml;base64,${Buffer.from(ICON_SVG, "utf8").toString("base64")}`,
    );
  });

  it("falls back to the plugin icon when the first tab declares none — even if a later tab does", async () => {
    // The suite shares one folder: an earlier case stripped `icon.svg` to test the fallback,
    // so the plugin icon is shipped again here.
    await fs.writeFile(path.join(dir, "icon.svg"), ICON_SVG);
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "Demo",
        version: "1.0.0",
        type: "module",
        penguin: {
          modules: [
            {
              ...MANIFEST,
              contributes: {
                "WebModule.sessionTabs": [
                  TAB,
                  {
                    ...TAB,
                    id: "demo.png",
                    key: "png",
                    title: "Png",
                    renderer: { iframe: { src: "ui/index.html" } },
                    icon: { kind: "png", data: PNG_BYTES_BASE64 },
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    const res = await owner.post(`${BASE}/${wf.id}/reload`);
    expect(res.status, await res.text()).toBe(200);
    const m = (await (await owner.get(`${BASE}/${wf.id}/manifest.webmanifest`)).json()) as {
      icons: { src: string; type: string }[];
    };
    // Not the second tab's PNG: the first tab anchors the face, and this fixture's workbench
    // ships a plugin icon — that is what the whole manifest carries.
    expect(m.icons[0]!.type).toBe("image/svg+xml");
    expect(m.icons[0]!.src).toBe(
      `data:image/svg+xml;base64,${Buffer.from(ICON_SVG, "utf8").toString("base64")}`,
    );
  });

  it("404s for a workbench that does not exist", async () => {
    const res = await owner.get(`${BASE}/no-such/manifest.webmanifest`);
    expect(res.status).toBe(404);
  });

  it("answers without a session — the install face fetches the manifest with no cookie", async () => {
    // Installation runs on the workbench's own host, where the main origin's session cookie
    // is not sent; the manifest must answer anyway (this exact fetch used to 401 behind the
    // session gate and the browser refused to install).
    const res = await t.app.request(`${BASE}/${wf.id}/manifest.webmanifest`);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    expect((JSON.parse(text) as { name: string }).name).toBe("Board");
  });

  it("keeps the rest of the prefix behind the session gate", async () => {
    // Only the manifest path is public: the same prefix without a cookie still demands one.
    const res = await t.app.request(`${BASE}`);
    expect(res.status).toBe(401);
  });

  it("answers a per-tab manifest that installs the tab as its own app", async () => {
    // A second tab, so the two differ; the tab's own manifest names IT and opens ITS page.
    const stats = { ...TAB, id: "demo.stats", key: "stats", title: "Stats" };
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    pkg.penguin.modules[0]!.contributes["WebModule.sessionTabs"] = [TAB, stats];
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 1));
    const reloaded = await owner.post(`${BASE}/${wf.id}/reload`);
    expect(reloaded.status, await reloaded.text()).toBe(200);

    const res = await t.app.request(`${BASE}/${wf.id}/tabs/stats/manifest.webmanifest`);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const m = JSON.parse(text) as { name: string; short_name: string; scope: string };
    // The tab is the app: its own title, its own full-page route as scope/start_url.
    expect(m.name).toBe("Stats");
    expect(m.short_name).toBe("Stats");
    expect(m.scope).toBe(`/app/${PROJECT}/${AGENT}/${wf.id}/stats`);
    // The workbench-level manifest keeps its own face: the first tab, the shared route.
    const whole = JSON.parse(
      await (await t.app.request(`${BASE}/${wf.id}/manifest.webmanifest`)).text(),
    ) as { name: string; scope: string };
    expect(whole.name).toBe("Board");
    expect(whole.scope).toBe(`/app/${PROJECT}/${AGENT}/${wf.id}`);
    // An unknown tab is the same 404 the routes give an unknown workbench.
    const missing = await t.app.request(`${BASE}/${wf.id}/tabs/nope/manifest.webmanifest`);
    expect(missing.status).toBe(404);
  });

  it("runs no lifecycle on the manifest path — an anonymous read touches nothing", async () => {
    // The anonymous gate answers from the folder's package.json alone: no directory
    // migration, no watcher, no compile (no .build directory written), no module booted
    // (the workbench has never been listed in this fresh app). The compile side of this
    // suite's own setup ran because a session-gated request listed the workbenches; what
    // this asserts is that the ANONYMOUS manifest read does none of that by itself.
    const fresh = await coldWorkbenchApp({ icon: true });
    try {
      const build = path.join(fresh.dir, ".build");
      const res = await fresh.t.app.request(`${COLD_BASE}/demo/manifest.webmanifest`);
      expect(res.status).toBe(200);
      // No .build after the anonymous read: no compile, no boot, nothing.
      await assertDoesNotExit(build);
      // The contrast: the SESSION-gated list (which the manifest gate does not call) does
      // run the lifecycle — the same folder, one GET later, has a build on disk. That is
      // what the manifest route must not be able to cause, and what it did not.
      const listed = await fresh.owner.get(`${COLD_BASE}`);
      expect(listed.status).toBe(200);
      // The compile is a background job of the load; the build appears when it lands.
      // `fs.access` resolves with undefined, so the assertion is "the access succeeds".
      await vi.waitFor(async () => {
        await expect(fs.access(build)).resolves.toBeUndefined();
      }, { timeout: 30_000 });
      // And a second anonymous read answers again — reading, not touching, what is there.
      const again = await fresh.t.app.request(`${COLD_BASE}/demo/manifest.webmanifest`);
      expect(again.status).toBe(200);
    } finally {
      await fresh.t.cleanup();
    }
  });

  it("answers a remote machine's manifest with the machine named in start_url", async () => {
    // A workbench of a remote machine: the gate hops to that machine's identical gate (the
    // hop is the Machines forward, wired in setup) and names the machine in the start_url —
    // the installed app opens the tab there. Here the hop is exercised through the route's
    // own query contract against the null forward (no machine connected): 503, the proxy's
    // own answer for it.
    const res = await t.app.request(`${BASE}/${wf.id}/manifest.webmanifest?machine=vm-1`);
    expect(res.status).toBe(503);
    // The workbench-level route without the query is untouched by the machine contract.
    const local = await t.app.request(`${BASE}/${wf.id}/manifest.webmanifest`);
    expect(local.status).toBe(200);
    const m = JSON.parse(await local.text()) as { start_url: string };
    expect(m.start_url).not.toContain("machine=");
  });
});
