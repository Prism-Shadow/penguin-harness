/**
 * @penguinharness/pet-live2d-cubism — the pet's official Cubism figure driver.
 *
 * A PLUGIN PACKAGE, not part of the platform: it draws the pet the web app docks for
 * `@penguinharness/pet`, behind that package's figure contract (its ui/figure/contract.js —
 * the whole interface, and the only thing this package knows of the pet). Nothing here
 * reads the pet's state, speaks, or keeps score: the widget does all of that, and hands
 * this package a stage and the pet's `figure` configuration block, verbatim.
 *
 * What this package owns:
 *
 *   - `ui/figure.js` — the browser half: an adapter over the official Cubism Web SDK
 *     (`vendor/cubism/`, fetched by `scripts/fetch-cubism.mjs`, never committed — Core is
 *     Live2D's proprietary build, the Framework its Open Software License). It loads the
 *     model pack the configuration names, maps the pet's vocabulary onto the model's
 *     parameters through `ui/parameter-map.json`, and answers the contract.
 *   - `PluginLibraryModule.cards` + `PluginConfigProvider.groups` — the Plugins page card
 *     and the settings: which model pack to serve, and where it lives on the server.
 *   - `HttpModule.routes` — `GET /api/plugins/@penguinharness/pet-live2d-cubism/model/*`,
 *     serving the configured pack's files from the server's disk. `ui/figure.js` fetches
 *     the model through it; the pack never travels in the repo or the npm package.
 *
 * The model pack is the operator's: the repository and the package carry none, because
 * owning a model is not owning the right to redistribute it (its textures, physics, motions
 * and expressions ride along under the same rule). The settings name a directory on the
 * server; `pet.model3.json` inside it is the entry, and the whole directory is what the
 * route may serve. Cubism 2 exports (`.model.json` / `.moc`) are not supported: the adapter
 * loads a `.model3.json` / `.moc3` pack or nothing.
 *
 * The file server is this package's own, twenty lines: a safe relative path (no leading
 * slash, no backslash, no `.` or `..` segment), both sides of it resolved and checked
 * against the pack directory, regular files only. The same rule the server's own static
 * files follow — copied here rather than imported, because a builtin plugin bundles what
 * it runs and the harness's http module is not part of its bundle.
 */
import { Bind, Component, Interface, Use } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import { Hono } from "hono";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

/** The settings group this driver declares (its contribution id), read by the routes. */
export const CUBISM_GROUP = "pet-live2d-cubism";

/**
 * What this driver requires of plugin configuration: to read the group it declares. The
 * interface is the consumer's own, so the package depends on no harness type.
 */
@Interface()
export abstract class CubismConfigReader {
  abstract get(name: string): Record<string, unknown>;
}

/** The driver's settings, as the routes read them. */
export interface CubismSettings {
  /** Absolute directory of the model pack on the server; empty = no model configured. */
  modelDir: string;
}

/** Reads the group's stored values onto the declared defaults. */
export function settingsOf(config: Record<string, unknown> | undefined): CubismSettings {
  const stored = config?.[CUBISM_GROUP];
  const dir =
    typeof stored === "object" && stored !== null
      ? (stored as Record<string, unknown>).modelDir
      : undefined;
  return { modelDir: typeof dir === "string" ? dir : "" };
}

/**
 * The plugin's one module: the card and the settings group, and the routes that serve the
 * configured pack. Created per App, so a settings edit and a hot swap get fresh routes.
 */
@Component({
  contributes: {
    // How the Plugins page shows this driver (read from ifaces.json, never by booting it).
    "PluginLibraryModule.cards": [
      {
        id: "pet-live2d-cubism.card",
        title: "Pet · Live2D (Cubism)",
        titleZh: "宠物 · Live2D（Cubism）",
        descriptionZh:
          "用 Live2D 官方 Cubism Web SDK 画宠物：模型包由使用方自行准备，放在服务器本地目录，不随本插件分发。",
        shortDescription: "Draw the pet with the official Cubism SDK and your own model pack.",
        shortDescriptionZh: "用官方 Cubism SDK 与自备模型包画宠物。",
        category: "pet",
        icon: "icon.svg",
        preinstall: false,
      },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "pet-live2d-cubism",
        parent: "pet",
        title: "Live2D (Cubism)",
        properties: {
          modelDir: {
            type: "string",
            title: "Model pack directory",
            titleZh: "模型包目录",
            description:
              "An absolute path on the server to a Cubism 3/5 model pack: a directory whose pet.model3.json is the entry (its textures, physics, motions and expressions beside it). Served, never redistributed — the pack stays yours.",
            descriptionZh:
              "服务器上的绝对路径，指向一个 Cubism 3/5 模型包：目录以 pet.model3.json 为入口（纹理、物理、动作、表情放在旁边）。只在本机服务，不随插件再分发——模型仍是你的。",
            placeholder: "/var/lib/penguin/pet-model",
          },
        },
      },
    ],
    "HttpModule.routes": [
      {
        id: "CubismModelRoutes.routes",
        prefix: "/api/plugins/@penguinharness/pet-live2d-cubism/model",
        auth: "user",
        order: 69,
      },
    ],
  },
})
export class PetLive2dCubism {
  /** The routes this module registers: serving the configured pack's files. */
  @Bind("CubismModelRoutes.routes") routes!: Hono;
  /** The plugin configuration, as the host publishes it. */
  @Use() private readonly config!: CubismConfigReader;

  setup() {
    const config = this.config;
    this.routes = cubismModelRoutes({
      settings: () => settingsOf(config.get(CUBISM_GROUP)),
    });
  }
}

/**
 * GET /api/plugins/@penguinharness/pet-live2d-cubism/model/<safe-relative-path> — one file of
 * the configured model pack. A pack without a configured directory answers 404 on every path,
 * and so does anything the path check refuses (see the module header): no traversal, no
 * symlink out, no absolute or backslash path. Nothing here lists a directory: `ui/figure.js`
 * names every file through the pack's own `pet.model3.json`, so the route only ever serves
 * named files.
 */
export function cubismModelRoutes(deps: { settings: () => CubismSettings }): Hono {
  const app = new Hono();
  app.get("/*", async (c) => {
    const dir = deps.settings().modelDir;
    if (dir === "") return c.json({ error: "no_model" }, 404);
    const raw = c.req.path.split("/model/")[1] ?? "";
    let rel: string;
    try {
      rel = decodeURIComponent(raw);
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
    const file = await containedFile(dir, rel);
    if (file === null) return c.json({ error: "not_found" }, 404);
    const bytes = await readFileBytes(file);
    c.header("content-type", contentTypeOf(file));
    // Revalidate, not immutable: the pack is the operator's and can change under a running
    // server (a new scheme, a fixed expression), and nothing here versions its URLs.
    c.header("cache-control", "no-cache");
    return c.body(bytes);
  });
  return app;
}

/**
 * The file `rel` names under `dir`, or null: `rel` must be a safe relative path, the file
 * must exist and be a regular file, and — symlinks resolved on both sides — it must still
 * lie inside `dir`, so a link inside the pack directory cannot hand out a file outside it.
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

async function readFileBytes(file: string): Promise<ArrayBuffer> {
  const bytes = await readFile(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function contentTypeOf(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      json: "application/json",
      moc3: "application/octet-stream",
      webp: "image/webp",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
    }[ext] ?? "application/octet-stream"
  );
}

const plugin: Plugin = { modules: [PetLive2dCubism] };
export default plugin;
