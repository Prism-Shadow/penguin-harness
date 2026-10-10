/**
 * The TypeScript compiler, loaded when something first needs it.
 *
 * The compiler decides whether the interfaces a package was written against still fit this
 * platform (./iface-check.ts) — for plugins and for workflows alike — and type-checks and
 * transpiles a workflow's source (../workflows/compile.ts). It is a dependency of this
 * package, but the platform also runs as a single pushed bundle that sits outside any
 * `node_modules`, on machines whose program may predate that dependency — so the specifier
 * is kept out of the bundler's sight and resolved at run time, in three places: in the
 * assets the push carried it in (scripts/typescript-payload.mjs), beside this module, and
 * beside the program that is running, the way node-pty is found.
 *
 * The push's copy comes first: it is the one this platform was built and tested with, and it
 * is whole. What an installation holds is whatever its packaging left of the compiler — a
 * desktop package built without the default library files resolves `typescript` and then fails
 * every program for want of `lib.*.d.ts`. So a compiler is taken only when the library files
 * the server reads lie beside its entry; one without them is passed over for the next place.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";

export type TypeScript = typeof import("typescript");

export class TypeScriptUnavailable extends Error {}

/**
 * The default library files a program here is checked against, which the compiler reads from
 * its entry's own directory: the interface check names `lib.es2022.d.ts`, and a workflow's
 * target (ES2022) brings `lib.es2022.full.d.ts`.
 */
export const DEFAULT_LIBRARIES = ["lib.es2022.d.ts", "lib.es2022.full.d.ts"] as const;

let loading: Promise<TypeScript> | null = null;

/**
 * Where the compiler is looked for, in order; each is a file a `require` resolves from. A
 * thunk, because the push's archive is unpacked when it is first asked for and that can fail.
 */
function compilerBases(assets: string | null): (() => string)[] {
  return [
    ...(assets === null ? [] : [() => path.join(unpackedAssetsDir(assets), "index.mjs")]),
    () => import.meta.url,
    ...(process.argv[1] ? [() => pathToFileURL(process.argv[1]!).href] : []),
  ];
}

const unavailable = (tried: readonly string[]) =>
  new TypeScriptUnavailable(
    `the TypeScript compiler is not available in this installation (${tried.join("; ")})`,
  );

const said = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0] : String(err));

/** The compiler one place holds: its entry file, or why that place has none to give. */
function compilerAt(from: () => string): { file: string } | { why: string } {
  // A variable, not a literal: the platform bundle must not inline nine megabytes of compiler.
  const specifier = "typescript";
  let base = "(unknown)";
  try {
    base = from();
    const file = createRequire(base).resolve(specifier);
    const dir = path.dirname(file);
    const missing = DEFAULT_LIBRARIES.find((lib) => !existsSync(path.join(dir, lib)));
    return missing === undefined
      ? { file }
      : { why: `${base}: ${file} has no ${missing} beside it` };
  } catch (err) {
    return { why: `${base}: ${said(err)}` };
  }
}

/**
 * The entry file of the first compiler among `bases` that has its default library beside it.
 * Throws {@link TypeScriptUnavailable} saying what each place lacked.
 */
export function compilerFile(bases: readonly (() => string)[]): string {
  const tried: string[] = [];
  for (const from of bases) {
    const found = compilerAt(from);
    if ("file" in found) return found.file;
    tried.push(found.why);
  }
  throw unavailable(tried);
}

async function resolveAndImport(assets: string | null): Promise<TypeScript> {
  const tried: string[] = [];
  for (const from of compilerBases(assets)) {
    const found = compilerAt(from);
    if ("why" in found) {
      tried.push(found.why);
      continue;
    }
    try {
      const mod = (await import(pathToFileURL(found.file).href)) as {
        default?: TypeScript;
      } & TypeScript;
      return mod.default ?? mod;
    } catch (err) {
      tried.push(`${found.file}: ${said(err)}`);
    }
  }
  throw unavailable(tried);
}

/** `assets` is the pushed build's assets directory (the hmr capability's `assetsDir()`), when there is one. */
export function loadTypeScript(assets: string | null = null): Promise<TypeScript> {
  loading ??= resolveAndImport(assets).catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}
