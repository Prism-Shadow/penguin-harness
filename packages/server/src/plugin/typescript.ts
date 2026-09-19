/**
 * The TypeScript compiler, loaded when something first needs it.
 *
 * The compiler decides whether the interfaces a package was written against still fit this
 * platform (./iface-check.ts) — for plugins and for workflows alike — and type-checks and
 * transpiles a workflow's source (../workflows/compile.ts). It is a dependency of this
 * package, but the platform also runs as a single pushed bundle that sits outside any
 * `node_modules`, on machines whose program may predate that dependency — so the specifier
 * is kept out of the bundler's sight and resolved at run time, in three places: beside this
 * module, beside the program that is running, and in the assets the push carried it in
 * (scripts/typescript-payload.mjs), the way node-pty is found.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";

export type TypeScript = typeof import("typescript");

export class TypeScriptUnavailable extends Error {}

let loading: Promise<TypeScript> | null = null;

async function resolveAndImport(assets: string | null): Promise<TypeScript> {
  // A variable, not a literal: the platform bundle must not inline nine megabytes of compiler.
  const specifier = "typescript";
  const tried: string[] = [];
  const bases = [
    import.meta.url,
    ...(process.argv[1] ? [pathToFileURL(process.argv[1]).href] : []),
    // A push carries the compiler as an archive; it is unpacked before it is resolved.
    ...(assets === null ? [] : [path.join(unpackedAssetsDir(assets), "index.mjs")]),
  ];
  for (const base of bases) {
    try {
      const file = createRequire(base).resolve(specifier);
      const mod = (await import(pathToFileURL(file).href)) as { default?: TypeScript } & TypeScript;
      return mod.default ?? mod;
    } catch (err) {
      tried.push(`${base}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    }
  }
  throw new TypeScriptUnavailable(
    `the TypeScript compiler is not available in this installation (${tried.join("; ")})`,
  );
}

/** `assets` is the pushed build's assets directory (the hmr capability's `assetsDir()`), when there is one. */
export function loadTypeScript(assets: string | null = null): Promise<TypeScript> {
  loading ??= resolveAndImport(assets).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}
