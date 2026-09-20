/**
 * The mirror of an organization that runs on another machine.
 *
 * An organization belongs to the Project, so the Project's own server always holds its files;
 * it RUNS where its shared workspace is. When that is another machine, that machine's server
 * is the one writing the files — its employees work there, and the Web App sends the
 * organization's requests there — and this server copies them back: the listing, the
 * organization's place in the Project and a copy that outlives the machine come from here.
 *
 * One direction, whole files, by content hash: what the running side has is what the mirror
 * becomes, files it no longer has included. `workspace/` is no part of it (it is a directory
 * on that machine, and may be anything), nor is anything dot-named.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OrgDeps, OrgMachineApi } from "./deps.js";

/** A file of the organization directory, `path` relative to it with `/` separators. */
export interface OrgMirrorEntry {
  path: string;
  sha256: string;
  size: number;
}

/** The largest single file the mirror carries; a handbook attachment beyond it is skipped. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SKIPPED_TOP_LEVEL = new Set(["workspace"]);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Every mirrored file under `dir`, sorted by path. */
export async function mirrorManifest(dir: string): Promise<OrgMirrorEntry[]> {
  const out: OrgMirrorEntry[] = [];
  const walk = async (rel: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (rel === "" && SKIPPED_TOP_LEVEL.has(entry.name)) continue;
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) {
        const stat = await fs.stat(path.join(dir, child));
        if (stat.size > MAX_FILE_BYTES) continue;
        out.push({
          path: child,
          sha256: sha256(await fs.readFile(path.join(dir, child))),
          size: stat.size,
        });
      }
    }
  };
  await walk("");
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** A mirrored path is relative, stays inside the directory, and names nothing skipped. */
export function isMirrorPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || part.startsWith(".")))
    return false;
  return !SKIPPED_TOP_LEVEL.has(parts[0]!);
}

/** One mirrored file's bytes; null when it is not a mirrored path or does not exist. */
export async function readMirrorFile(dir: string, rel: string): Promise<Buffer | null> {
  if (!isMirrorPath(rel)) return null;
  try {
    return await fs.readFile(path.join(dir, ...rel.split("/")));
  } catch {
    return null;
  }
}

const orgBase = (projectId: string, orgId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/organizations/${encodeURIComponent(orgId)}`;

export type MirrorOutcome =
  | { kind: "mirrored"; written: number; removed: number }
  | { kind: "unreachable" }
  | { kind: "failed"; detail: string };

/**
 * Brings this server's copy of an organization up to what the machine running it has. A
 * machine that is not connected leaves the copy as it is: not reaching a machine says nothing
 * about what is on it.
 */
export async function pullMirror(
  deps: Pick<OrgDeps, "store" | "machines">,
  projectId: string,
  orgId: string,
  machineId: string,
  api?: OrgMachineApi | null,
): Promise<MirrorOutcome> {
  const remote = api ?? (await deps.machines?.api(machineId)) ?? null;
  if (remote === null) return { kind: "unreachable" };
  const base = orgBase(projectId, orgId);
  let listing: { status: number; text: string };
  try {
    listing = await remote.request("GET", `${base}/mirror`);
  } catch (err) {
    return { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
  if (listing.status !== 200) {
    return { kind: "failed", detail: `the machine answered ${listing.status} for the file list` };
  }
  const theirs = (JSON.parse(listing.text) as { files: OrgMirrorEntry[] }).files;
  const dir = deps.store.dir(projectId, orgId);
  const ours = new Map((await mirrorManifest(dir)).map((e) => [e.path, e.sha256]));
  let written = 0;
  for (const entry of theirs) {
    if (!isMirrorPath(entry.path) || ours.get(entry.path) === entry.sha256) continue;
    const got = await remote.request(
      "GET",
      `${base}/mirror/file?path=${encodeURIComponent(entry.path)}`,
    );
    if (got.status !== 200) continue; // Gone since it was listed: the next pass settles it.
    const bytes = Buffer.from((JSON.parse(got.text) as { base64: string }).base64, "base64");
    const file = path.join(dir, ...entry.path.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Dot-named, so a copy cut short is never listed as a file of the organization.
    const staged = path.join(path.dirname(file), `.${path.basename(file)}.mirror-tmp`);
    await fs.writeFile(staged, bytes);
    await fs.rename(staged, file);
    written++;
  }
  const kept = new Set(theirs.map((e) => e.path));
  let removed = 0;
  for (const rel of ours.keys()) {
    if (kept.has(rel)) continue;
    await fs.rm(path.join(dir, ...rel.split("/")), { force: true });
    removed++;
  }
  return { kind: "mirrored", written, removed };
}
