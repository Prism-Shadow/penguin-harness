/**
 * @penguinharness/pet-live2d-coopanion — the pet's Coopanion figure driver.
 *
 * A PLUGIN PACKAGE, not part of the platform, and NOT a copy of Coopanion: it draws the
 * pet with a Coopanion figure pack loaded AT RUN TIME from a Coopanion installation the
 * operator names in the settings. Nothing from the Coopanion repository — no kit module,
 * no figure pack, no texture, no line of its code — is in this package, this repository,
 * or anything either ships; what this package owns is the bridge below (~a screenful):
 *
 *   - it reads the pack's own `figure.json` (api 2: `entry` + `export`), dynamically
 *     imports the entry from the installation through a served URL, and calls the export
 *     with the kit the SAME installation provides (the pack frame's own contract — the
 *     kit's `createBody`, the figure's `createWhaleBody`, are Coopanion's, loaded from
 *     Coopanion's files);
 *   - it translates what that body answers (the kit body contract Coopanion's own frame
 *     calls) onto the pet package's figure contract (plugins/pet/ui/figure/contract.js);
 *   - it serves the installation's pack directory over this package's own route, the way
 *     the Cubism driver serves a model pack: a safe relative path, symlinks resolved on
 *     both sides, regular files only.
 *
 * Coopanion is AGPL-3.0-or-later and stays exactly where it is: loading a program from
 * where it is installed is running it, not redistributing it, and this package makes no
 * copy to license. The settings name the installation's
 * `packages/cortico-world-desktop-pet` directory (its `web/` is what a figure pack loads:
 * `kit/` beside `whale/`, or whatever pack the configuration picks).
 */
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import { Hono } from "hono";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** The settings group this driver declares (its contribution id), read by the routes. */
export const COOPANION_GROUP = "pet-live2d-coopanion";

/**
 * What this driver requires of plugin configuration: to read the group it declares. The
 * interface is the consumer's own, so the package depends on no harness type.
 */
@Interface()
export abstract class CoopanionConfigReader {
  abstract get(name: string): Record<string, unknown>;
}

/** The driver's settings, as the routes read them. */
export interface CoopanionSettings {
  /**
   * Absolute directory of a Coopanion figure pack (the desktop-pet package's `web/` on an
   * installation of Coopanion, or a pack directory laid out the same way); empty = none.
   */
  packDir: string;
}

/** Reads the group's stored values onto the declared defaults. */
export function settingsOf(config: Record<string, unknown> | undefined): CoopanionSettings {
  const stored = config?.[COOPANION_GROUP];
  const dir =
    typeof stored === "object" && stored !== null
      ? (stored as Record<string, unknown>).packDir
      : undefined;
  return { packDir: typeof dir === "string" ? dir : "" };
}

/**
 * The plugin's one module: the card and the settings group, and the routes that serve the
 * named installation's pack files. Created per App, so a settings edit and a hot swap get
 * fresh routes.
 */
@Component({
  contributes: {
    // How the Plugins page shows this driver (read from ifaces.json, never by booting it).
    "PluginLibraryModule.cards": [
      {
        id: "pet-live2d-coopanion.card",
        title: "Pet · Coopanion",
        titleZh: "宠物 · Coopanion",
        descriptionZh:
          "用 Coopanion 的形象包画宠物：运行时从本机安装的 Coopanion 加载，本插件不携带、不复制其任何代码或资源。",
        shortDescription: "Draw the pet with a Coopanion figure pack from your installation.",
        shortDescriptionZh: "用本机安装的 Coopanion 形象包画宠物。",
        category: "pet",
        icon: "icon.svg",
        preinstall: false,
      },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "pet-live2d-coopanion",
        parent: "pet",
        title: "Coopanion",
        properties: {
          packDir: {
            type: "string",
            title: "Coopanion figure pack directory",
            titleZh: "Coopanion 形象包目录",
            description:
              "An absolute path to the `web/` directory of the cortico-world-desktop-pet package in your Coopanion installation (a directory with figure.json, kit/ and a pack). Loaded at run time from where it is installed — this plugin carries no Coopanion code or assets.",
            descriptionZh:
              "指向你安装的 Coopanion 中 cortico-world-desktop-pet 包的 web/ 目录的绝对路径（一个含 figure.json、kit/ 与形象包的目录）。运行时从安装位置加载——本插件不携带 Coopanion 的任何代码或资源。",
            placeholder: "/opt/coopanion/packages/cortico-world-desktop-pet/web",
          },
        },
      },
    ],
    "HttpModule.routes": [
      {
        id: "CoopanionPackRoutes.routes",
        prefix: "/api/plugins/@penguinharness/pet-live2d-coopanion/pack",
        auth: "user",
        order: 69,
      },
    ],
  },
})
export class PetLive2dCoopanion {
  /** The routes this module registers: serving the named installation's pack files. */
  @Bind("CoopanionPackRoutes.routes") routes!: Hono;
  /** The plugin configuration, as the host publishes it. */
  @Use() private readonly config!: CoopanionConfigReader;

  setup() {
    const config = this.config;
    this.routes = coopanionPackRoutes({
      settings: () => settingsOf(config.get(COOPANION_GROUP)),
    });
  }
}

/**
 * GET /api/plugins/@penguinharness/pet-live2d-coopanion/pack/<safe-relative-path> — one file
 * of the named installation. Same rule as the Cubism driver's model route: 404 on everything
 * the path check refuses, no directory listing, revalidated (the installation can change
 * under a running server).
 */
export function coopanionPackRoutes(deps: { settings: () => CoopanionSettings }): Hono {
  const app = new Hono();
  app.get("/*", async (c) => {
    const dir = deps.settings().packDir;
    if (dir === "") return c.json({ error: "no_pack" }, 404);
    const raw = c.req.path.split("/pack/")[1] ?? "";
    let rel: string;
    try {
      rel = decodeURIComponent(raw);
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
    const file = await containedFile(dir, rel);
    if (file === null) return c.json({ error: "not_found" }, 404);
    const bytes = await readFile(file);
    c.header("content-type", contentTypeOf(file));
    c.header("cache-control", "no-cache");
    return c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  });
  return app;
}

/**
 * The file `rel` names under `dir`, or null — the same twenty lines the Cubism driver
 * carries, and for the same reason (a builtin plugin bundles what it runs). See there.
 */
async function containedFile(dir: string, rel: string): Promise<string | null> {
  if (!isSafeRelPath(rel)) return null;
  try {
    const root = await realpath(dir);
    const file = await realpath(path.join(dir, rel));
    if (!file.startsWith(root + path.sep)) return null;
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** A relative path of plain segments: no leading slash, no backslash, no empty, `.` or `..` segment. */
function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function contentTypeOf(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      json: "application/json",
      js: "text/javascript",
      mjs: "text/javascript",
      webp: "image/webp",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      svg: "image/svg+xml",
      wav: "audio/wav",
      ogg: "audio/ogg",
    }[ext] ?? "application/octet-stream"
  );
}

const plugin: Plugin = { modules: [PetLive2dCoopanion] };
export default plugin;
