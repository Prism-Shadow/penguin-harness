/**
 * Post-build step for GitHub Pages: copy index.html to 404.html so deep links
 * (/blog/xxx) served by Pages' 404 fallback still boot the SPA router, and add
 * .nojekyll so Pages serves the dist verbatim without Jekyll processing.
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
copyFileSync(join(dist, "index.html"), join(dist, "404.html"));
writeFileSync(join(dist, ".nojekyll"), "");
console.log("[postbuild] wrote dist/404.html and dist/.nojekyll");
