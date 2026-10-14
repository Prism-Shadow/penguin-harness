/**
 * Given an Agent created only on disk, the shipped Skill checker registers it and loads its
 * tab using the injected server even when a shell proxy points elsewhere. Missing tabs fail
 * with actionable feedback; missing Session credentials fail without searching for a server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { serve } from "@hono/node-server";
import { loadAgentState } from "@prismshadow/penguin-core";
import { createTestApp, type TestApp } from "./helpers.js";
const exec = promisify(execFile);
const checker = fileURLToPath(
  new URL(
    "../../../plugins/agent-development/skills/penguin-plugin/scripts/check.mjs",
    import.meta.url,
  ),
);
describe("Workbench Skill checker", { timeout: 30000 }, () => {
  let t: TestApp, server: ReturnType<typeof serve>, url: string;
  beforeAll(async () => {
    t = await createTestApp();
    server = serve({ fetch: t.app.fetch, hostname: "localhost", port: 0 });
    if (!server.listening) await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://localhost:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await t.cleanup();
  });
  it("discovers a file-created Agent and checks its tab through the injected server", async () => {
    await loadAgentState({
      root: t.root,
      projectId: "default_project",
      agentId: "file_created",
      init: {},
    });
    const dir = path.join(t.root, "default_project/agents/file_created/workbenches/demo");
    await fs.mkdir(path.join(dir, "ui"), { recursive: true });
    const manifest = {
      name: "Workbench",
      requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
      provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
      contributes: { "WebModule.sessionTabs": [] as object[] },
    };
    const write = () =>
      fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "Demo", type: "module", penguin: { modules: [manifest] } }),
      );
    await write();
    await fs.writeFile(
      path.join(dir, "index.ts"),
      'import type { WorkbenchPackage } from "@prismshadow/penguin-server/plugin"; export default {modules:{Workbench:{create(){return {api:{main:{async handle(){return {body:"ok"};}}}};}}}} satisfies WorkbenchPackage;',
    );
    await fs.writeFile(path.join(dir, "ui/index.html"), "<h1>Demo</h1>");
    const run = () =>
      exec(process.execPath, [checker, "file_created", "demo"], {
        env: {
          ...process.env,
          PENGUIN_API_URL: url,
          PENGUIN_API_TOKEN: t.deps.authService.localApiToken()!,
          PENGUIN_PROJECT_ID: "default_project",
          HTTP_PROXY: "http://127.0.0.1:1",
          http_proxy: "http://127.0.0.1:1",
        },
      });
    await expect(run()).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"hints"'),
    });
    manifest.contributes["WebModule.sessionTabs"].push({
      id: "demo.main",
      key: "main",
      title: "Demo",
      renderer: { iframe: { src: "ui/index.html" } },
    });
    await write();
    const { stdout } = await run();
    expect(JSON.parse(stdout)).toMatchObject({
      id: "demo",
      error: null,
      tabs: [{ key: "main" }],
      hints: [],
    });
    expect(
      t.deps.db
        .prepare("SELECT agent_id FROM agents WHERE project_id = ? AND agent_id = ?")
        .get("default_project", "file_created"),
    ).toMatchObject({ agent_id: "file_created" });
  });
  it("fails without injected credentials without probing another server", async () => {
    await expect(
      exec(process.execPath, [checker, "a", "b"], {
        env: { ...process.env, PENGUIN_API_URL: "", PENGUIN_API_TOKEN: "", PENGUIN_PROJECT_ID: "" },
      }),
    ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Requires its injected") });
  });
});
