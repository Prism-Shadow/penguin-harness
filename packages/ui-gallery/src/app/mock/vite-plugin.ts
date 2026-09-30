/**
 * The Vite plugin that swaps the Web App's network layer for the demo store's: every import
 * that resolves to `packages/web/src/api/client.ts` or `api/sse.ts` — from the endpoint
 * wrappers, the providers, the features — resolves to the mocks here instead. Matching on
 * the resolved file rather than the specifier text means `./client`, `../api/client` and
 * `../../api/client` are all caught, and nothing else is.
 *
 * Shared by the gallery's Vite config and its vitest config, so the tests that walk the
 * app's endpoint wrappers run them against the mock too. The resolution is path arithmetic
 * (the app imports these two modules by extensionless relative specifiers from TypeScript
 * files, and nothing else), so the plugin needs no plugin context and fits both configs'
 * plugin types structurally.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Real module (absolute path, no extension) → the mock that stands in for it. */
export const SWAPPED_MODULES: Readonly<Record<string, string>> = {
  [here("../../../../web/src/api/client")]: here("./client.ts"),
  [here("../../../../web/src/api/sse")]: here("./sse.ts"),
};

/** The mock a relative import from `importer` should resolve to, or null for any other import. */
export function swappedModuleFor(source: string, importer: string | undefined): string | null {
  if (importer === undefined || !source.startsWith(".")) return null;
  const from = importer.split("?")[0] ?? importer;
  const target = resolve(dirname(from), source).replace(/\.tsx?$/, "");
  return SWAPPED_MODULES[target] ?? null;
}

export function mockWebNetwork(): {
  name: string;
  enforce: "pre";
  resolveId: (source: string, importer: string | undefined) => string | null;
} {
  return {
    name: "penguin:gallery-mock-web-network",
    enforce: "pre",
    resolveId: (source, importer) => swappedModuleFor(source, importer),
  };
}
