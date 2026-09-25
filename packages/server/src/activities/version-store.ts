/**
 * Where versions are kept: a row per version in `activity_versions`, and content-addressed
 * blobs under the activity's own `versions/blobs/` directory.
 *
 * A blob is named by the SHA-256 of its bytes, so a file every version shares is stored once.
 * It is written beside its final name and renamed into place, so a crash never leaves a
 * partial blob under a real digest, and every read checks the digest again.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { newId } from "./domain.js";
import { withinRoot } from "./sandbox-paths.js";
import type { VersionKind, VersionReason, VersionSummary } from "./version-types.js";

const SHA256 = /^[a-f0-9]{64}$/;

export interface VersionRow {
  versionId: string;
  activityId: string;
  seq: number;
  label: string | null;
  kind: VersionKind;
  reason: VersionReason | null;
  contentHash: string;
  manifestSha: string;
  mediaBytes: number;
  moduleRunId: string | null;
  sourceVersionId: string | null;
  authorUserId: string | null;
  deployedQaAt: string | null;
  deployedProdAt: string | null;
  createdAt: string;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The activity's blob directory; `activityDir` is `<collection>/activities/<activityId>`. */
export function blobsDir(activityDir: string): string {
  return path.join(activityDir, "versions", "blobs");
}

/** A blob's file, refused unless the digest is well formed and stays inside the blob directory. */
export function blobFile(activityDir: string, digest: string): string {
  const file = SHA256.test(digest) ? withinRoot(blobsDir(activityDir), digest) : null;
  if (!file) throw new HttpError(400, "version_blob_invalid", "The version blob name is invalid.");
  return file;
}

/** Store bytes as a blob and return its digest; a blob already stored intact is kept as it is. */
export async function writeBlob(activityDir: string, bytes: Uint8Array): Promise<string> {
  const digest = sha256(bytes);
  const file = blobFile(activityDir, digest);
  const existing = await fs.readFile(file).catch(() => null);
  if (existing && sha256(existing) === digest) return digest;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${newId("tmp")}`;
  try {
    await fs.writeFile(temp, bytes, { flag: "wx" });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
  return digest;
}

/** A blob's bytes, checked against its digest. */
export async function readBlob(activityDir: string, digest: string): Promise<Buffer> {
  const file = blobFile(activityDir, digest);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat || !stat.isFile())
    throw new HttpError(404, "version_blob_missing", "A file of this version is missing.");
  const bytes = await fs.readFile(file);
  if (sha256(bytes) !== digest)
    throw new HttpError(409, "version_blob_corrupt", "A file of this version has changed on disk.");
  return bytes;
}

export function writeVersion(db: Db, row: VersionRow): void {
  db.prepare(
    `INSERT INTO activity_versions (version_id, activity_id, seq, label, kind, reason,
      content_hash, manifest_sha, media_bytes, module_run_id, source_version_id,
      author_user_id, deployed_qa_at, deployed_prod_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.versionId,
    row.activityId,
    row.seq,
    row.label,
    row.kind,
    row.reason,
    row.contentHash,
    row.manifestSha,
    row.mediaBytes,
    row.moduleRunId,
    row.sourceVersionId,
    row.authorUserId,
    row.deployedQaAt,
    row.deployedProdAt,
    row.createdAt,
  );
}

/** Every version of an activity, newest first. */
export function listVersions(db: Db, activityId: string): VersionRow[] {
  return (
    db
      .prepare("SELECT * FROM activity_versions WHERE activity_id = ? ORDER BY seq DESC")
      .all(activityId) as Record<string, unknown>[]
  ).map(mapRow);
}

export function latestVersion(db: Db, activityId: string): VersionRow | null {
  const row = db
    .prepare("SELECT * FROM activity_versions WHERE activity_id = ? ORDER BY seq DESC LIMIT 1")
    .get(activityId) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export function summarizeVersion(row: VersionRow, currentHash: string | null): VersionSummary {
  return {
    versionId: row.versionId,
    seq: row.seq,
    label: row.label,
    kind: row.kind,
    reason: row.reason,
    createdAt: row.createdAt,
    author: row.authorUserId,
    mediaBytes: row.mediaBytes,
    current: currentHash !== null && row.contentHash === currentHash,
    deployed: { qa: row.deployedQaAt, prod: row.deployedProdAt },
  };
}

function mapRow(row: Record<string, unknown>): VersionRow {
  return {
    versionId: row.version_id as string,
    activityId: row.activity_id as string,
    seq: row.seq as number,
    label: (row.label as string | null) ?? null,
    kind: row.kind as VersionKind,
    reason: (row.reason as VersionReason | null) ?? null,
    contentHash: row.content_hash as string,
    manifestSha: row.manifest_sha as string,
    mediaBytes: row.media_bytes as number,
    moduleRunId: (row.module_run_id as string | null) ?? null,
    sourceVersionId: (row.source_version_id as string | null) ?? null,
    authorUserId: (row.author_user_id as string | null) ?? null,
    deployedQaAt: (row.deployed_qa_at as string | null) ?? null,
    deployedProdAt: (row.deployed_prod_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}
