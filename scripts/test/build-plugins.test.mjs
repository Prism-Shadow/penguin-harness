/**
 * Which plugin packages the build ships in the builtin prefix:
 * - every package with a code entry, and none without one (content only);
 * - but a MARKET_ONLY package, which is installed from the plugin market instead.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { pluginPackages } from "../build-plugins.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-build-plugins-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function plugin(name, manifest) {
  fs.mkdirSync(path.join(dir, "plugins", name), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugins", name, "package.json"), JSON.stringify(manifest));
}

it("ships the code plugins but the market-only ones", async () => {
  plugin("sandbox-x", {
    name: "@penguinharness/sandbox-x",
    version: "1.0.0",
    main: "./dist/index.js",
  });
  plugin("skills-only", { name: "@penguinharness/skills-only", version: "1.0.0" });
  plugin("computer-use", {
    name: "@penguinharness/computer-use",
    version: "1.0.0",
    exports: { ".": { import: "./dist/index.js" } },
  });
  const shipped = (await pluginPackages(dir)).map((p) => p.name);
  assert.deepEqual(shipped, ["@penguinharness/sandbox-x"]);
});
