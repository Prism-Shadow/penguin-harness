/**
 * The Vite plugin that swaps the Web App's network layer for the demo store's: every import
 * that resolves to `packages/web/src/api/client.ts` or `api/sse.ts` — from the endpoint
 * wrappers, the providers, the features — resolves to the mocks here instead. Matching on
 * the resolved file rather than the specifier text means `./client`, `../api/client` and
 * `../../api/client` are all caught. The guide workbench also has a gallery-only stand-in:
 * the static site can show its installation instructions without a plugin server.
 *
 * Shared by the gallery's Vite config and its vitest config, so the tests that walk the
 * app's endpoint wrappers run them against the mock too. The resolution is path arithmetic
 * (the app imports these two modules by extensionless relative specifiers from TypeScript
 * files, and nothing else), so the plugin needs no plugin context and fits both configs'
 * plugin types structurally.
 */
import { readFileSync } from "node:fs";
import { version } from "../../../../web/package.json";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Real module (absolute path, no extension) → the mock that stands in for it. */
export const SWAPPED_MODULES: Readonly<Record<string, string>> = {
  [here("../../../../web/src/api/client")]: here("./client.ts"),
  [here("../../../../web/src/api/sse")]: here("./sse.ts"),
  [here("../../../../web/src/features/workbenches/workbench-frame")]: here("./workbench-frame.tsx"),
};

/** The mock a relative import from `importer` should resolve to, or null for any other import. */
export function swappedModuleFor(source: string, importer: string | undefined): string | null {
  if (importer === undefined || !source.startsWith(".")) return null;
  const from = importer.split("?")[0] ?? importer;
  const target = resolve(dirname(from), source).replace(/\.tsx?$/, "");
  const mock = SWAPPED_MODULES[target];
  // A stand-in can import the original to delegate everything outside its own fixture.
  return mock === from ? null : (mock ?? null);
}

export function mockWebNetwork(): {
  name: string;
  enforce: "pre";
  config: () => { define: Record<string, string> };
  resolveId: (source: string, importer: string | undefined) => string | null;
} {
  // The public frame depicts a released app. Resolve its release date at build time so
  // the browser receives the date for its version without shipping the changelog.
  const releases = readFileSync(here("../../../../../CHANGELOG.md"), "utf8");
  const release = releases.split("\n").find((line) => line.startsWith(`- **${version}** — `));
  const date = release?.match(/ — (\d{4}-\d{2}-\d{2})\./)?.[1] ?? null;
  return {
    name: "penguin:gallery-mock-web-network",
    config: () => ({ define: { "import.meta.env.GALLERY_RELEASE_DATE": JSON.stringify(date) } }),
    enforce: "pre",
    resolveId: (source, importer) => swappedModuleFor(source, importer),
  };
}
