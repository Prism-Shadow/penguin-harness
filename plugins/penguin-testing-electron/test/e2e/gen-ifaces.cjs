// The generator bin, resolved without npm's module tree: the sample is a self-contained
// fixture package, so its build must not assume node_modules around it. Walk up to the
// checkout root (the directory holding packages/) and run core's bin from there.
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
