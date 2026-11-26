/**
 * A workbench's in-memory page id (`WorkbenchService`), the value its Sessions record as their
 * source (`PageSource`) and its module `ctx` and `WorkbenchHost` expose.
 *
 * - A workbench receives a page id in memory (`page-YYYY-MM-DD-HH-mm-ss-<8 hex>`, minted with
 *   core's `formatPageId`), and nothing is written into its folder on disk (no `.page-id` file).
 * - The same workbench keeps its page id across repeated listings in the same server process.
 * - Removing a workbench or releasing its Agent drops the in-memory page id so a folder recreated
 *   under the same id receives a fresh one.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentStateDir, formatPageId } from "@prismshadow/penguin-core";
import { DISABLED_MARKER, readFolder } from "../src/workbenches/store.js";
import { apiClient, createTestApp, provisionUser, type TestApp } from "./helpers.js";
import type { WorkbenchInfo } from "../src/api/types.js";

const PROJECT = "owner-pageid";
const AGENT = "custom_agent";
const BASE = `/api/projects/${PROJECT}/agents/${AGENT}/workbenches`;

const MANIFEST = {
  name: "Workbench",
  requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
  provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
  contributes: {},
  children: [],
};

async function writeSwitchedOffWorkbench(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "Demo",
      version: "1.0.0",
      type: "module",
      penguin: { modules: [MANIFEST] },
    }),
  );
  await fs.writeFile(path.join(dir, "index.ts"), "export default { modules: {} };\n");
  // Switched off so listings exercise the in-memory page id without invoking the TS compiler.
  await fs.writeFile(path.join(dir, DISABLED_MARKER), "");
}

describe("a workbench's in-memory page id", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let dir: string;

  beforeAll(async () => {
    t = await createTestApp();
    const user = await provisionUser(t.app, "owner");
    owner = apiClient(t.app, user.cookie);
    const created = await owner.post("/api/projects", { projectId: PROJECT, name: "page-id" });
    expect(created.status).toBe(201);
    const agentCreated = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId: AGENT });
    expect(agentCreated.status).toBe(201);
    dir = path.join(agentStateDir(t.root, PROJECT, AGENT), "workbenches", "demo");
    await writeSwitchedOffWorkbench(dir);
  });

  afterAll(async () => {
    await t.cleanup();
  });

  const list = async (): Promise<WorkbenchInfo[]> => {
    const res = await owner.get(BASE);
    expect(res.status).toBe(200);
    return ((await res.json()) as { workbenches: WorkbenchInfo[] }).workbenches;
  };

  it("mints a page id in memory and never writes a .page-id file into the folder", async () => {
    expect(formatPageId()).toMatch(/^page-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/);
    const [first] = await list();
    expect(first?.pageId).toMatch(/^page-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/);
    const [second] = await list();
    expect(second?.pageId).toBe(first?.pageId);

    const entries = await fs.readdir(dir);
    expect(entries).not.toContain(".page-id");
    const folder = await readFolder(dir, "demo");
    expect(folder).not.toBeNull();
    expect("pageId" in (folder as object)).toBe(false);
  });

  it("drops the page id when the workbench is removed or its Agent is deleted", async () => {
    const [before] = await list();
    const firstId = before!.pageId!;

    const del = await owner.delete(`${BASE}/demo`);
    expect(del.status).toBe(204);
    await writeSwitchedOffWorkbench(dir);
    const [afterRemove] = await list();
    expect(afterRemove?.pageId).toMatch(/^page-/);
    expect(afterRemove?.pageId).not.toBe(firstId);

    const secondId = afterRemove!.pageId!;
    const delAgent = await owner.delete(`/api/projects/${PROJECT}/agents/${AGENT}`);
    expect(delAgent.status).toBe(202);
    const recreatedAgent = await owner.post(`/api/projects/${PROJECT}/agents`, { agentId: AGENT });
    expect(recreatedAgent.status).toBe(201);
    await writeSwitchedOffWorkbench(dir);
    const [afterRelease] = await list();
    expect(afterRelease?.pageId).toMatch(/^page-/);
    expect(afterRelease?.pageId).not.toBe(secondId);
  });
});
