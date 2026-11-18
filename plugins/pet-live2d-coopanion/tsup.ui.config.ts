/**
 * Builds the driver's browser half — `ui/figure.ts` — into `ui/figure.js`, the module the
 * pet's page imports (`GET /api/plugins/<package>/ui/figure.js`). It stays at `ui/`'s top
 * level, not `ui/dist/`: its own imports resolve relative to `ui/` (the Cubism vendor tree,
 * `./vendor/cubism/`, that fetch-cubism.mjs fills), and the page's cross-package import names
 * this path. `clean: false` — the directory holds sources and served files, not only builds.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["ui/figure.ts"],
  format: ["esm"],
  target: "es2022",
  outDir: "ui",
  clean: false,
});
