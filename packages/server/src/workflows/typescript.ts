/**
 * The TypeScript compiler, loaded when the first workflow needs it.
 *
 * A workflow is TypeScript: the server type-checks it, transpiles it, and lets the same
 * compiler decide whether the interfaces it was written against still fit this platform
 * (./compile.ts, ./iface-check.ts). The compiler is a dependency of this package, but the
 * platform also runs as a single pushed bundle that sits outside any `node_modules` — so
 * the specifier is kept out of the bundler's sight and resolved at run time, from this
 * module first and then from the program that is running.
 *
 * There is no fallback to "unchecked": an installation without the compiler loads no
 * workflow, and says why.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export type TypeScript = typeof import("typescript");

export class TypeScriptUnavailable extends Error {}

let loading: Promise<TypeScript> | null = null;

async function resolveAndImport(): Promise<TypeScript> {
  // A variable, not a literal: the platform bundle must not inline nine megabytes of compiler.
  const specifier = "typescript";
  const tried: string[] = [];
  const bases = [
    import.meta.url,
    ...(process.argv[1] ? [pathToFileURL(process.argv[1]).href] : []),
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
    `the TypeScript compiler is not available in this installation, so workflows cannot be checked (${tried.join("; ")})`,
  );
}

export function loadTypeScript(): Promise<TypeScript> {
  loading ??= resolveAndImport().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}
