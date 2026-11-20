/**
 * npm, as far as the server can see it (NpmPluginPackages, the plugin packages' one seam): an
 * install writes the package's files under the prefix's node_modules and records it in the
 * prefix's package.json; a name or link resolves to the package a test registered for it, a
 * tarball to the package a test registered under its file name, and anything else fails the way
 * npm does — a name the registry does not have as npm's "unavailable" (E404), every name as
 * "unreachable" while the test says the registry does not answer.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, strToU8 } from "fflate";
import { PluginInstallError, type InstalledPackage } from "../src/plugin/install.js";

export type Files = Record<string, string | Uint8Array>;

const bytes = (value: string | Uint8Array) => (typeof value === "string" ? strToU8(value) : value);

export function fakeNpm() {
  const calls: string[] = [];
  /** The packages taken back out of the prefix, in order. */
  const removed: string[] = [];
  /** What a name or a link installs. */
  const links = new Map<string, Files>();
  /** What a tarball installs, by its file name. */
  const tarballs = new Map<string, Files>();
  /**
   * How the registry answers a name no test registered: `down` — nothing answers (npm's
   * "unreachable"); `says404` — it answers that the name is not published (npm's "unavailable");
   * neither — a failure npm gives no reason for.
   */
  const registry = { down: false, says404: false };
  const place = async (root: string, files: Files, spec: string): Promise<InstalledPackage> => {
    const prefix = path.join(root, "plugins");
    const manifest = JSON.parse(strFromU8(bytes(files["package.json"]!))) as {
      name: string;
      version: string;
    };
    const dir = path.join(prefix, "node_modules", ...manifest.name.split("/"));
    await fs.rm(dir, { recursive: true, force: true });
    for (const [rel, value] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.writeFile(path.join(dir, rel), bytes(value));
    }
    const prefixFile = path.join(prefix, "package.json");
    const own = JSON.parse(
      await fs
        .readFile(prefixFile, "utf8")
        .catch(() => '{"name":"penguin-plugins","private":true}'),
    ) as { dependencies?: Record<string, string> };
    own.dependencies = { ...own.dependencies, [manifest.name]: spec };
    await fs.writeFile(prefixFile, JSON.stringify(own));
    return { name: manifest.name, version: manifest.version };
  };
  return {
    calls,
    removed,
    links,
    tarballs,
    registry,
    install: async (root: string, source: string) => {
      calls.push(source);
      if (registry.down && !source.includes(":")) {
        const err = new PluginInstallError(
          "npm error code ETIMEDOUT\nnpm error network request to https://registry.npmjs.org failed",
        );
        err.reason = "unreachable";
        err.registry = "https://registry.npmjs.org";
        throw err;
      }
      const files = links.get(source);
      if (files === undefined) {
        const err = new PluginInstallError(`404 Not Found - GET ${source}`);
        if (registry.says404) err.reason = "unavailable";
        throw err;
      }
      return place(root, files, source);
    },
    installFiles: async (root: string, files: Record<string, Uint8Array>) => {
      calls.push("<zip>");
      return place(root, files, "file:archives/upload.tgz");
    },
    installTarball: async (root: string, file: string, _name: string) => {
      const base = path.basename(file);
      calls.push(`<tarball ${base}>`);
      const files = tarballs.get(base);
      if (files === undefined) throw new PluginInstallError(`could not read ${base}`);
      return place(root, files, `file:archives/${base}`);
    },
    remove: async (root: string, name: string) => {
      removed.push(name);
      const prefixFile = path.join(root, "plugins", "package.json");
      const own = JSON.parse(await fs.readFile(prefixFile, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      delete own.dependencies?.[name];
      await fs.writeFile(prefixFile, JSON.stringify(own));
      await fs.rm(path.join(root, "plugins", "node_modules", ...name.split("/")), {
        recursive: true,
        force: true,
      });
    },
  };
}
