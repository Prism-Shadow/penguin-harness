/**
 * The version store: blobs are content-addressed, stored once, checked on every read and kept
 * inside the activity's blob directory; rows list newest first and say which one is current.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_SQL } from "../src/db/schema.js";
import type { Db } from "../src/hmr/capabilities.js";
import { HttpError } from "../src/http/errors.js";
import {
  blobFile,
  blobsDir,
  latestVersion,
  listVersions,
  readBlob,
  sha256,
  summarizeVersion,
  writeBlob,
  writeVersion,
  type VersionRow,
} from "../src/activities/version-store.js";

const sqlite = process.getBuiltinModule("node:sqlite");

async function status(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof HttpError ? `${error.status} ${error.code}` : String(error);
  }
  return undefined;
}

describe("version blobs", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });
  async function activityDir() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-versions-"));
    roots.push(root);
    return path.join(root, "activities", "act_1");
  }

  it("names a blob by its digest and stores equal bytes once", async () => {
    const dir = await activityDir();
    const bytes = Buffer.from("hello");
    const digest = await writeBlob(dir, bytes);
    expect(digest).toBe(sha256(bytes));
    expect(await writeBlob(dir, Buffer.from("hello"))).toBe(digest);
    expect(await fs.readdir(blobsDir(dir))).toEqual([digest]);
    expect((await readBlob(dir, digest)).toString()).toBe("hello");
  });

  it("refuses a blob whose bytes no longer match its name, and repairs it on the next write", async () => {
    const dir = await activityDir();
    const digest = await writeBlob(dir, Buffer.from("original"));
    await fs.writeFile(blobFile(dir, digest), "tampered");
    expect(await status(readBlob(dir, digest))).toBe("409 version_blob_corrupt");
    await writeBlob(dir, Buffer.from("original"));
    expect((await readBlob(dir, digest)).toString()).toBe("original");
    expect(await fs.readdir(blobsDir(dir))).toEqual([digest]);
  });

  it("reports a missing blob", async () => {
    const dir = await activityDir();
    expect(await status(readBlob(dir, "c".repeat(64)))).toBe("404 version_blob_missing");
  });

  it("refuses any name that is not a digest, so nothing reaches outside the blob directory", async () => {
    const dir = await activityDir();
    for (const name of ["../draft.json", `..${path.sep}${"a".repeat(64)}`, "A".repeat(64), ""]) {
      expect(() => blobFile(dir, name)).toThrow(HttpError);
      expect(await status(readBlob(dir, name))).toBe("400 version_blob_invalid");
    }
    expect(path.dirname(blobFile(dir, "a".repeat(64)))).toBe(blobsDir(dir));
  });
});

describe("version rows", () => {
  function database(): Db {
    const db = new sqlite.DatabaseSync(":memory:");
    db.exec(SCHEMA_SQL);
    db.exec(
      "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES ('act_1', 'c', 'p', 1, 'T', 'standard', 'now', 'now', 0)",
    );
    return db as unknown as Db;
  }
  const row = (seq: number, contentHash: string): VersionRow => ({
    versionId: `ver_${seq}`,
    activityId: "act_1",
    seq,
    label: seq === 1 ? "First" : null,
    kind: "manual",
    reason: null,
    contentHash,
    manifestSha: contentHash,
    mediaBytes: seq * 10,
    moduleRunId: null,
    sourceVersionId: null,
    authorUserId: "author",
    deployedQaAt: null,
    deployedProdAt: null,
    createdAt: `2026-09-25T00:00:0${seq}.000Z`,
    draftStatus: "valid",
  });

  it("lists newest first and marks the one matching the current content", () => {
    const db = database();
    expect(latestVersion(db, "act_1")).toBeNull();
    writeVersion(db, row(1, "a".repeat(64)));
    writeVersion(db, row(2, "b".repeat(64)));
    const rows = listVersions(db, "act_1");
    expect(rows.map((r) => r.seq)).toEqual([2, 1]);
    expect(rows[1]).toEqual(row(1, "a".repeat(64)));
    expect(latestVersion(db, "act_1")?.seq).toBe(2);
    expect(rows.map((r) => summarizeVersion(r, "a".repeat(64)).current)).toEqual([false, true]);
    expect(summarizeVersion(rows[1]!, null)).toEqual({
      versionId: "ver_1",
      seq: 1,
      label: "First",
      kind: "manual",
      reason: null,
      createdAt: "2026-09-25T00:00:01.000Z",
      author: "author",
      mediaBytes: 10,
      current: false,
      deployed: { qa: null, prod: null },
    });
  });

  it("refuses a second version with the same number", () => {
    const db = database();
    writeVersion(db, row(1, "a".repeat(64)));
    expect(() => writeVersion(db, { ...row(1, "b".repeat(64)), versionId: "ver_x" })).toThrow();
  });
});
