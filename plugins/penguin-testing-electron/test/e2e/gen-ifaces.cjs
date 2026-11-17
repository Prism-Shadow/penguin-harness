// Resolves the generator from the sample package, wherever the checkout root sits.
// (The sample lives nested inside plugins/penguin-testing-electron/test/e2e/, so a
// repo-relative script path would be brittle; resolve the core package instead.)
const { createRequire } = require("node:module");
const path = require("node:path");
const req = createRequire(__filename);
let bin;
try {
  bin = path.join(path.dirname(req.resolve("@prismshadow/penguin-core/package.json")), "bin", "gen-ifaces.mjs");
} catch {
  bin = path.join(__dirname, "../../../../../packages/core/bin/gen-ifaces.mjs");
}
require(bin);
