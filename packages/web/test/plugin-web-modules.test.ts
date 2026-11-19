/**
 * A shipped plugin's web half joins the app at build time (scripts/gen-web-table.mjs, web-root.ts)
 * and reaches the app only through its slots, drawn while its server module runs
 * (lib/module-gate.ts). The plugin here is test/fixtures/web-plugin: one web module contributing
 * to every slot a web half reaches, needing the server module `FixtureServerModule`.
 *
 * - Given the Web App depends on a package whose package.json exports `./web` and on one that
 *   does not, the generated list names the first alone; a `./web` entry outside `src/web/` is
 *   refused, naming the package.
 * - The generated list boots: the plugin's module joins the app's tree beside the app's own, its
 *   contributions checked against the same table.
 * - Until the server says its module runs, none of the plugin's contributions is drawn — no dock
 *   panel (a stored tab of its kind reads as unregistered), no Settings page, no link row, no
 *   layer — while the built-in browser, which declares no server module, is unaffected; a server
 *   running other plugins' modules opens nothing for it.
 * - Once the server lists the module, all of it appears at once: the dock panel (leading the
 *   picker), the layer, the link row running the plugin's own action, and the Settings page in
 *   the rail at its order. When the server stops listing it, it goes again.
 * - What only keeps the plugin's own state in step — the conversation on screen, a full-screen
 *   step, a conversation's new id — reaches it whether or not its server module runs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  bootModules,
  type ClassCtx,
  type Contributed,
  type IfaceTable,
  type ModuleClass,
} from "@prismshadow/penguin-core/kernel";

import { pluginWebEntries, writePluginWebModules } from "../scripts/gen-web-table.mjs";
import table from "../src/ifaces.json";
import type { PluginWebEntry } from "../src/plugin-web.gen";
import { webRootDef } from "../src/web-root";
import { WebAppModule } from "../src/web-app/module";
import { gatesOf, layersOf } from "../src/web-app/gated-layers";
import { setRunningServerModules } from "../src/lib/module-gate";
import { visibleSettingsSections } from "../src/lib/settings-sections";
import { dockPanelDefinition, dockPanels } from "../src/features/dock/panel-registry";
import { announceDockLayout, announceDockScope } from "../src/features/dock/dock-listeners";
import { contributedSections, shownSections } from "../src/features/settings/contributed-sections";
import { linkActionRows } from "../src/features/chat/link-actions";
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
    layers.map((c) => ({ id: c.id, from: c.from, Component: c.code as ComponentType })),
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
      webRootDef(
        generated.pluginWebModules,
        new Map<ModuleClass, object>([[WebAppModule, webApp]]),
      ),
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
      ["BuiltinBrowserModule", "browser"],
      ["BuiltinBrowserModule", "chromeExtension"],
      ["FixtureWebModule", "fixtureBoard"],
    ]);
  });

  it("draws none of it until the server says its module runs, and leaves the browser alone", () => {
    setRunningServerModules(null);
    expect(dockPanelDefinition("fixture.board")).toBeUndefined();
    expect(dockPanels().map((d) => d.id)).not.toContain("fixture.board");
    expect(linkActionRows(HREF)).toEqual([]);
    expect(fixtureLayer()).toBe("");
    expect(railKeys()).not.toContain("fixtureBoard");
    expect(dockPanelDefinition("builtin-browser")).toBeDefined();
    expect(railKeys()).toContain("browser");
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
    // By its order: after the account page (60) and the browser's own (70).
    const keys = railKeys();
    expect(keys.slice(keys.indexOf("account"))).toEqual(["account", "browser", "fixtureBoard"]);

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
