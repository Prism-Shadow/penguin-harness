/**
 * The App Center: a Project's home screen of workbench shortcuts, declared in each workbench's
 * own package.json (`penguin.appCenter`), and each viewer's own arrangement of it.
 *
 * The list (GET /api/projects/:p/app-center), read from the files without loading anything:
 * - Given workbenches that declare `show: true` on two Agents, each is one shortcut: the Agents in
 *   list order and by title within an Agent, with the Agent's name, the declared title else the
 *   first tab's else the package name, the tab it opens (declared, else the first), the icon's
 *   route, the full page the declared tab opens and where its build stands; listing them
 *   compiles nothing.
 * - Given a workbench that declares nothing, `show: false`, or a package.json that does not
 *   parse, it has no shortcut.
 * - Given a declaration that does not hold up (not an object, `show` not a boolean, an icon
 *   outside ui/, of a format an icon may not be, missing or over 256 KB, a title over 60
 *   characters, a tab the manifest lacks), the workbench has no shortcut.
 * - Given a workbench whose last load failed, its shortcut reads failed, with the error its
 *   status file records when it records one.
 * - Given a user outside the Project, the list is refused.
 *
 * Where a build stands, with a load held inside the workbench's own create():
 * - Given a load under way, the shortcut reads building, even over a failed status file, and
 *   ready once the load has ended; the Project's users hear `workbench_building` once for that
 *   load, and not again for a caller that shares it.
 *
 * Icons (GET …/workbenches/:id/app-center/icon):
 * - Given an icon in each format (PNG, JPEG as .jpg or .jpeg, GIF, WebP, AVIF by its major or a
 *   compatible brand, SVG after a byte-order mark, XML declaration and comment), its shortcut's
 *   icon URL serves its bytes under the type they are, with nosniff, a sandboxing CSP and
 *   same-origin CORP, kept for good; it is tinted only when it is a monochrome SVG, never when
 *   it is a coloured SVG or a raster.
 * - Given an icon whose bytes are not the format its name claims, an SVG holding script, or one
 *   over 256 KB, the workbench has no shortcut, its load hints name the problem, and its icon is
 *   not found.
 * - Given an icon's bytes change, its URL changes, and the new URL serves the new bytes.
 * - Given a workbench whose declaration names an icon, its own row in the workbench list names
 *   it too, shown in the App Center or not, at the URL its shortcut gets once it is shown.
 * - Given a workbench without an icon, or an unknown workbench, the icon is not found; a user
 *   outside the Project gets the access error.
 *
 * The viewer's arrangement (PUT /api/projects/:p/app-center/layout):
 * - Given a layout is stored, the App Center answers it to that viewer as stored (known fields
 *   only, folder names trimmed), and another member of the Project still reads none.
 * - Given a layout that breaks a rule, or a body without one, it is refused with the rule named
 *   and nothing is stored.
 * - Given PUT /api/me/prefs names `appCenterLayouts`, it is refused and nothing is stored.
 * - Given null is stored, the App Center answers null: the server's order.
 * - Given a stored layout that does not hold up, or prefs that do not parse, the App Center
 *   answers null.
 * - Given layouts kept for Projects that no longer exist, the next write lets go of them and of
 *   nothing else.
 *
 * The switch (PATCH …/workbenches/:id/app-center):
 * - Given a malformed declaration, the workbench still loads and its hints and status file name
 *   the fix; switching it on rewrites only `penguin.appCenter.show`, reloads it with the
 *   declaration read back, records a version, and the shortcut appears.
 * - Given a body without a boolean `show`, an unknown workbench, or a package.json that is not a
 *   JSON object, nothing is written and the answer says which.
 * - Given a workbench switched off, by its own switch or the Agent's, it has no tile; its row
 *   still names its declaration and icon, and the App Center switch writes it without loading it.
 *
 * Only the switch, the held load, the bad icons' hints and the icon row load workbenches, each on
 * an Agent of its own, so listing the others never compiles them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { agentStateDir } from "@prismshadow/penguin-core";
import type {
  AppCenterLayoutResponse,
  AppCenterResponse,
  AppCenterShortcut,
  PrefsResponse,
  ServerEvent,
  WorkbenchInfo,
  WorkbenchVersion,
} from "../src/api/types.js";
import { userChannelKey } from "../src/http/routes/events.js";
import { readFolder } from "../src/workbenches/store.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "owner-home";
const AGENT = "default_agent";
const LATER = "aardvark";
const SWITCHER = "switcher";
const BUILDER = "builder";
const GALLERY = "gallery";
const BAD_ICONS = "badicons";
const ICON_ROW = "iconrow";

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

/** What a held load waits on inside create(), set by the test that holds it. */
interface Hold {
  enter(): void;
  done: Promise<void>;
}
const gate = globalThis as unknown as { appCenterHold?: Hold };

/** A handler whose tree is created only once the test lets it, when it holds one (`gate`). */
const HELD_HANDLER = `/// <reference no-default-lib="true" />
/// <reference lib="es2022" />
import type { WorkbenchPackage, WorkbenchRootModule } from "@prismshadow/penguin-server/plugin";
const gate = globalThis as unknown as { appCenterHold?: { enter(): void; done: Promise<void> } };
const create = async () => {
  const hold = gate.appCenterHold;
  if (hold !== undefined) {
    hold.enter();
    await hold.done;
  }
  return { api: { main: { async handle() { return { body: { ok: true } }; } } } };
};
export default {
  modules: { Workbench: { create: create as unknown as WorkbenchRootModule["create"] } },
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

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#2563eb"/></svg>';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from("GIF89a\x01\x00", "latin1");
const WEBP = Buffer.from("RIFF\x0c\x00\x00\x00WEBPVP8 ", "latin1");

/** The ISO-BMFF file type box an AVIF file starts with, naming its brands. */
function ftyp(major: string, compatible: string[]): Buffer {
  const brands = Buffer.from(`${major}\0\0\0\0${compatible.join("")}`, "latin1");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + brands.length);
  return Buffer.concat([size, Buffer.from("ftyp"), brands, Buffer.from("mdat")]);
}

/** A line icon in the text colour: every paint `currentColor` or `none`. */
const MONOCHROME =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 12h16" fill="none" stroke="currentColor"/></svg>';

/**
 * One icon per format, each in a folder of its own on the gallery Agent: the type it is served
 * as, and whether it is drawn in the text colour.
 */
const ICONS: Array<[string, string, Buffer | string, string, boolean]> = [
  ["png", "ui/icon.png", PNG, "image/png", false],
  ["jpeg", "ui/icon.jpeg", JPEG, "image/jpeg", false],
  ["jpg", "ui/icon.jpg", JPEG, "image/jpeg", false],
  ["gif", "ui/icon.gif", GIF, "image/gif", false],
  ["webp", "ui/icon.webp", WEBP, "image/webp", false],
  ["avif", "ui/icon.avif", ftyp("avif", ["mif1", "miaf"]), "image/avif", false],
  ["avif-sequence", "ui/icon.avif", ftyp("mif1", ["miaf", "avis"]), "image/avif", false],
  [
    "svg",
    "ui/icon.svg",
    `\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- drawn by hand -->\n${ICON}`,
    "image/svg+xml",
    false,
  ],
  ["svg-monochrome", "ui/icon.svg", MONOCHROME, "image/svg+xml", true],
];

/** Icons that do not hold up, each in a folder of its own, and what the hint says of them. */
const BAD_ICONS_CASES: Array<[string, string, Buffer | string, string]> = [
  ["svg-named-png", "ui/icon.png", ICON, "ui/icon.png is named as PNG but its bytes are SVG"],
  ["png-named-svg", "ui/icon.svg", PNG, "ui/icon.svg is named as SVG but its bytes are PNG"],
  ["text-named-webp", "ui/icon.webp", "hello", "ui/icon.webp is not a WEBP image"],
  [
    "svg-with-script",
    "ui/icon.svg",
    ICON.replace("</svg>", "<script>alert(1)</script></svg>"),
    "ui/icon.svg is not a plain SVG",
  ],
  [
    "over-256-kb",
    "ui/big.png",
    Buffer.concat([PNG, Buffer.alloc(256 * 1024)]),
    `ui/big.png is larger than 256 KB (${PNG.length + 256 * 1024} bytes)`,
  ],
];

/** Declarations that do not hold up, each in a folder of its own on the default Agent. */
const MALFORMED: Array<[string, unknown, Record<string, string | Buffer>?]> = [
  ["not-an-object", true],
  ["show-not-boolean", { show: "yes" }],
  ["icon-outside-ui", { show: true, icon: "index.ts" }, { "index.ts": "export {};" }],
  ["icon-climbs-out", { show: true, icon: "ui/../package.json" }],
  ["icon-wrong-type", { show: true, icon: "ui/icon.bmp" }, { "ui/icon.bmp": "BM" }],
  ["icon-missing", { show: true, icon: "ui/none.svg" }],
  [
    "icon-too-large",
    { show: true, icon: "ui/big.svg" },
    { "ui/big.svg": Buffer.alloc(256 * 1024 + 1, 0x20) },
  ],
  ["title-too-long", { show: true, title: "x".repeat(61) }],
  ["tab-not-contributed", { show: true, tab: "nope" }],
];

const app = (key: string) => ({ type: "app", app: key });
const folder = (id: string, name: string, apps: unknown[]) => ({ type: "folder", id, name, apps });
const appKeys = (count: number, agentId = "a") =>
  Array.from({ length: count }, (_, i) => `${agentId}/w${i}`);

const FOLDER_NAME = "𝒜".repeat(40);
/** An arrangement as the Web App sends it: a field the server does not know, a name to trim. */
const LAYOUT = {
  v: 1,
  items: [
    { ...app(`${AGENT}/crm`), pinned: true },
    folder("tools", `  ${FOLDER_NAME} `, [`${AGENT}/board`, `${LATER}/notes`]),
    app("gone/workbench"),
  ],
};
const STORED = {
  v: 1,
  items: [
    app(`${AGENT}/crm`),
    folder("tools", FOLDER_NAME, [`${AGENT}/board`, `${LATER}/notes`]),
    app("gone/workbench"),
  ],
};

/** Bodies the layout route refuses, and the part of the message that names the rule. */
const REFUSED: Array<[string, Record<string, unknown>, string]> = [
  ["a body without a layout", {}, "must name layout"],
  ["a layout that is not an object", { layout: "grid" }, "layout must be"],
  ["a version other than 1", { layout: { v: 2, items: [] } }, "layout.v must be 1"],
  ["items that are not a list", { layout: { v: 1, items: {} } }, "layout.items must be a list"],
  ["more than 500 items", { layout: { v: 1, items: appKeys(501).map(app) } }, "500 items"],
  ["an item of no known type", { layout: { v: 1, items: [{ type: "widget" }] } }, "items[0] must"],
  ["an app key without a slash", { layout: { v: 1, items: [app("solo")] } }, "items[0].app"],
  ["an app key with two slashes", { layout: { v: 1, items: [app("a/b/c")] } }, "items[0].app"],
  ["an app key with an empty part", { layout: { v: 1, items: [app("a/")] } }, "items[0].app"],
  [
    "an app key over 200 characters",
    { layout: { v: 1, items: [app(`a/${"w".repeat(199)}`)] } },
    "items[0].app",
  ],
  [
    "a folder id with a space",
    { layout: { v: 1, items: [folder("my tools", "Tools", ["a/b"])] } },
    "items[0].id",
  ],
  [
    "a folder id over 32 characters",
    { layout: { v: 1, items: [folder("f".repeat(33), "Tools", ["a/b"])] } },
    "items[0].id",
  ],
  [
    "a folder name blank once trimmed",
    { layout: { v: 1, items: [folder("tools", "   ", ["a/b"])] } },
    "items[0].name",
  ],
  [
    "a folder name over 40 characters",
    { layout: { v: 1, items: [folder("tools", "n".repeat(41), ["a/b"])] } },
    "items[0].name",
  ],
  ["an empty folder", { layout: { v: 1, items: [folder("tools", "Tools", [])] } }, "items[0].apps"],
  [
    "a folder of more than 500 apps",
    { layout: { v: 1, items: [folder("tools", "Tools", appKeys(501))] } },
    "items[0].apps",
  ],
  [
    "a folder holding something other than an app key",
    { layout: { v: 1, items: [folder("tools", "Tools", ["a/b", "nope"])] } },
    "items[0].apps[1]",
  ],
  [
    "more than 1000 app keys in all",
    {
      layout: {
        v: 1,
        items: [
          folder("one", "One", appKeys(400, "a")),
          folder("two", "Two", appKeys(400, "b")),
          folder("three", "Three", appKeys(400, "c")),
        ],
      },
    },
    "1000 app keys",
  ],
  [
    "an app named twice",
    { layout: { v: 1, items: [app("a/b"), folder("tools", "Tools", ["a/b"])] } },
    '"a/b" twice',
  ],
  [
    "two folders with one id",
    { layout: { v: 1, items: [folder("tools", "A", ["a/b"]), folder("tools", "B", ["a/c"])] } },
    'two folders with the id "tools"',
  ],
];

describe("the App Center", { timeout: 30_000 }, () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let stranger: ReturnType<typeof apiClient>;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member")).cookie);
    stranger = apiClient(t.app, (await provisionUser(t.app, "stranger")).cookie);
    const project = await owner.post("/api/projects", { projectId: PROJECT, name: "home" });
    expect(project.status, await project.text()).toBe(201);
    const joined = await owner.post(`/api/projects/${PROJECT}/members`, { userId: "member" });
    expect(joined.status, await joined.text()).toBe(201);
    for (const [agentId, name] of [
      [LATER, "Aardvark"],
      [SWITCHER, "Switcher"],
      [BUILDER, "Builder"],
      [GALLERY, "Gallery"],
      [BAD_ICONS, "Bad icons"],
      [ICON_ROW, "Icon row"],
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
    await writeWorkbench(
      t.root,
      LATER,
      "stalled",
      packageJson({ tabs: [tab("stalled", "Stalled")], appCenter: { show: true } }),
      { ".build/status.json": JSON.stringify({ ok: false }) },
    );
    // The last load of these very files failed: the status names their revision.
    const held = await writeWorkbench(
      t.root,
      BUILDER,
      "held",
      packageJson({ tabs: [tab("main", "Held")], appCenter: { show: true } }),
      { "index.ts": HELD_HANDLER },
    );
    const { revision } = (await readFolder(held, "held"))!;
    await fs.mkdir(path.join(held, ".build"));
    await fs.writeFile(
      path.join(held, ".build", "status.json"),
      JSON.stringify({ ok: false, revision, error: "an earlier load failed" }),
    );
    for (const [id, icon, bytes] of ICONS) {
      const declared = packageJson({ appCenter: { show: true, icon } });
      await writeWorkbench(t.root, GALLERY, id, declared, { [icon]: bytes });
    }
    await writeWorkbench(
      t.root,
      GALLERY,
      "changing",
      packageJson({ appCenter: { show: true, icon: "ui/icon.png" } }),
      { "ui/icon.png": PNG },
    );
    for (const [id, icon, bytes] of BAD_ICONS_CASES) {
      const declared = packageJson({ appCenter: { show: true, icon } });
      await writeWorkbench(t.root, BAD_ICONS, id, declared, { [icon]: bytes });
    }
  }, 30_000);
  afterAll(async () => {
    await t.cleanup();
  });

  const appCenter = async (client = owner): Promise<AppCenterResponse> => {
    const res = await client.get(`/api/projects/${PROJECT}/app-center`);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as AppCenterResponse;
  };
  const shortcuts = async (): Promise<AppCenterShortcut[]> => (await appCenter()).shortcuts;
  const ids = async () => (await shortcuts()).map((s) => `${s.agentId}/${s.workbenchId}`);
  const shortcutOf = async (agentId: string, workbenchId: string) =>
    (await shortcuts()).find((s) => s.agentId === agentId && s.workbenchId === workbenchId);
  const iconRoute = (agentId: string, workbenchId: string) =>
    `/api/projects/${PROJECT}/agents/${agentId}/workbenches/${workbenchId}/app-center/icon`;
  /** The error code of a 404. */
  const notFound = async (client: ReturnType<typeof apiClient>, route: string) => {
    const res = await client.get(route);
    expect(res.status).toBe(404);
    return ((await res.json()) as { error: { code: string } }).error.code;
  };

  it("lists one shortcut per shown workbench, Agents in list order and titles in order within one, and compiles nothing to do it", async () => {
    const listed = (await shortcuts()).filter((s) => s.agentId === AGENT || s.agentId === LATER);
    const boardIcon = new RegExp(`^${iconRoute(AGENT, "board")}\\?rev=[0-9a-f]{12}$`);
    expect(listed).toEqual([
      {
        agentId: AGENT,
        agentName: expect.any(String),
        workbenchId: "crm",
        title: "Accounts",
        titleZh: "客户",
        path: `/app/${PROJECT}/${AGENT}/crm`,
        tab: "main",
        build: "ready",
      },
      {
        agentId: AGENT,
        agentName: expect.any(String),
        workbenchId: "board",
        title: "Board",
        titleZh: "看板",
        icon: { url: expect.stringMatching(boardIcon), tint: false },
        path: `/app/${PROJECT}/${AGENT}/board/stats`,
        tab: "stats",
        build: "ready",
      },
      {
        agentId: AGENT,
        agentName: expect.any(String),
        workbenchId: "headless",
        title: "headless-pkg",
        path: `/app/${PROJECT}/${AGENT}/headless`,
        build: "ready",
      },
      {
        agentId: LATER,
        agentName: "Aardvark",
        workbenchId: "notes",
        title: "Notes",
        path: `/app/${PROJECT}/${LATER}/notes`,
        tab: "notes",
        build: "failed",
        error: "index.ts:1:1 TS1005 ';' expected.",
      },
      {
        agentId: LATER,
        agentName: "Aardvark",
        workbenchId: "stalled",
        title: "Stalled",
        path: `/app/${PROJECT}/${LATER}/stalled`,
        tab: "stalled",
        build: "failed",
      },
    ]);
    // A workbench never loaded gains no build.
    const dir = path.join(agentStateDir(t.root, PROJECT, AGENT), "workbenches", "board");
    await expect(fs.stat(path.join(dir, ".build"))).rejects.toThrow();
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

  it("refuses the list to a user outside the Project", async () => {
    expect((await stranger.get(`/api/projects/${PROJECT}/app-center`)).status).toBe(404);
  });

  it("reads building while a load is under way, over a failed status, and ready once it ends; the start is announced once", async () => {
    const heard: ServerEvent[] = [];
    const unsubscribe = t.deps.channels.get(userChannelKey("owner")).subscribe((evt) => {
      if (evt.event === "server_event") heard.push(JSON.parse(evt.data) as ServerEvent);
    });
    let release = () => {};
    let entered = 0;
    const inside = new Promise<void>((resolve) => {
      gate.appCenterHold = {
        enter: () => {
          entered += 1;
          resolve();
        },
        done: new Promise<void>((done) => (release = done)),
      };
    });
    try {
      const reload = `/api/projects/${PROJECT}/agents/${BUILDER}/workbenches/held/reload`;
      // Two callers at once: the second shares the first one's load of the same files.
      const first = owner.post(reload);
      const second = owner.post(reload);
      await inside;
      const during = await shortcutOf(BUILDER, "held");
      expect(during?.build).toBe("building");
      expect(during?.error).toBeUndefined();

      release();
      const answers = await Promise.all([first, second]);
      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      const after = await shortcutOf(BUILDER, "held");
      expect(after?.build).toBe("ready");
      expect(entered).toBe(1);
      const building = heard.filter(
        (e) => e.type === "workbench_building" && e.agentId === BUILDER,
      );
      expect(building).toEqual([
        { type: "workbench_building", projectId: PROJECT, agentId: BUILDER, workbenchId: "held" },
      ]);
    } finally {
      release();
      delete gate.appCenterHold;
      unsubscribe();
    }
  });

  it.each(ICONS.map(([id, , bytes, type, tint]) => [id, bytes, type, tint] as const))(
    "serves a %s icon from its shortcut's URL, as the image its bytes are, kept for good",
    async (id, bytes, type, tint) => {
      const shortcut = await shortcutOf(GALLERY, id);
      expect(shortcut?.icon).toEqual({ url: expect.stringMatching(/\?rev=[0-9a-f]{12}$/), tint });
      const res = await owner.get(shortcut!.icon!.url);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(bytes));
      expect(Object.fromEntries(res.headers)).toMatchObject({
        "content-type": type,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "private, max-age=31536000, immutable",
      });
    },
  );

  describe("an icon that does not hold up", () => {
    let loaded: Promise<WorkbenchInfo[]> | undefined;
    /** One listing of the Agent's workbenches, which loads them and so names their hints. */
    const workbenches = () =>
      (loaded ??= (async () => {
        const res = await owner.get(`/api/projects/${PROJECT}/agents/${BAD_ICONS}/workbenches`);
        return ((await res.json()) as { workbenches: WorkbenchInfo[] }).workbenches;
      })());

    it.each(BAD_ICONS_CASES.map(([id, , , named]) => [id, named] as const))(
      "(%s) gives the workbench no shortcut, and its hints name the problem",
      async (id, named) => {
        const info = (await workbenches()).find((w) => w.id === id);
        expect(info?.appCenter).toBeUndefined();
        expect(info?.hints).toEqual([
          expect.stringMatching(/^package\.json#penguin\.appCenter is ignored: /),
        ]);
        expect(info!.hints[0]).toContain(named);
        expect(await ids()).not.toContain(`${BAD_ICONS}/${id}`);
        expect(await notFound(owner, iconRoute(BAD_ICONS, id))).toBe("icon_not_found");
      },
    );
  });

  it("gives an icon whose bytes change a new URL, which serves the new bytes", async () => {
    const before = (await shortcutOf(GALLERY, "changing"))!.icon!.url;
    const redrawn = Buffer.concat([PNG, Buffer.from("redrawn")]);
    const dir = path.join(agentStateDir(t.root, PROJECT, GALLERY), "workbenches", "changing");
    await fs.writeFile(path.join(dir, "ui", "icon.png"), redrawn);

    const after = (await shortcutOf(GALLERY, "changing"))!.icon!.url;
    expect(after).not.toBe(before);
    const fresh = await owner.get(after);
    expect(fresh.status).toBe(200);
    expect(Buffer.from(await fresh.arrayBuffer())).toEqual(redrawn);
  });

  it("names the declared icon on the workbench's own row, shown or not, at the URL its shortcut gets", async () => {
    await writeWorkbench(
      t.root,
      ICON_ROW,
      "badge",
      packageJson({
        tabs: [tab("main", "Badge")],
        appCenter: { show: false, icon: "ui/icon.svg" },
      }),
      { "index.ts": HANDLER, "ui/icon.svg": ICON },
    );
    const base = `/api/projects/${PROJECT}/agents/${ICON_ROW}/workbenches`;
    const listed = (await (await owner.get(base)).json()) as { workbenches: WorkbenchInfo[] };
    const icon = listed.workbenches.find((w) => w.id === "badge")?.icon;
    expect(icon).toEqual({
      url: expect.stringMatching(
        new RegExp(`^${iconRoute(ICON_ROW, "badge")}\\?rev=[0-9a-f]{12}$`),
      ),
      tint: false,
    });
    const served = await owner.get(icon!.url);
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(ICON);

    const res = await owner.patch(`${base}/badge/app-center`, { show: true });
    expect((await res.json()) as { workbench: WorkbenchInfo }).toMatchObject({
      workbench: { icon },
    });
    expect((await shortcutOf(ICON_ROW, "badge"))?.icon).toEqual(icon);
  });

  it("gives a switched-off workbench no tile, keeps its declaration on its row, and lets the App Center switch write it", async () => {
    const base = `/api/projects/${PROJECT}/agents/${ICON_ROW}/workbenches`;
    const off = await owner.put(`${base}/badge/enabled`, { enabled: false });
    expect(off.status, await off.clone().text()).toBe(200);
    expect(await ids()).not.toContain(`${ICON_ROW}/badge`);
    const listed = (await (await owner.get(base)).json()) as { workbenches: WorkbenchInfo[] };
    expect(listed.workbenches.find((w) => w.id === "badge")).toMatchObject({
      enabled: false,
      appCenter: { show: true, icon: "ui/icon.svg" },
      icon: { url: expect.stringContaining(iconRoute(ICON_ROW, "badge")), tint: false },
    });
    const hidden = await owner.patch(`${base}/badge/app-center`, { show: false });
    expect(hidden.status, await hidden.clone().text()).toBe(200);
    expect(((await hidden.json()) as { workbench: WorkbenchInfo }).workbench).toMatchObject({
      enabled: false,
      appCenter: { show: false },
    });

    expect((await owner.put(`${base}/badge/enabled`, { enabled: true })).status).toBe(200);
    expect((await owner.patch(`${base}/badge/app-center`, { show: true })).status).toBe(200);
    expect(await ids()).toContain(`${ICON_ROW}/badge`);
    // The Agent-wide switch takes every tile of the Agent off.
    expect((await owner.put(`${base}/enabled`, { enabled: false })).status).toBe(200);
    expect(await ids()).not.toContain(`${ICON_ROW}/badge`);
  });

  it("finds no icon for a workbench without one or an unknown workbench, and refuses a user outside the Project", async () => {
    expect(await notFound(owner, iconRoute(AGENT, "crm"))).toBe("icon_not_found");
    expect(await notFound(owner, iconRoute(AGENT, "nowhere"))).toBe("icon_not_found");
    expect(await notFound(stranger, iconRoute(GALLERY, "png"))).toBe("project_not_found");
  });

  describe("the viewer's arrangement", () => {
    const layoutRoute = `/api/projects/${PROJECT}/app-center/layout`;
    const storedPrefs = async () =>
      ((await (await owner.get("/api/me/prefs")).json()) as PrefsResponse).prefs;

    it("is answered to the viewer as stored, and not to another member", async () => {
      const res = await owner.put(layoutRoute, { layout: LAYOUT });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(((await res.json()) as AppCenterLayoutResponse).layout).toEqual(STORED);
      expect((await appCenter()).layout).toEqual(STORED);
      expect((await appCenter(member)).layout).toBeNull();
    });

    it.each(REFUSED)("refuses %s, naming the rule, and stores nothing", async (_, body, rule) => {
      const before = (await storedPrefs()).appCenterLayouts;
      const res = await owner.put(layoutRoute, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain(rule);
      expect((await storedPrefs()).appCenterLayouts).toEqual(before);
    });

    it("is not written through the prefs", async () => {
      const before = await storedPrefs();
      const res = await owner.put("/api/me/prefs", {
        theme: "dark",
        appCenterLayouts: { [PROJECT]: { v: 1, items: [] } },
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
        "/app-center/layout",
      );
      expect(await storedPrefs()).toEqual(before);
    });

    it("restores the server's order when null is stored", async () => {
      const res = await owner.put(layoutRoute, { layout: null });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ layout: null });
      expect((await appCenter()).layout).toBeNull();
    });

    it("reads as none when what is stored does not hold up, or the prefs do not parse", async () => {
      t.deps.prefsRepo.set(
        "owner",
        JSON.stringify({ appCenterLayouts: { [PROJECT]: { v: 1, items: [app("solo")] } } }),
      );
      expect((await appCenter()).layout).toBeNull();
      t.deps.prefsRepo.set("owner", "{ not json");
      expect((await appCenter()).layout).toBeNull();
    });

    it("lets go of the layouts of Projects that no longer exist on the next write, and of nothing else", async () => {
      t.deps.prefsRepo.set(
        "owner",
        JSON.stringify({
          theme: "dark",
          appCenterLayouts: { "gone-project": STORED, [PROJECT]: STORED },
        }),
      );
      const next = { v: 1, items: [app(`${AGENT}/crm`)] };
      expect((await owner.put(layoutRoute, { layout: next })).status).toBe(200);
      expect(await storedPrefs()).toEqual({ theme: "dark", appCenterLayouts: { [PROJECT]: next } });
    });
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
    expect(history.versions.map((v) => v.revision)).toEqual([workbench.revision, before!.revision]);
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
