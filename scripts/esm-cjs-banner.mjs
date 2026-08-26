/**
 * The CommonJS ambient globals an ESM bundle has to declare for the CJS dependencies it
 * absorbs, shaped as an esbuild/tsup `banner` string.
 *
 * Two bundling sites emit `format: "esm"` while bundling third-party CommonJS whole:
 * `packages/desktop/tsup.config.ts` (the app's shell, server and CLI bundles) and
 * `compileEntry` in `scripts/deploy.mjs` (the hot-update platform and CLI bundles). In a
 * CJS module `require`, `__filename` and `__dirname` are supplied by the module wrapper;
 * in an ESM one they do not exist, so each such reference inside an absorbed dependency
 * resolves against the bundle's own top-level scope instead. Undeclared, `require(...)`
 * reaches esbuild's stub — which always throws — and `__dirname` / `__filename` are
 * simply undefined identifiers, so the first dependency to read one fails with
 * `__dirname is not defined`.
 *
 * `__filename` and `__dirname` are an approximation, not emulation: they name the
 * BUNDLE's own path, not the directory the dependency was published in. A dependency that
 * reads `__dirname` to reach a file it ships beside itself therefore looks in the wrong
 * directory — the crash becomes a wrong path. Bundling cannot give it back the layout it
 * expects; a dependency that needs its own files has to stay out of the bundle and ship as
 * a real package directory, which is what `packages/desktop/scripts/build-assets.mjs`
 * does for node-pty.
 *
 * What is bundled today stays inside that limit: `@larksuiteoapi/node-sdk` resolves its
 * own `package.json` through `__dirname` to put a version into its User-Agent header, and
 * already falls back to `unknown` when the read finds nothing — so the wrong directory
 * costs a version tag in a request header and nothing more.
 */

/** Single line on purpose: a banner shifts every source line the bundle's sourcemap maps. */
export const ESM_CJS_BANNER = [
  'import { createRequire as __penguinCreateRequire } from "node:module";',
  'import { fileURLToPath as __penguinFileURLToPath } from "node:url";',
  'import { dirname as __penguinDirname } from "node:path";',
  "const require = __penguinCreateRequire(import.meta.url);",
  "const __filename = __penguinFileURLToPath(import.meta.url);",
  "const __dirname = __penguinDirname(__filename);",
].join(" ");
