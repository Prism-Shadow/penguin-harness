/**
 * A second copy of Hono, as a plugin bundles one (scripts/build-plugins.mjs inlines every
 * non-native dependency): the host's own Hono build copied under `root` and imported from there,
 * so its classes, its default error handler and its `compose` are not the host's. The copy holds
 * only what the entry module reaches (its top-level modules, `request/`, `router/`, `utils/`).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REACHED = new Set(["request", "router", "utils"]);

export async function foreignHono(root: string): Promise<typeof import("hono")> {
  // The CommonJS entry (`dist/cjs/index.js`) names the build's directory; the ES modules sit
  // beside it.
  const dist = path.resolve(path.dirname(createRequire(import.meta.url).resolve("hono")), "..");
  const target = path.join(root, "node_modules", "hono-copy");
  fs.cpSync(dist, path.join(target, "dist"), {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(dist, source);
      if (rel === "") return true;
      const [top, ...rest] = rel.split(path.sep);
      return rest.length === 0
        ? !fs.statSync(source).isDirectory() || REACHED.has(top!)
        : REACHED.has(top!);
    },
  });
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ type: "module" }));
  const entry = pathToFileURL(path.join(target, "dist", "index.js")).href;
  return (await import(entry)) as typeof import("hono");
}
