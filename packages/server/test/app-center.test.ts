/**
 * The App Center: a Project's home screen of workbench shortcuts, declared in each workbench's
 * own package.json (`penguin.appCenter`).
 *
 * The list (GET /api/projects/:p/app-center), read from the files without loading anything:
 * - Given workbenches that declare `show: true` on two Agents, each is one shortcut: the Agents in
 *   list order and by title within an Agent, with the Agent's name, the declared title else the
 *   first tab's else the package name, the icon's URL and the full page the declared tab opens.
 * - Given a workbench that declares nothing, `show: false`, or a package.json that does not
 *   parse, it has no shortcut.
 * - Given a declaration that does not hold up (not an object, `show` not a boolean, an icon
 *   outside ui/, of another type, missing or over 256 KB, a title over 60 characters, a tab the
 *   manifest lacks), the workbench has no shortcut.
 * - Given the list is read, nothing is compiled: a folder never loaded gains no build.
 * - Given a workbench whose last load failed, its shortcut is marked broken.
 * - Given a user outside the Project, the list is refused.
 *
 * The switch (PATCH …/workbenches/:id/app-center):
 * - Given a malformed declaration, the workbench still loads and its hints and status file name
 *   the fix; switching it on rewrites only `penguin.appCenter.show`, reloads it with the
 *   declaration read back, records a version, and the shortcut appears.
 * - Given a body without a boolean `show`, an unknown workbench, or a package.json that is not a
 *   JSON object, nothing is written and the answer says which.
 *
 * Only the switch scenario loads a workbench (one compile per load), on an Agent of its own, so
 * listing the others never compiles them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentStateDir } from "@prismshadow/penguin-core";
import type {
  AppCenterResponse,
  AppCenterShortcut,
  WorkbenchInfo,
  WorkbenchVersion,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-home";
const AGENT = "default_agent";
const LATER = "aardvark";
const SWITCHER = "switcher";

const tab = (key: string, title: string, titleZh?: string) => ({
  id: `demo.${key}`,
  key,
  title,
  ...(titleZh !== undefined ? { titleZh } : {}),
  renderer: { iframe: { src: "ui/index.html" } },
});

function packageJson(opts: {
  name?: string;
  tabs?: ReturnType<typeof tab>[];
  appCenter?: unknown;
}): Record<string, unknown> {
  return {
    name: opts.name ?? "demo",
    version: "1.0.0",
    type: "module",
    penguin: {
      version: "2026.11.04.1",
      ...(opts.appCenter !== undefined ? { appCenter: opts.appCenter } : {}),
      modules: [
        {
          name: "Workbench",
          requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
          provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
          contributes: { "WebModule.sessionTabs": opts.tabs ?? [tab("main", "Main")] },
          children: [],
        },
      ],
    },
    description: "kept as written",
  };
}

const HANDLER = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin";
export default {
  modules: {
    Workbench: {
      create() {
        return { api: { main: { async handle() { return { body: { ok: true } }; } } } };
      },
    },
  },
} satisfies WorkbenchPackage;
`;

/** A workbench folder: its package.json (an object, or the text as given), and any other files. */
async function writeWorkbench(
  root: string,
  agentId: string,
  id: string,
  pkg: Record<string, unknown> | string,
  files: Record<string, string | Buffer> = {},
): Promise<string> {
  const dir = path.join(agentStateDir(root, PROJECT, agentId), "workbenches", id);
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    typeof pkg === "string" ? pkg : JSON.stringify(pkg),
  );
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), body);
  }
  return dir;
}

/** What a failed load leaves in `.build/status.json`. */
const FAILED_STATUS = JSON.stringify({ ok: false, error: "index.ts:1:1 TS1005 ';' expected." });

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#2563eb"/></svg>';

/** Declarations that do not hold up, each in a folder of its own on the default Agent. */
const MALFORMED: Array<[string, unknown, Record<string, string | Buffer>?]> = [
  ["not-an-object", true],
  ["show-not-boolean", { show: "yes" }],
  ["icon-outside-ui", { show: true, icon: "index.ts" }, { "index.ts": "export {};" }],
  ["icon-climbs-out", { show: true, icon: "ui/../package.json" }],
  ["icon-wrong-type", { show: true, icon: "ui/icon.gif" }, { "ui/icon.gif": "GIF89a" }],
  ["icon-missing", { show: true, icon: "ui/none.svg" }],
  [
    "icon-too-large",
    { show: true, icon: "ui/big.svg" },
    { "ui/big.svg": Buffer.alloc(256 * 1024 + 1, 0x20) },
  ],
  ["title-too-long", { show: true, title: "x".repeat(61) }],
  ["tab-not-contributed", { show: true, tab: "nope" }],
];

describe("the App Center", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
    const project = await owner.post("/api/projects", { projectId: PROJECT, name: "home" });
    expect(project.status, await project.text()).toBe(201);
    for (const [agentId, name] of [
      [LATER, "Aardvark"],
      [SWITCHER, "Switcher"],
    ] as const) {
      const made = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId, name });
      expect(made.status, await made.text()).toBe(201);
    }
    await writeWorkbench(
      t.root,
      AGENT,
      "board",
      packageJson({
        tabs: [tab("board", "Board", "看板"), tab("stats", "Stats")],
        appCenter: { show: true, icon: "ui/icon.svg", tab: "stats" },
      }),
      { "ui/icon.svg": ICON },
    );
    await writeWorkbench(
      t.root,
      AGENT,
      "crm",
      packageJson({
        tabs: [tab("main", "CRM")],
        appCenter: { show: true, title: "Accounts", titleZh: "客户" },
      }),
    );
    await writeWorkbench(
      t.root,
      AGENT,
      "headless",
      packageJson({ name: "headless-pkg", tabs: [], appCenter: { show: true } }),
    );
    await writeWorkbench(t.root, AGENT, "plain", packageJson({}));
    await writeWorkbench(t.root, AGENT, "hidden", packageJson({ appCenter: { show: false } }));
    await writeWorkbench(t.root, AGENT, "garbled", "{ not json");
    for (const [id, appCenter, files] of MALFORMED)
      await writeWorkbench(t.root, AGENT, id, packageJson({ appCenter }), files);
    await writeWorkbench(
      t.root,
      LATER,
      "notes",
      packageJson({ tabs: [tab("notes", "Notes")], appCenter: { show: true } }),
      { ".build/status.json": FAILED_STATUS },
    );
  }, 30_000);
  afterAll(async () => {
    await t.cleanup();
  });

  const shortcuts = async (): Promise<AppCenterShortcut[]> => {
    const res = await owner.get(`/api/projects/${PROJECT}/app-center`);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as AppCenterResponse).shortcuts;
  };
  const ids = async () => (await shortcuts()).map((s) => `${s.agentId}/${s.workbenchId}`);

  it("lists one shortcut per shown workbench, Agents in list order and titles in order within one", async () => {
    const base = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches`;
    expect(await shortcuts()).toEqual([
      {
        agentId: AGENT,
        agentName: expect.any(String),
        workbenchId: "crm",
        title: "Accounts",
        titleZh: "客户",
        path: `/app/${PROJECT}/${AGENT}/crm`,
      },
      {
        agentId: AGENT,
        agentName: expect.any(String),
        workbenchId: "board",
        title: "Board",
        titleZh: "看板",
        iconUrl: `${base}/board/ui/icon.svg`,
        path: `/app/${PROJECT}/${AGENT}/board/stats`,
      },
      {
        agentId: AGENT,
        agentName: expect.any(String),
        workbenchId: "headless",
        title: "headless-pkg",
        path: `/app/${PROJECT}/${AGENT}/headless`,
      },
      {
        agentId: LATER,
        agentName: "Aardvark",
        workbenchId: "notes",
        title: "Notes",
        path: `/app/${PROJECT}/${LATER}/notes`,
        broken: true,
      },
    ]);
  });

  it.each(["plain", "hidden", "garbled"])(
    "gives %s no shortcut: it declares nothing to show",
    async (id) => {
      expect(await ids()).not.toContain(`${AGENT}/${id}`);
    },
  );

  it.each(MALFORMED.map(([id]) => id))(
    "gives a workbench whose declaration does not hold up (%s) no shortcut",
    async (id) => {
      expect(await ids()).not.toContain(`${AGENT}/${id}`);
    },
  );

  it("compiles nothing to list: a workbench never loaded gains no build", async () => {
    await shortcuts();
    const dir = path.join(agentStateDir(t.root, PROJECT, AGENT), "workbenches", "board");
    await expect(fs.stat(path.join(dir, ".build"))).rejects.toThrow();
  });

  it("refuses the list to a user outside the Project", async () => {
    const stranger = apiClient(t.app, (await provisionUser(t.app, "stranger")).cookie);
    expect((await stranger.get(`/api/projects/${PROJECT}/app-center`)).status).toBe(404);
  });

  it("names a malformed declaration in the load's hints, and the switch rewrites only show, reloads and records a version", async () => {
    const declared = packageJson({ tabs: [tab("tool", "Tool")], appCenter: { show: "yes" } });
    const dir = await writeWorkbench(t.root, SWITCHER, "tool", declared, {
      "index.ts": HANDLER,
      "ui/index.html": "<h1>tool</h1>",
    });
    const base = `/api/projects/${PROJECT}/agents/${SWITCHER}/workbenches`;

    const listed = (await (await owner.get(base)).json()) as { workbenches: WorkbenchInfo[] };
    const [before] = listed.workbenches;
    expect(before).toMatchObject({ id: "tool", error: null });
    expect(before!.appCenter).toBeUndefined();
    expect(before!.hints).toEqual([expect.stringContaining("package.json#penguin.appCenter")]);
    const status = JSON.parse(await fs.readFile(path.join(dir, ".build", "status.json"), "utf8"));
    expect(status.hints).toEqual(before!.hints);
    expect(await ids()).not.toContain(`${SWITCHER}/tool`);

    const res = await owner.patch(`${base}/tool/app-center`, { show: true });
    expect(res.status, await res.clone().text()).toBe(200);
    const { workbench } = (await res.json()) as { workbench: WorkbenchInfo };
    expect(workbench).toMatchObject({ id: "tool", error: null, hints: [] });
    expect(workbench.appCenter).toEqual({ show: true });
    expect(workbench.revision).not.toBe(before!.revision);

    // Only the one value changed: every other key keeps its value and its place.
    const penguin = declared["penguin"] as Record<string, unknown>;
    const expected = {
      ...declared,
      penguin: { ...penguin, appCenter: { show: true } },
    };
    expect(await fs.readFile(path.join(dir, "package.json"), "utf8")).toBe(
      `${JSON.stringify(expected, null, 2)}\n`,
    );
    const history = (await (await owner.get(`${base}/tool/history`)).json()) as {
      versions: WorkbenchVersion[];
    };
    expect(history.versions.map((v) => v.revision)).toEqual([
      workbench.revision,
      before!.revision,
    ]);
    expect(await ids()).toContain(`${SWITCHER}/tool`);
  });

  it("refuses a switch without a boolean, for an unknown workbench, or over a package.json that is not an object", async () => {
    const base = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches`;
    expect((await owner.patch(`${base}/plain/app-center`, { show: "yes" })).status).toBe(400);
    expect((await owner.patch(`${base}/nowhere/app-center`, { show: true })).status).toBe(404);

    const garbled = path.join(
      agentStateDir(t.root, PROJECT, AGENT),
      "workbenches",
      "garbled",
      "package.json",
    );
    const res = await owner.patch(`${base}/garbled/app-center`, { show: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "workbench_manifest_invalid",
    );
    expect(await fs.readFile(garbled, "utf8")).toBe("{ not json");
  });
});
