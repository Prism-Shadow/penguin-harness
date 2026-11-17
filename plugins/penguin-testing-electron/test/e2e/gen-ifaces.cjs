// The sample's build resolves the generator by walking up to the checkout root (the
// directory holding packages/): the fixture is a private package that installs into an
// instance, not a workspace member, so a workspace-relative script path does not exist.
const path = require("node:path");
const { existsSync } = require("node:fs");
let dir = __dirname;
while (dir !== path.dirname(dir)) {
  const candidate = path.join(dir, "packages", "core", "bin", "gen-ifaces.mjs");
  if (existsSync(candidate)) {
    require(candidate);
    process.exit(0);
  }
  dir = path.dirname(dir);
}
console.error("gen-ifaces: could not find packages/core from", __dirname);
process.exit(1);
