/**
 * A shipped plugin's web half joins the app at build time (scripts/gen-web-table.mjs, web-root.ts)
 * and reaches the app only through its slots, drawn while its server module runs
 * (lib/module-gate.ts). The plugin here is test/fixtures/web-plugin: one web module contributing
 * to every slot a web half reaches, needing the server module `FixtureServerModule`.
 *
 * - Given the Web App depends on a package whose package.json exports `./web` and on one that
 *   does not, the generated list names the first alone, reading the entry through nested export
 *   conditions; a `./web` entry outside `src/web/`, or a listed dependency that is not
 *   installed, is refused, naming the package.
 * - A workspace plugin (a directory under `plugins/`, linked into node_modules as pnpm links it)
 *   is read from its own directory with the app's program, so the interface generator gets no
 *   second project for it — that second read fails the generator; only a plugin installed under
 *   node_modules is read through its own `tsconfig.web.json`.
 * - The generated list boots: the plugin's module joins the app's tree beside the app's own, its
 *   contributions checked against the same table.
 * - Until the server says its module runs, none of the plugin's contributions is drawn — no dock
 *   panel (a stored tab of its kind reads as unregistered), no Settings page, no link row, no
 *   layer — while the app's own (the terminal panel, the account page), which declare no server
 *   module, are unaffected; a server running other plugins' modules opens nothing for it.
 * - Once the server lists the module, all of it appears at once: the dock panel (leading the
 *   picker), the layer, the link row running the plugin's own action, and the Settings page in
 *   the rail at its order. When the server stops listing it, it goes again.
 * - What only keeps the plugin's own state in step — the conversation on screen, a full-screen
 *   step, a conversation's new id — reaches it whether or not its server module runs.
 * - Every other drawn slot waits too: the shell's pages leave the table, page renderers, Session
 *   tabs, file renderers, sidebar blocks, rail entries and marks draw nothing, a mode is not
 *   offered and a badge's note falls silent, session-row entries leave the menus and their marks
 *   go quiet — while a module that declares nothing is drawn as before. A gated module's session
 *   provider and sidebar scope, which wrap everything below them, are never mounted.
 * - Two contributors naming one Settings key, or offering a link row with one label: the first
 *   keeps it, the later one is dropped.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bootModules,
  type ClassCtx,
  type Contributed,
  type IfaceTable,
  type ManifestTable,
  type ModuleClass,
} from "@prismshadow/penguin-core/kernel";

import {
  pluginWebEntries,
  separateProjects,
  writePluginWebModules,
} from "../scripts/gen-web-table.mjs";
// The suite's own table: the app, its tests (the fixture plugin's module among them) and the
// shipped web halves. The app's table (src/ifaces.json) carries no test module.
import table from "./ifaces.json";
import type { PluginWebEntry } from "../src/plugin-web.gen";
import { webRootDef } from "../src/web-root";
import { WebAppModule } from "../src/web-app/module";
import {
  gatedPagesOf,
  gatesOf,
  layersOf,
  pageRenderersOf,
  sessionProvidersOf,
} from "../src/web-app/gated-slots";
import { gatedChatContributions } from "../src/features/chat/deps";
import { gatedBadges, gatedModes, gatedSections } from "../src/web-app/sidebar/gated";
import {
  gatedRowActions,
  rowExtensionsOf,
  shownRows,
} from "../src/features/session-list/row-actions";
import { pageTableOf } from "../src/web-app/page-table";
import { setRunningServerModules } from "../src/lib/module-gate";
import { visibleSettingsSections } from "../src/lib/settings-sections";
import { dockPanelDefinition, dockPanels } from "../src/features/dock/panel-registry";
import { announceDockLayout, announceDockScope } from "../src/features/dock/dock-listeners";
import {
  contributedSections,
  setContributedSections,
  shownSections,
} from "../src/features/settings/contributed-sections";
import { linkActionRows, setLinkActions } from "../src/features/chat/link-actions";
import { handOverSession } from "../src/features/chat/session-handover";
import { seen } from "./fixtures/web-plugin/src/web/module";

const FIXTURE = fileURLToPath(new URL("./fixtures/web-plugin", import.meta.url));
const HREF = "https://example.com/board";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A Web App directory depending on the fixture plugin and on `plain`, a package with no web half,
 * plus whatever `extra` lists; its node_modules holds the two.
 */
function webDirWith(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "web-plugins-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "node_modules", "@penguinharness"), { recursive: true });
  symlinkSync(FIXTURE, join(dir, "node_modules", "@penguinharness", "web-fixture"), "junction");
  mkdirSync(join(dir, "node_modules", "plain"));
  writeFileSync(
    join(dir, "node_modules", "plain", "package.json"),
    JSON.stringify({ name: "plain", exports: { ".": "./index.js" } }),
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "web",
      dependencies: { plain: "1.0.0", "@penguinharness/web-fixture": "0.0.0", ...extra },
    }),
  );
  return dir;
}

describe("the generated list of plugin web halves", () => {
  it("names the dependency that exports ./web, and no other", () => {
    expect(pluginWebEntries(webDirWith()).map((e) => [e.name, e.specifier])).toEqual([
      ["@penguinharness/web-fixture", "@penguinharness/web-fixture/web"],
    ]);
  });

  it("reads the entry through nested export conditions", () => {
    const dir = webDirWith({ nested: "1.0.0" });
    mkdirSync(join(dir, "node_modules", "nested"));
    writeFileSync(join(dir, "node_modules", "nested", "tsconfig.web.json"), "{}");
    writeFileSync(
      join(dir, "node_modules", "nested", "package.json"),
      JSON.stringify({
        name: "nested",
        exports: { "./web": { types: "./web.d.ts", import: { default: "./src/web/index.ts" } } },
      }),
    );
    expect(pluginWebEntries(dir).map((e) => e.name)).toEqual([
      "@penguinharness/web-fixture",
      "nested",
    ]);
  });

  it("reads a workspace plugin with the app's program, and only an installed one through its own project", () => {
    const root = mkdtempSync(join(tmpdir(), "web-workspace-"));
    dirs.push(root);
    /** A plugin package with a web half, its tsconfig.web.json beside it. */
    const plugin = (dir: string, name: string) => {
      mkdirSync(join(dir, "src", "web"), { recursive: true });
      writeFileSync(join(dir, "tsconfig.web.json"), "{}");
      writeFileSync(join(dir, "src", "web", "index.ts"), "export default { modules: [] };\n");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name, exports: { "./web": "./src/web/index.ts" } }),
      );
    };
    // The workspace plugin lives under plugins/ and is linked into the app's node_modules.
    plugin(join(root, "plugins", "board"), "@penguinharness/board");
    const web = join(root, "packages", "web");
    mkdirSync(join(web, "node_modules", "@penguinharness"), { recursive: true });
    symlinkSync(
      join(root, "plugins", "board"),
      join(web, "node_modules", "@penguinharness", "board"),
      "junction",
    );
    // The other one is a copy installed under node_modules, in no workspace.
    plugin(join(web, "node_modules", "installed-board"), "installed-board");
    writeFileSync(
      join(web, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { "@penguinharness/board": "workspace:*", "installed-board": "1.0.0" },
      }),
    );

    const entries = pluginWebEntries(web, { pluginsDir: join(root, "plugins") });
    expect(entries.map((e) => e.name)).toEqual(["@penguinharness/board", "installed-board"]);
    expect(entries[0]!.tsconfig).toBe(join(root, "plugins", "board", "tsconfig.web.json"));
    expect(separateProjects(entries).map((e) => e.name)).toEqual(["installed-board"]);
  });

  it("refuses a listed dependency that is not installed, naming it", () => {
    expect(() => pluginWebEntries(webDirWith({ missing: "1.0.0" }))).toThrow(
      /^missing: .*not installed/,
    );
  });

  it("refuses a web half outside src/web/, naming the package", () => {
    const dir = webDirWith({ stray: "1.0.0" });
    mkdirSync(join(dir, "node_modules", "stray"));
    writeFileSync(
      join(dir, "node_modules", "stray", "package.json"),
      JSON.stringify({ name: "stray", exports: { "./web": "./web.ts" } }),
    );
    expect(() => pluginWebEntries(dir)).toThrow(/^stray: .*src\/web\//);
  });
});

/** What the shell's slots received at boot. */
let layers: readonly Contributed[] = [];
let serverModules: readonly Contributed[] = [];

/** The fixture's layer as the shell mounts it (behind its gate), rendered. */
function fixtureLayer(): string {
  const mounted = layersOf(
    layers.map((c) => ({
      id: c.id,
      from: c.from,
      Component: c.code as ComponentType,
      area: "shell",
    })),
    gatesOf(serverModules),
  ).find((layer) => layer.id === "fixture.layer");
  return renderToStaticMarkup(createElement(mounted!.Component));
}

/** The rail a signed-in non-admin gets, with the contributed pages drawn now. */
function railKeys(): string[] {
  return visibleSettingsSections(
    { isAdmin: false, desktopMode: false, sessionVia: "password" },
    shownSections().map((c) => c.data),
  ).map((section) => section.key);
}

describe("a plugin's web half in the booted tree", () => {
  beforeAll(async () => {
    const dir = webDirWith();
    writePluginWebModules(dir);
    const generated = (await import(pathToFileURL(join(dir, "src", "plugin-web.gen.ts")).href)) as {
      pluginWebModules: readonly PluginWebEntry[];
    };
    // The shell's root needs a browser to render: a double keeps what its slots received and
    // runs the real setup for everything else (the gates among it).
    const webApp = Object.assign(new WebAppModule(), {
      setup(ctx: ClassCtx) {
        layers = ctx.contributions.layers ?? [];
        serverModules = ctx.contributions.serverModules ?? [];
        WebAppModule.prototype.setup.call(webApp, ctx);
      },
    });
    await bootModules(
      webRootDef(generated.pluginWebModules, {
        instances: new Map<ModuleClass, object>([[WebAppModule, webApp]]),
        manifests: table.modules as unknown as ManifestTable,
      }),
      {
        ifaces: table as unknown as IfaceTable,
        resources: { register: () => () => {}, claim: () => undefined },
      },
    );
  });

  it("boots the plugin's module beside the app's own", () => {
    expect(serverModules.map((c) => [c.from, c.data.module])).toEqual([
      ["FixtureWebModule", "FixtureServerModule"],
    ]);
    expect(contributedSections().map((c) => [c.from, c.data.key])).toEqual([
      ["FixtureWebModule", "fixtureBoard"],
    ]);
  });

  it("draws none of it until the server says its module runs, and leaves the app's own alone", () => {
    setRunningServerModules(null);
    expect(dockPanelDefinition("fixture.board")).toBeUndefined();
    expect(dockPanels().map((d) => d.id)).not.toContain("fixture.board");
    expect(linkActionRows(HREF)).toEqual([]);
    expect(fixtureLayer()).toBe("");
    expect(railKeys()).not.toContain("fixtureBoard");
    expect(dockPanelDefinition("terminal")).toBeDefined();
    expect(railKeys()).toContain("account");
    setRunningServerModules(["SomeOtherModule"]);
    expect(dockPanelDefinition("fixture.board")).toBeUndefined();
    expect(linkActionRows(HREF)).toEqual([]);
  });

  it("draws all of it once the server lists the module, and takes it away when it stops", () => {
    setRunningServerModules(["FixtureServerModule"]);
    const panel = dockPanelDefinition("fixture.board");
    expect(panel?.lead).toBe(true);
    expect(dockPanels().map((d) => d.id)).toContain("fixture.board");
    expect(fixtureLayer()).toBe("<p>fixture layer</p>");
    const rows = linkActionRows(HREF);
    expect(rows.map((r) => r.label)).toEqual(["Pin to board"]);
    rows[0]!.onSelect();
    expect(seen.pinned).toEqual([HREF]);
    // By its order (75): after the account page (60).
    const keys = railKeys();
    expect(keys.slice(keys.indexOf("account"))).toEqual(["account", "fixtureBoard"]);

    setRunningServerModules([]);
    expect(dockPanelDefinition("fixture.board")).toBeUndefined();
    expect(linkActionRows(HREF)).toEqual([]);
    expect(fixtureLayer()).toBe("");
    expect(railKeys()).not.toContain("fixtureBoard");
  });

  it("keeps the plugin's own state in step whether or not its module runs", async () => {
    setRunningServerModules(null);
    announceDockScope({ scope: "s-1", projectId: "p" });
    announceDockLayout();
    await handOverSession("p:new", "s-2");
    expect(seen.scopes).toEqual([{ scope: "s-1", projectId: "p" }]);
    expect(seen.layouts).toBe(1);
    expect(seen.handovers).toEqual([["p:new", "s-2"]]);
  });
});

describe("every drawn slot of a gated module", () => {
  const GATED = "FixtureWebModule";
  const PLAIN = "PlainModule";
  const Part = () => createElement("p", null, "part");
  const contributed = (from: string, id: string, data: Record<string, unknown>, code: unknown) =>
    ({ id, from, data, code }) as unknown as Contributed;
  const draw = (Component: ComponentType<object>, props: object = {}) =>
    renderToStaticMarkup(createElement(Component, props));

  it("leaves the shell's page out of the table, and blanks its page renderer", () => {
    const pages = [
      contributed(GATED, "board.page", { key: "board", path: "/board", order: 1 }, Part),
      contributed(PLAIN, "plain.page", { key: "plain", path: "/plain", order: 2 }, Part),
    ];
    const gates = gatesOf(serverModules);
    const marked = gatedPagesOf(pageTableOf(pages), pages, gates);
    expect(marked.map((p) => [p.key, p.gatedBy])).toEqual([
      ["board", GATED],
      ["plain", undefined],
    ]);
    const renderers = pageRenderersOf(
      [contributed(GATED, "board.renderer", { name: "Board" }, Part)],
      gates,
    );
    setRunningServerModules(null);
    expect(draw(renderers.get("Board")!)).toBe("");
    setRunningServerModules(["FixtureServerModule"]);
    expect(draw(renderers.get("Board")!)).toBe("<p>part</p>");
  });

  it("never mounts a gated module's session provider", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const providers = sessionProvidersOf(
      [
        { id: "board.provider", from: GATED, Component: Part },
        { id: "plain.provider", from: PLAIN, Component: Part },
      ],
      gatesOf(serverModules),
    );
    expect(providers.map((p) => p.id)).toEqual(["plain.provider"]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("blanks Session tabs and file renderers, sidebar blocks and marks, and leaves others drawn", () => {
    const [tab, plainTab] = gatedChatContributions([
      contributed(GATED, "board.tab", { order: 1 }, Part),
      contributed(PLAIN, "plain.tab", { order: 2 }, Part),
    ]);
    const [section] = gatedSections([
      contributed(GATED, "board.section", {}, { Full: Part, Rail: Part, Scope: Part }),
    ]);
    const [badge] = gatedBadges([
      contributed(GATED, "board.badge", {}, { Mark: Part, useNote: () => "new" }),
    ]);
    const full = (section!.code as { Full: ComponentType<object> }).Full;
    const mark = (badge!.code as { Mark: ComponentType<object> }).Mark;
    setRunningServerModules(null);
    expect([draw(tab!.code as ComponentType<object>), draw(full), draw(mark)]).toEqual([
      "",
      "",
      "",
    ]);
    expect(draw(plainTab!.code as ComponentType<object>)).toBe("<p>part</p>");
    setRunningServerModules(["FixtureServerModule"]);
    expect([draw(tab!.code as ComponentType<object>), draw(full), draw(mark)]).toEqual([
      "<p>part</p>",
      "<p>part</p>",
      "<p>part</p>",
    ]);
  });

  it("renders a gated section's children without its scope, whatever runs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Scope = ({ children }: { children?: ReactNode }) =>
      createElement("section", null, children);
    const [section] = gatedSections([
      contributed(GATED, "board.section", {}, { Full: Part, Scope }),
    ]);
    const gatedScope = (section!.code as { Scope: ComponentType<{ children: ReactNode }> }).Scope;
    setRunningServerModules(["FixtureServerModule"]);
    expect(renderToStaticMarkup(createElement(gatedScope, null, "column"))).toBe("column");
    warn.mockRestore();
  });

  it("stops offering a mode, silences a badge's note and a row's mark, and drops its entries", () => {
    const state = { available: true, current: false, select: () => null, navItems: [] };
    const [mode] = gatedModes([
      contributed(GATED, "board.mode", {}, { useMode: () => state, listName: () => "Board" }),
    ]);
    const [badge] = gatedBadges([contributed(GATED, "board.badge", {}, { useNote: () => "new" })]);
    const rows = rowExtensionsOf(
      gatedRowActions([
        contributed(
          GATED,
          "board.row",
          { order: 1 },
          {
            sessionEntry: { id: "pin", label: () => "Pin", icon: "pin", Dialog: Part },
            workspaceEntry: { id: "board", label: () => "Board", icon: "pin", run: () => {} },
            sessionMark: { kind: "relay", useLabel: () => () => "on the board" },
          },
        ),
        contributed(
          PLAIN,
          "plain.row",
          { order: 2 },
          {
            sessionEntry: { id: "plain", label: () => "Plain", icon: "pin", Dialog: Part },
          },
        ),
      ]),
    );
    /** What the hooks answer, read inside a render. */
    const read = () => {
      let out: unknown[] = [];
      const Probe = () => {
        out = [
          (mode!.code as { useMode(): { available: boolean } }).useMode().available,
          (badge!.code as { useNote(): string | null }).useNote(),
          rows.marks[0]!.useLabel()({} as never),
        ];
        return null;
      };
      renderToStaticMarkup(createElement(Probe));
      return out;
    };
    setRunningServerModules(null);
    expect(read()).toEqual([false, null, null]);
    expect(shownRows(rows).sessionEntries.map((e) => e.id)).toEqual(["plain"]);
    expect(shownRows(rows).workspaceEntries).toEqual([]);
    setRunningServerModules(["FixtureServerModule"]);
    expect(read()).toEqual([true, "new", "on the board"]);
    expect(shownRows(rows).sessionEntries.map((e) => e.id)).toEqual(["pin", "plain"]);
  });
});

describe("contributions that collide", () => {
  it("keeps the first Settings page of a key and the first link row of a label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const page = (from: string) => ({
      from,
      data: {
        key: "board",
        group: "personal",
        visibility: "everyone",
        icon: "puzzle",
        order: 1,
      } as const,
      code: { label: () => from, Body: () => null },
    });
    setContributedSections([page("FirstModule"), page("SecondModule")]);
    expect(contributedSections().map((c) => c.from)).toEqual(["FirstModule"]);
    const link = (label: string, onSelect: () => void) => ({
      row: () => ({ glyph: "", label, onSelect }),
      subscribe: () => () => {},
    });
    const first = vi.fn();
    setLinkActions([
      { action: link("Pin", first), from: "FirstModule" },
      { action: link("Pin", vi.fn()), from: "SecondModule" },
    ]);
    const rows = linkActionRows(HREF);
    expect(rows).toHaveLength(1);
    rows[0]!.onSelect();
    expect(first).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
