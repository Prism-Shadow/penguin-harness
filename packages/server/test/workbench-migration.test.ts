/**
 * Given legacy Workflows with state/history, conversion publishes only renamed copies,
 * preserves originals and state, and keeps every recorded version as a converted copy.
 * Given an interrupted publication, retry resumes; a completed migration keeps later edits.
 * Given a conflicting destination or corrupt history, refusal leaves the originals intact.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { convertWorkflows } from "../src/workbenches/migrate.js";
import { readFolder } from "../src/workbenches/store.js";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-migration-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
async function legacy() {
  const old = path.join(dir, "workflows", "desk");
  await fs.mkdir(path.join(old, "ui"), { recursive: true });
  await fs.writeFile(
    path.join(old, "package.json"),
    JSON.stringify({
      name: "Desk",
      penguin: {
        modules: [
          {
            name: "Workflow",
            requires: { host: { iface: "@prismshadow/penguin-server#WorkflowHost", from: "Host" } },
          },
        ],
      },
    }),
  );
  await fs.writeFile(
    path.join(old, "index.ts"),
    'import type { WorkflowPackage } from "@prismshadow/penguin-server/plugin"; export default {modules:{Workflow:{}}} satisfies WorkflowPackage;',
  );
  await fs.writeFile(
    path.join(old, "ui/index.html"),
    '<link href="/workflow-ui.css"><div class="wf-card" style="color:var(--wf-fg)">Desk</div>',
  );
  await fs.writeFile(path.join(old, "state.json"), '{"note":"Workflow","count":7}');
  const folder = (await readFolder(old, "desk"))!;
  const history = path.join(dir, "workflows-history/desk");
  await fs.mkdir(history, { recursive: true });
  await fs.cp(old, path.join(history, folder.revision), { recursive: true });
  await fs.writeFile(
    path.join(history, "versions.json"),
    JSON.stringify([
      {
        revision: folder.revision,
        uiRev: folder.uiRev,
        files: folder.files,
        name: "Desk",
        version: null,
        savedAt: "2026-10-01T00:00:00Z",
      },
    ]),
  );
  return old;
}
describe("one-time Workbench migration", () => {
  it("converts code and history while preserving data and recoverable originals", async () => {
    const old = await legacy();
    const original = await fs.readFile(path.join(old, "index.ts"), "utf8");
    await convertWorkflows(dir);
    const current = path.join(dir, "workbenches/desk");
    expect(await fs.readFile(path.join(current, "index.ts"), "utf8")).toContain("WorkbenchPackage");
    expect(await fs.readFile(path.join(current, "ui/index.html"), "utf8")).toContain("--wb-fg");
    expect(JSON.parse(await fs.readFile(path.join(current, "state.json"), "utf8"))).toEqual({
      note: "Workflow",
      count: 7,
    });
    expect(
      await fs.readFile(
        path.join(dir, ".workbench-migration/backup/workflows/desk/index.ts"),
        "utf8",
      ),
    ).toBe(original);
    await expect(fs.stat(old)).rejects.toMatchObject({ code: "ENOENT" });
    const history = path.join(dir, "workbenches-history/desk");
    const [version] = JSON.parse(await fs.readFile(path.join(history, "versions.json"), "utf8"));
    expect(version.revision).toBe((await readFolder(current, "desk"))!.revision);
    // The recorded copy is the converted code under its new revision: what the move into
    // Agent State imports as a version.
    const copy = (await readFolder(path.join(history, version.revision), "desk"))!;
    expect(copy.revision).toBe(version.revision);
    expect(await fs.readFile(path.join(copy.dir, "index.ts"), "utf8")).toContain(
      "WorkbenchPackage",
    );
  });
  it("resumes publication after interruption and never repeats a completed conversion", async () => {
    await legacy();
    await convertWorkflows(dir);
    const journal = path.join(dir, ".workbench-migration");
    await fs.unlink(path.join(journal, "complete"));
    await fs.rename(
      path.join(dir, "workbenches-history"),
      path.join(journal, "staged/workbenches-history"),
    );
    await convertWorkflows(dir);
    await fs.writeFile(path.join(dir, "workbenches/desk/index.ts"), "user's later edit");
    await convertWorkflows(dir);
    expect(await fs.readFile(path.join(dir, "workbenches/desk/index.ts"), "utf8")).toBe(
      "user's later edit",
    );
    expect(await fs.stat(path.join(dir, "workbenches-history/desk/versions.json"))).toBeTruthy();
  });
  it("refuses a destination conflict without overwriting either tree", async () => {
    const old = await legacy();
    await fs.mkdir(path.join(dir, "workbenches"));
    await fs.writeFile(path.join(dir, "workbenches/mine"), "keep");
    await expect(convertWorkflows(dir)).rejects.toThrow("already exists");
    expect(await fs.readFile(path.join(dir, "workbenches/mine"), "utf8")).toBe("keep");
    expect(await fs.readFile(path.join(old, "index.ts"), "utf8")).toContain("WorkflowPackage");
  });
  it("rejects corrupt history before publishing any renamed files", async () => {
    const old = await legacy();
    await fs.writeFile(
      path.join(dir, "workflows-history/desk/versions.json"),
      JSON.stringify([{ revision: "../../outside" }]),
    );
    await expect(convertWorkflows(dir)).rejects.toThrow("Invalid workbench history");
    expect(await fs.stat(old)).toBeTruthy();
    await expect(fs.stat(path.join(dir, "workbenches"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
