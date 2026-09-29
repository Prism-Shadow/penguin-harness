/**
 * Making sure every media file a QA deploy's data names is in the media repository.
 *
 * A file the draft holds (generated or uploaded media) is copied into the media clone when the
 * clone lacks it or holds different bytes; the clone is partial and sparse, so the folder the
 * file goes in is added to its sparse set first. A file the draft does not hold must already
 * be in the repository (a Loom asset, or one published before): that is asked of git's trees,
 * which a partial clone has without downloading any file. A file found in neither is missing,
 * and the stage fails naming it. Files are copied as they are: nothing is re-encoded.
 *
 * git goes through the stage's runner, so a test answers it with a fake; files are read and
 * written only inside the draft roots and the media clone.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { mediaRepoPath } from "./deploy-git.js";
import { withinRoot } from "./sandbox-paths.js";

export interface MediaGitResult {
  code: number | null;
  stdout: string;
}

export interface MediaSyncPorts {
  /**
   * Runs git in the media clone. A failure ends the stage unless `allowFailure` is set, in
   * which case its exit code comes back.
   */
  git(
    args: string[],
    options?: { allowFailure?: boolean; quiet?: boolean },
  ): Promise<MediaGitResult>;
  log(text: string): void;
}

export interface MediaSyncInput {
  /** The media clone. */
  dir: string;
  /** Every media file the data names, as a path in the repository (`media/…`). */
  references: readonly string[];
  /** Each deployed ref's draft media folder, which a `media/…` path resolves against less `media/`. */
  draftRoots: readonly string[];
}

export interface MediaSyncResult {
  /** Files copied into the clone (new or changed), as repository paths. */
  copied: string[];
  /** Files found nowhere. */
  missing: string[];
  /** Files the repository already had as they are. */
  present: number;
}

async function isFile(file: string): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => null);
  return Boolean(stat?.isFile());
}

async function sameBytes(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    fs.readFile(a).catch(() => null),
    fs.readFile(b).catch(() => null),
  ]);
  return left !== null && right !== null && left.equals(right);
}

/** Where a repository path's file is in a draft, or null when no draft holds it. */
export async function draftSource(
  reference: string,
  draftRoots: readonly string[],
): Promise<string | null> {
  if (!reference.startsWith("media/")) return null;
  const relative = reference.slice("media/".length);
  for (const root of draftRoots) {
    const file = withinRoot(root, relative);
    if (file && (await isFile(file))) return file;
  }
  return null;
}

/** Whether a folder of the sparse set (cone mode) already brings `reference` into the tree. */
export function sparseCovers(sparse: readonly string[], reference: string): boolean {
  return sparse.some((entry) => {
    const folder = entry.trim().replace(/^\/+|\/+$/g, "");
    return folder !== "" && reference.startsWith(`${folder}/`);
  });
}

export async function syncMedia(
  input: MediaSyncInput,
  ports: MediaSyncPorts,
): Promise<MediaSyncResult> {
  const result: MediaSyncResult = { copied: [], missing: [], present: 0 };
  /** The clone's sparse folders; null until asked, "all" when it is not sparse at all. */
  let sparse: string[] | "all" | null = null;
  for (const reference of input.references) {
    // The data names `media/...`; the clone is the media repository, which that folder is.
    const inRepo = mediaRepoPath(reference);
    const target = inRepo ? withinRoot(input.dir, inRepo) : null;
    if (!inRepo || !target) {
      result.missing.push(reference);
      continue;
    }
    const source = await draftSource(reference, input.draftRoots);
    if (source) {
      if (sparse === null) {
        const listed = await ports.git(["sparse-checkout", "list"], {
          allowFailure: true,
          quiet: true,
        });
        // A clone that is not sparse (an existing checkout) has every folder already, and git
        // refuses to add to a sparse set it does not have.
        sparse = listed.code === 0 ? listed.stdout.split(/\r?\n/).filter(Boolean) : "all";
      }
      const folder = path.posix.dirname(inRepo);
      if (sparse !== "all" && !sparseCovers(sparse, inRepo)) {
        await ports.git(["sparse-checkout", "add", folder]);
        sparse.push(folder);
      }
      if (await sameBytes(source, target)) {
        result.present++;
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      result.copied.push(inRepo);
      continue;
    }
    const listed = await ports.git(["ls-tree", "--name-only", "HEAD", "--", inRepo], {
      allowFailure: true,
      quiet: true,
    });
    if (listed.code === 0 && listed.stdout.trim() !== "") result.present++;
    else result.missing.push(reference);
  }
  ports.log(
    `Media: ${result.present} already in the repository, ${result.copied.length} copied, ${result.missing.length} missing.`,
  );
  return result;
}
