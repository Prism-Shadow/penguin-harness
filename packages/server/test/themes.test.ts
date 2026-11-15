/**
 * Theme packs over HTTP (`/api/themes`, PRFC-0026): an admin imports per server, every account
 * lists, loads and exports. The server's Web App build is a folder carrying the UI package's own
 * Frost (the base), as the UI package's Vite plugin writes it.
 *
 * - Given a member, they list the packs, load a pack's files and export it, and every write they
 *   try is refused `403 admin_required` without touching the store.
 * - Given an admin's import, it answers the pack with its stylesheet's address, serves that
 *   stylesheet and its drawing with the served-file headers, and tells every signed-in tab.
 * - Given the app's compiled stylesheet (Tailwind's layers, then the theme's four), a pack's served
 *   stylesheet linked before it, as the pre-paint script links it after a reload, or after it, as
 *   a live switch does, leaves the layer order the app sheet alone sets.
 * - Given a new build whose sheet sets another layer order, every pack is listed and served at a
 *   new address with the new order in front, and the stored file is untouched: the order is the
 *   build's, never the pack's. Back on the first build, the first address returns.
 * - Given an id already installed, an import is `409 theme_exists` and changes nothing; with
 *   `replace=1` it replaces the pack at a new version, and one upload is kept.
 * - Given a built-in pack's id, an import is `400 theme_id_reserved` and a removal
 *   `400 theme_builtin`; an id nothing installed is `404`.
 * - Given a pack the validator refuses, the import is `400 theme_invalid` naming the file, line,
 *   column and reason, and nothing is stored.
 * - Given a pack for a newer theme API, `422`; an upload past 16 MiB, `413`; a build carrying no
 *   pack sources to check against, `503`.
 * - Given a pack breaking the clean baseline — one scenario per rule family the UI package's table
 *   checks: decoration off its homes, texture behind text, a painting pseudo-element off its home,
 *   a state rule setting more than colour, fill, weight or opacity, a per-element font size, a
 *   shadow on a boxed host, a chart filter, a dark-only recipe, an animation off the live homes —
 *   the import is `400 theme_invalid` naming the rule, and nothing is stored; a pack decorating,
 *   edging and moving only in the allowed homes imports.
 * - Given a path the pack's installed.json does not list — its manifest, its readme, its record,
 *   or a way out of its folder — the files route answers `404`.
 * - Given an installed pack exported and imported again, the stored files are identical, and so
 *   are they when the kept upload is gone and the export zips what is stored.
 * - Given Frost exported, its recipes stay with the base and its README says so; imported as it
 *   is, it is refused as reserved, and with nothing changed but its id — in pack.json and in the
 *   selectors — it imports, clean baseline and all.
 * - Given the desktop app, the person at it is the admin and may import.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { readPackArchive, type ThemePackManifest } from "@prismshadow/penguin-theme-pack";
import type { ServerEvent, ThemePackImportResponse, ThemePacksResponse } from "../src/api/types.js";
import { userChannelKey } from "../src/http/routes/events.js";
import {
  apiClient,
  createDesktopApp,
  createTestApp,
  desktopLoginCookie,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  type TestApp,
} from "./helpers.js";

const text = (value: string) => new TextEncoder().encode(value);
const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

/** A small pack's manifest, the template the scenarios' packs are made from. */
const PACK_MANIFEST = {
  api: 1,
  id: "modern",
  names: { zh: "白领", en: "Frost" },
  version: "1.0.0",
  base: "modern",
  modes: ["light", "dark"],
  swatches: {
    light: { canvas: "#fafafa", ink: "#232527", accent: "#232527" },
    dark: { canvas: "#1b1c1e", ink: "#e4e4e5", accent: "#f5f5f6" },
  },
  accent: { own: { light: "#232527", dark: "#f5f5f6" }, presets: [] },
  fonts: {
    sans: "MiSans",
    ui: "MiSans",
    mono: "JetBrains Mono Variable",
    cjk: "MiSans",
    display: "MiSans",
  },
};
/** The UI package's Frost: the base pack every served build carries. */
const FROST_DIR = path.resolve(import.meta.dirname, "../../ui/src/themes/modern");

/**
 * A served build's files carrying Frost's sources, as the UI package's Vite plugin writes them
 * (Frost has no fonts of its own, so its fonts.json maps none): the contract an import is checked
 * against, and the Frost an export hands out.
 */
async function servedBuild(): Promise<string> {
  const dir = await makeTempRoot();
  await fsp.cp(FROST_DIR, path.join(dir, "themes", "modern"), { recursive: true });
  await fsp.writeFile(path.join(dir, "themes", "modern", "fonts.json"), "{}\n");
  await fsp.mkdir(path.join(dir, "assets"));
  await fsp.writeFile(path.join(dir, "assets", "index-x1.css"), APP_SHEET);
  await fsp.writeFile(path.join(dir, "index.html"), APP_PAGE);
  return dir;
}

/**
 * The app's compiled stylesheet, in the shape a build leaves it: Tailwind's layers first, then
 * the theme's four, in the order theme.css names them.
 */
const APP_SHEET =
  "/*! tailwindcss */@layer properties{@supports (x:y){*{--tw-x:0}}}@layer theme{:root{--color-white:#fff}}" +
  "@layer base{*{margin:0}}@layer components;@layer utilities{.p-1{padding:1px}}" +
  "@layer ui-base{:root{--ui-canvas:#fafafa}}@layer ui-theme{}@layer ui-accent{}@layer ui-font{}";

/** The page that links it, after a pre-paint script whose pack link is a string, not a sheet. */
const APP_PAGE =
  "<!doctype html><html><head><script>document.write('<link rel=\"stylesheet\" href=\"/api/themes/'+t+'/files/index.css\">')</script>" +
  '<link rel="stylesheet" crossorigin href="/assets/index-x1.css"></head><body></body></html>';

/**
 * The layers a set of stylesheets names, in the page's order of first mention — what fixes their
 * priority: statements, blocks and imports into a layer count, comments do not (the same reading
 * the UI package's layer-order test makes of an entry sheet).
 */
function layerMentions(...sheets: string[]): string[] {
  const seen: string[] = [];
  const mention = /@layer\s+([^{;]+)[{;]|@import\s[^;]*?\blayer\(\s*([\w.-]+)\s*\)/g;
  for (const css of sheets) {
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(mention)) {
      const names = match[1] !== undefined ? match[1].split(",") : [match[2]!];
      for (const name of names.map((n) => n.trim())) {
        if (name !== "" && !seen.includes(name)) seen.push(name);
      }
    }
  }
  return seen;
}

const MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 4h8" stroke="currentColor"/></svg>';

/** A small pack: paper tokens, one recipe drawing its art, a readme. */
function packFiles(
  id: string,
  overrides: Record<string, string | null> = {},
): Record<string, string> {
  const files: Record<string, string | null> = {
    "pack.json": JSON.stringify({
      ...PACK_MANIFEST,
      id,
      names: { zh: "纸页", en: "Paper" },
      fonts: { ...PACK_MANIFEST.fonts },
    }),
    "tokens.css": `:root[data-theme="${id}"] { --ui-canvas: #f6f1e7; }\n:root[data-theme="${id}"].dark { --ui-canvas: #1c1a17; }\n`,
    // A drawing in a decoration home: the frosted layer.
    "recipes.css": `:root[data-theme="${id}"] .ui-glass[role="menu"] { background-image: url("art/mark.svg"); }\n`,
    "art/mark.svg": MARK_SVG,
    "README.md": "# Paper\n",
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(files).filter((entry): entry is [string, string] => entry[1] !== null),
  );
}

const zipOf = (files: Record<string, string>, folder = "") =>
  zipSync(
    Object.fromEntries(Object.entries(files).map(([rel, body]) => [`${folder}${rel}`, text(body)])),
  );

describe("theme packs", () => {
  let t: TestApp;
  let webDist: string;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let memberId: string;

  const themesDir = () => path.join(t.root, "themes");
  /** Every stored file of a pack, by path, its install record left out. */
  async function stored(id: string): Promise<Map<string, string>> {
    const dir = path.join(themesDir(), id);
    const out = new Map<string, string>();
    for (const entry of await fsp.readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const abs = path.join(entry.parentPath, entry.name);
      const rel = path.relative(dir, abs).split(path.sep).join("/");
      if (rel !== "installed.json") out.set(rel, await fsp.readFile(abs, "utf8"));
    }
    return out;
  }
  /** The server events a user's channel carries from now on. */
  function inbox(userId: string): ServerEvent[] {
    const events: ServerEvent[] = [];
    t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
      if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
    });
    return events;
  }
  async function imported(id: string, files = packFiles(id)): Promise<ThemePackImportResponse> {
    const res = await admin.upload("/api/themes", zipOf(files, `${id}/`));
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as ThemePackImportResponse;
  }

  beforeAll(async () => {
    webDist = await servedBuild();
    t = await createTestApp({ config: { webDist } });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const signedIn = await provisionUser(t.app, "reader");
    member = apiClient(t.app, signedIn.cookie);
    memberId = signedIn.user.userId;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("lets a member list, load and export, and refuses their writes without touching the store", async () => {
    const { theme } = await imported("paper-read");
    const before = await stored("paper-read");
    const list = (await (await member.get("/api/themes")).json()) as ThemePacksResponse;
    expect(list.themes.map((pack) => pack.id)).toContain("paper-read");
    expect((await member.get(theme.href)).status).toBe(200);
    expect((await member.get("/api/themes/paper-read/export")).status).toBe(200);
    for (const res of [
      await member.upload("/api/themes", zipOf(packFiles("paper-other"))),
      await member.upload("/api/themes?replace=1", zipOf(packFiles("paper-read"))),
      await member.delete("/api/themes/paper-read"),
    ]) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("admin_required");
    }
    expect(fs.existsSync(path.join(themesDir(), "paper-other"))).toBe(false);
    expect(await stored("paper-read")).toEqual(before);
  });

  it("answers an import with the pack, serves its files with their headers, and tells every tab", async () => {
    const adminEvents = inbox("admin");
    const memberEvents = inbox(memberId);
    const { theme } = await imported("paper-serve");
    expect(theme).toMatchObject({ id: "paper-serve", base: "modern", names: { en: "Paper" } });
    expect(theme.href).toBe(`/api/themes/paper-serve/files/index.css?v=${theme.v}`);
    for (const events of [adminEvents, memberEvents]) {
      expect(events.filter((e) => e.type === "themes_changed")).toHaveLength(1);
    }
    const css = await admin.get(theme.href);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(css.headers.get("x-content-type-options")).toBe("nosniff");
    expect(css.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(css.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(css.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const body = await css.text();
    expect(body).toContain("@layer ui-theme{");
    // A drawing is addressed by the pack's content alone: its bytes are no build's.
    const art = /url\((\/api\/themes\/paper-serve\/files\/art\/mark\.svg\?v=[0-9a-f]{8})\)/.exec(
      body,
    )?.[1];
    expect(art).toBeDefined();
    const svg = await admin.get(art!);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    expect(await svg.text()).toBe(MARK_SVG);
  });

  it("serves a stylesheet that, linked before the app's own after a reload, leaves the app's layer order", async () => {
    const { theme } = await imported("paper-layers");
    const pack = await (await member.get(theme.href)).text();
    const appAlone = layerMentions(APP_SHEET);
    expect(appAlone).toEqual([
      "properties",
      "theme",
      "base",
      "components",
      "utilities",
      "ui-base",
      "ui-theme",
      "ui-accent",
      "ui-font",
    ]);
    // The pre-paint script writes the pack's link first; a live switch appends it after.
    expect(layerMentions(pack, APP_SHEET)).toEqual(appAlone);
    expect(layerMentions(APP_SHEET, pack)).toEqual(appAlone);
  });

  it("serves the order a new build sets at a new address, and leaves what is stored as it was", async () => {
    const { theme: before } = await imported("paper-rebuilt");
    const kept = path.join(themesDir(), "paper-rebuilt", "index.css");
    const keptBytes = await fsp.readFile(kept);
    expect(layerMentions(keptBytes.toString())).toEqual(["ui-theme"]);
    // A new Web App build whose sheet names one more layer first, under a new content-named file.
    const rebuilt = `@layer reset{*{box-sizing:border-box}}${APP_SHEET}`;
    await fsp.writeFile(path.join(webDist, "assets", "index-x2.css"), rebuilt);
    await fsp.writeFile(path.join(webDist, "index.html"), APP_PAGE.replace("index-x1", "index-x2"));
    try {
      const list = (await (await member.get("/api/themes")).json()) as ThemePacksResponse;
      const after = list.themes.find((pack) => pack.id === "paper-rebuilt")!;
      expect(after.v).not.toBe(before.v);
      expect(after.href).toBe(`/api/themes/paper-rebuilt/files/index.css?v=${after.v}`);
      const pack = await (await member.get(after.href)).text();
      expect(layerMentions(pack, rebuilt)).toEqual(layerMentions(rebuilt));
      expect(layerMentions(rebuilt)[0]).toBe("reset");
      expect(await fsp.readFile(kept)).toEqual(keptBytes);
    } finally {
      await fsp.writeFile(path.join(webDist, "index.html"), APP_PAGE);
    }
    const restored = (await (await member.get("/api/themes")).json()) as ThemePacksResponse;
    expect(restored.themes.find((pack) => pack.id === "paper-rebuilt")?.v).toBe(before.v);
  });

  it("refuses an installed id unless replace=1, which serves it at a new version and keeps one upload", async () => {
    const { theme: first } = await imported("paper-swap");
    const before = await stored("paper-swap");
    const again = await admin.upload("/api/themes", zipOf(packFiles("paper-swap")));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { details: unknown } }).error.details).toEqual({
      themeId: "paper-swap",
    });
    expect(await stored("paper-swap")).toEqual(before);

    const changed = packFiles("paper-swap", {
      "tokens.css": ':root[data-theme="paper-swap"] { --ui-canvas: #eeeeee; }\n',
    });
    const res = await admin.upload("/api/themes?replace=1", zipOf(changed));
    expect(res.status).toBe(201);
    const { theme: second } = (await res.json()) as ThemePackImportResponse;
    expect(second.v).not.toBe(first.v);
    expect(await (await admin.get(second.href)).text()).toContain("#eee");
    const list = (await (await admin.get("/api/themes")).json()) as ThemePacksResponse;
    expect(list.themes.filter((pack) => pack.id === "paper-swap")).toEqual([second]);
    const archives = fs
      .readdirSync(path.join(themesDir(), "archives"))
      .filter((name) => name.startsWith("paper-swap-"));
    expect(archives).toHaveLength(1);
  });

  it("refuses a built-in id on import and on removal, and answers 404 for an id nothing installed", async () => {
    const reserved = await admin.upload("/api/themes", zipOf(packFiles("modern")));
    expect(reserved.status).toBe(400);
    expect(((await reserved.json()) as { error: { code: string } }).error.code).toBe(
      "theme_id_reserved",
    );
    const builtin = await admin.delete("/api/themes/modern");
    expect(((await builtin.json()) as { error: { code: string } }).error.code).toBe(
      "theme_builtin",
    );
    expect((await admin.delete("/api/themes/nothing-here")).status).toBe(404);
    expect((await admin.get("/api/themes/nothing-here/export")).status).toBe(404);
  });

  it("refuses a pack the validator refuses, naming where, and stores nothing", async () => {
    const res = await admin.upload(
      "/api/themes",
      zipOf(
        packFiles("paper-bad", {
          "recipes.css": `\n:root[data-theme="paper-bad"] .ui-edge { color: red !important; }\n`,
        }),
      ),
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as {
      error: { code: string; details: Record<string, string> };
    };
    expect(error.code).toBe("theme_invalid");
    expect(error.details).toMatchObject({
      file: "recipes.css",
      line: "2",
      reason: "!important is refused",
    });
    expect(error.details.column).toMatch(/^\d+$/);
    expect(fs.existsSync(path.join(themesDir(), "paper-bad"))).toBe(false);
    const list = (await (await admin.get("/api/themes")).json()) as ThemePacksResponse;
    expect(list.themes.some((pack) => pack.id === "paper-bad")).toBe(false);
  });

  it("answers 422 for a newer theme API, 413 past 16 MiB, and 503 when the build carries no pack sources", async () => {
    const newer = packFiles("paper-new", {
      "pack.json": JSON.stringify({ ...PACK_MANIFEST, id: "paper-new", api: 2 }),
    });
    expect((await admin.upload("/api/themes", zipOf(newer))).status).toBe(422);
    const big = new Uint8Array(16 * 1024 * 1024 + 1);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    const tooLarge = await admin.upload("/api/themes", big);
    expect(tooLarge.status).toBe(413);
    expect(((await tooLarge.json()) as { error: { code: string } }).error.code).toBe(
      "theme_too_large",
    );
    const sources = path.join(webDist, "themes");
    await fsp.rename(sources, `${sources}.off`);
    try {
      const unavailable = await admin.upload("/api/themes", zipOf(packFiles("paper-later")));
      expect(unavailable.status).toBe(503);
    } finally {
      await fsp.rename(`${sources}.off`, sources);
    }
  });

  /** `rules` with each `:root` scoped to the pack `id`. */
  const scoped = (id: string, rules: string) =>
    rules.replace(/:root(?=[ .])/g, `:root[data-theme="${id}"]`);
  it.each([
    [
      "decoration outside its homes",
      "R1",
      ":root .ui-card { background-image: linear-gradient(#fff, #eee); }",
    ],
    [
      "texture behind text",
      "R1",
      ':root .ui-message [data-slot="body"] { background-image: url("art/mark.svg"); }',
    ],
    [
      "a painting pseudo-element outside its hook's home",
      "R5",
      ':root .ui-row::before { content: "•"; color: #888; }',
    ],
    [
      "a state rule setting more than colour, fill, weight or opacity",
      "R6",
      ':root .ui-row[data-state="done"] { text-decoration: underline; }',
    ],
    ["a per-element font size", "R7", ":root .ui-row { font-size: 15px; }"],
    ["a shadow on a boxed host", "R8", ":root .ui-frame { box-shadow: 0 1px 2px #0003; }"],
    ["a filter on a chart mark", "R9", ":root .ui-chart path { filter: blur(1px); }"],
    ["a dark-only recipe", "R10", ":root.dark .ui-row { color: #eee; }"],
    [
      "an animation outside the live homes",
      "R11",
      ":root .ui-row { animation: rule-wobble 1s infinite; }",
    ],
  ])(
    "refuses a pack breaking the clean baseline with %s (%s), naming the rule",
    async (_name, rule, css) => {
      const id = `clean-${rule.toLowerCase()}-${css.length}`;
      const res = await admin.upload(
        "/api/themes",
        zipOf(packFiles(id, { "recipes.css": scoped(id, css) })),
      );
      expect(res.status).toBe(400);
      const { error } = (await res.json()) as {
        error: { code: string; details: Record<string, string> };
      };
      expect(error.code).toBe("theme_invalid");
      expect(error.details).toMatchObject({ file: "recipes.css" });
      expect(error.details.reason?.startsWith(`${rule}, `)).toBe(true);
      expect(fs.existsSync(path.join(themesDir(), id))).toBe(false);
    },
  );

  it("accepts a pack that decorates, edges and moves only in the homes the baseline allows", async () => {
    const id = "clean-homes";
    const recipes = scoped(
      id,
      [
        ':root .ui-glass[role="menu"] { background-image: url("art/mark.svg"); }',
        ":root .ui-row:focus-visible { outline: 2px solid var(--ui-canvas); }",
        ":root .ui-live { animation: clean-homes-pulse 1s infinite; }",
        ':root .ui-row[data-state="done"] { color: #2b2521; font-weight: 600; }',
        ":root .ui-row { border-radius: 6px; }",
        ":root.dark .ui-row { border-radius: 4px; }",
        "@keyframes clean-homes-pulse { to { opacity: 0.6; } }",
      ].join("\n"),
    );
    const { theme } = await imported(id, packFiles(id, { "recipes.css": recipes }));
    expect(theme.id).toBe(id);
  });

  it.each([
    "pack.json",
    "README.md",
    "installed.json",
    "tokens.css",
    "../paper-files/installed.json",
    "%2e%2e/archives",
    "art/../installed.json",
  ])("serves no %s from a pack's folder", async (rel) => {
    if (!fs.existsSync(path.join(themesDir(), "paper-files"))) await imported("paper-files");
    expect((await member.get(`/api/themes/paper-files/files/${rel}`)).status).toBe(404);
  });

  it("stores the same files when an export is imported again, kept upload or not", async () => {
    await imported("paper-trip");
    const original = await stored("paper-trip");
    const exported = new Uint8Array(
      await (await admin.get("/api/themes/paper-trip/export")).arrayBuffer(),
    );
    expect((await admin.delete("/api/themes/paper-trip")).status).toBe(204);
    expect((await admin.upload("/api/themes", exported)).status).toBe(201);
    expect(await stored("paper-trip")).toEqual(original);

    for (const name of fs.readdirSync(path.join(themesDir(), "archives"))) {
      if (name.startsWith("paper-trip-")) fs.rmSync(path.join(themesDir(), "archives", name));
    }
    const fresh = new Uint8Array(
      await (await admin.get("/api/themes/paper-trip/export")).arrayBuffer(),
    );
    expect((await admin.upload("/api/themes?replace=1", fresh)).status).toBe(201);
    expect(await stored("paper-trip")).toEqual(original);
  });

  it("exports Frost refused as it is, and imports it once its id alone is renamed", async () => {
    // The Frost the served build carries, as the UI package ships it.
    const frost = JSON.parse(
      await fsp.readFile(path.join(FROST_DIR, "pack.json"), "utf8"),
    ) as ThemePackManifest;
    const res = await member.get("/api/themes/modern/export");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="modern-${frost.version}.zip"`,
    );
    const zip = new Uint8Array(await res.arrayBuffer());
    const files = readPackArchive(zip);
    // The recipes stay with the base, and the README says so.
    expect(files.has("recipes.css")).toBe(false);
    expect(decode(files.get("README.md"))).toContain('"base": "modern"');
    expect(decode(files.get("tokens.css"))).toContain(':root[data-theme="modern"]');
    expect((await admin.upload("/api/themes", zip)).status).toBe(400);

    // What the person does, and nothing more: the id in pack.json, and the same id in the
    // selectors.
    const renamed: Record<string, string> = {};
    for (const [rel, bytes] of files) {
      renamed[rel] = decode(bytes).replaceAll('[data-theme="modern"]', '[data-theme="mine"]');
    }
    renamed["pack.json"] = renamed["pack.json"]!.replace('"id": "modern"', '"id": "mine"');
    const upload = await admin.upload("/api/themes", zipOf(renamed, "mine/"));
    expect(upload.status, await upload.clone().text()).toBe(201);
    const { theme } = (await upload.json()) as ThemePackImportResponse;
    expect(theme).toMatchObject({ id: "mine", base: "modern", names: frost.names });
  });
});

describe("theme packs on the desktop app", () => {
  it("lets the person at the app import, as its admin", async () => {
    const desktop = await createDesktopApp({ config: { webDist: await servedBuild() } });
    try {
      const client = apiClient(desktop.app, await desktopLoginCookie(desktop.app));
      expect((await client.upload("/api/themes", zipOf(packFiles("desk-paper")))).status).toBe(201);
    } finally {
      await desktop.cleanup();
    }
  });
});
