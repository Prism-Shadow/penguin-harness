import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { linkPluginDirectory, linkedPackages } from "../src/plugin/install.js";
import { pluginBases, readPluginDeclaration, refreshLinkDirs } from "../src/plugin/loader.js";
import { decorators, lower } from "./plugin-fixtures.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";

describe("probe2", () => {
  it("traces via the route view", async () => {
    const t = await createTestApp();
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "probe2-")));
    const dir = path.join(scratch, "live");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "index.js"), lower(`import { Module } from ${JSON.stringify(decorators)};
        @Module() export class M {}
        export default { modules: [M] };`));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/live", version: "0.1.0", type: "module", main: "./index.js" }));
    await fs.writeFile(path.join(dir, "ifaces.json"), JSON.stringify({ ifaces: {}, types: {}, modules: { M: { name: "M", requires: {}, provides: {}, contributes: {}, children: [] } }, plugin: { modules: ["M"], replaces: [] } }));
    await linkPluginDirectory(t.root, dir);
    const res = await admin.get("/api/projects/default_project/plugins/installed");
    const body = (await res.json()) as { plugins: Array<Record<string, unknown>> };
    console.log("ROUTE_ROWS", JSON.stringify(body.plugins));
    console.log("TABLE_NOW", JSON.stringify(await linkedPackages(path.join(t.root, "plugins"))));
    await refreshLinkDirs(t.root);
    const decl = await readPluginDeclaration("@acme/live", pluginBases(t.root, null));
    console.log("DECL_AFTER", JSON.stringify(decl));
    await fs.rm(scratch, { recursive: true, force: true });
    await t.cleanup();
  });
});
