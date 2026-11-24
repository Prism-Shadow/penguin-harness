/**
 * A workbench's page id (`store.ts`: `.page-id`), the value its Sessions record as their source.
 *
 * - The first read of a folder mints nothing; `ensurePageId` writes one, and it is
 *   `page-YYYY-MM-DD-HH-mm-ss-<8 hex>`, the shape core's `formatPageId` gives it.
 * - A folder that already holds one keeps it: a second call answers the same id and writes
 *   nothing, so a page's Sessions stay that page's across restarts.
 * - The file is a dot entry: the folder's source, its revision and its `ui/` revision are the
 *   same with it as without it, and so a page id never makes a new version.
 * - A file holding nothing that is a page id reads as none (junk is never a Session's source)
 *   and is replaced by the next `ensurePageId`.
 * - Two callers racing for one folder end with one id, whichever wins.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPageId } from "@prismshadow/penguin-core";
import { ensurePageId, PAGE_ID_FILE, readFolder, STATE_FILE } from "../src/workbenches/store.js";

let root: string;
let dir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-page-id-"));
  dir = path.join(root, "demo");
  await fs.mkdir(path.join(dir, "ui"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "demo", version: "1.0.0" }),
  );
  await fs.writeFile(path.join(dir, "index.ts"), "export default { modules: {} };\n");
  await fs.writeFile(path.join(dir, "ui", "page.html"), "<!doctype html><p>hi</p>\n");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const pageIdFile = () => path.join(dir, PAGE_ID_FILE);

describe("ensurePageId", () => {
  it("mints an id in the page id's shape and writes it into the folder", async () => {
    const id = await ensurePageId(dir, formatPageId);
    expect(id).toMatch(/^page-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/);
    expect((await fs.readFile(pageIdFile(), "utf8")).trim()).toBe(id);
  });

  it("keeps the id a folder already holds, writing nothing again", async () => {
    await fs.writeFile(pageIdFile(), "page-a-page-of-its-own\n");
    const before = await fs.stat(pageIdFile());
    expect(await ensurePageId(dir, formatPageId)).toBe("page-a-page-of-its-own");
    const after = await fs.stat(pageIdFile());
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("replaces a file holding junk, since junk is never a Session's source", async () => {
    await fs.writeFile(pageIdFile(), "not a page id\n");
    const id = await ensurePageId(dir, formatPageId);
    expect(id).toMatch(/^page-/);
    expect((await fs.readFile(pageIdFile(), "utf8")).trim()).toBe(id);
  });

  it("answers one id when two callers race for the same folder", async () => {
    const ids = await Promise.all([
      ensurePageId(dir, formatPageId),
      ensurePageId(dir, formatPageId),
      ensurePageId(dir, formatPageId),
    ]);
    expect(new Set(ids).size).toBe(1);
    expect((await fs.readFile(pageIdFile(), "utf8")).trim()).toBe(ids[0]);
  });
});

describe("a folder's page id and its source", () => {
  it("is not part of the source, of the revision, or of the ui revision", async () => {
    const before = await readFolder(dir, "demo");
    expect(before).not.toBeNull();
    expect(before!.pageId).toBeNull();
    const id = await ensurePageId(dir, formatPageId);
    const after = await readFolder(dir, "demo");
    expect(after).not.toBeNull();
    expect(after!.pageId).toBe(id);
    expect(after!.files).toEqual(before!.files);
    expect(after!.revision).toBe(before!.revision);
    expect(after!.uiRev).toBe(before!.uiRev);
    expect(after!.files.some((rel) => rel.startsWith(".page-id"))).toBe(false);
  });

  it("is read back whatever else the folder holds, and survives a version's state file", async () => {
    const id = await ensurePageId(dir, formatPageId);
    await fs.writeFile(path.join(dir, STATE_FILE), "{}");
    const folder = await readFolder(dir, "demo");
    expect(folder!.pageId).toBe(id);
    expect(folder!.files).not.toContain(STATE_FILE);
  });
});
