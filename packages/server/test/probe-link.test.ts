import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { linkPluginDirectory, linkedPackages } from "../src/plugin/install.js";
import { pluginBases, resolvePluginPackage, refreshLinkDirs, readPluginDeclaration } from "../src/plugin/loader.js";
import { decorators, lower } from "./plugin-fixtures.js";
import { createTestApp } from "./helpers.js";

describe("probe", () => {
  it("traces the link mark", async () => {
    const t = await createTestApp();
    const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "probe-")));
    const dir = path.join(scratch, "live");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "index.js"), lower(`import { Module } from ${JSON.stringify(decorators)};
        @Module() export class M {}
        export default { modules: [M] };`));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/live", version: "0.1.0", type: "module", main: "./index.js" }));
    await fs.writeFile(path.join(dir, "ifaces.json"), JSON.stringify({ ifaces: {}, types: {}, modules: { M: { name: "M", requires: {}, provides: {}, contributes: {}, children: [] } }, plugin: { modules: ["M"], replaces: [] } }));
    const linked = await linkPluginDirectory(t.root, dir);
    console.log("LINKED", JSON.stringify(linked));
    console.log("TABLE", JSON.stringify(await linkedPackages(path.join(t.root, "plugins"))));
    await refreshLinkDirs(t.root);
    const bases = pluginBases(t.root, null);
    const resolved = resolvePluginPackage("@acme/live", bases);
    console.log("RESOLVED_DIR", resolved?.dir);
    const decl = await readPluginDeclaration("@acme/live", bases);
    console.log("DECL", JSON.stringify(decl));
    await fs.rm(scratch, { recursive: true, force: true });
    await t.cleanup();
  });
});
