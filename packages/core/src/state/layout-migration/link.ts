/**
 * The links the layout migration leaves at the old places, so every absolute path recorded
 * before the move — in a Trace, in a stale installed Skill copy, in an open conversation's
 * system prompt — still reaches the same files, and a write through one lands in the new place
 * instead of quietly re-creating an old folder no new build lists.
 *
 * POSIX gets a relative symbolic link, which stays valid wherever the data root is later moved.
 * Windows gets a directory junction: it needs no privilege (a symbolic link there needs Developer
 * Mode or an administrator), and it takes an absolute target, so moving the whole data root later
 * breaks it, as it breaks every recorded absolute path. A junction from an earlier move whose
 * target was inside a folder that moved since is re-pointed ({@link repointLink}).
 *
 * Compatibility owner: core's `state/layout-migration/`; the links stay until 1.0, when a cleanup
 * step removes them with the migration.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { lstatOrNull } from "./move.js";

/** Whether `p` is a link: a symbolic link, or on Windows a junction (Node reads both as a link). */
export async function isLink(p: string): Promise<boolean> {
  return (await lstatOrNull(p))?.isSymbolicLink() === true;
}

/** A link's target, absolute; null when `p` is not a link. Windows' `\\?\` prefix is dropped. */
export async function linkTarget(p: string): Promise<string | null> {
  if (!(await isLink(p))) return null;
  const raw = (await fs.readlink(p)).replace(/^\\\\\?\\/, "");
  return path.resolve(path.dirname(p), raw);
}

/** Whether `child` is `parent` or lies under it. */
export function isUnder(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Leaves a link at `at` to the directory `target`. A link already there is kept when it reaches
 * `target`, and replaced when it reaches anything else; a real file or folder at `at` is never
 * replaced (the caller moved what was there).
 */
export async function linkDir(
  at: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const existing = await linkTarget(at);
  if (existing !== null) {
    if (path.resolve(existing) === path.resolve(target)) return;
    await fs.unlink(at);
  }
  if (platform === "win32") await fs.symlink(path.resolve(target), at, "junction");
  else await fs.symlink(path.relative(path.dirname(at), target), at, "dir");
}

/**
 * Re-points the link at `at` when its target is absolute and lies under `from`: it then reaches
 * the same place under `to`. A relative link moved with its folder and needs nothing; a link
 * anywhere else is left alone. Answers whether it was re-pointed.
 */
export async function repointLink(
  at: string,
  from: string,
  to: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (!(await isLink(at))) return false;
  const raw = (await fs.readlink(at)).replace(/^\\\\\?\\/, "");
  if (!path.isAbsolute(raw) || !isUnder(from, raw)) return false;
  const target = path.join(to, path.relative(from, raw));
  await fs.unlink(at);
  await fs.symlink(target, at, platform === "win32" ? "junction" : "dir");
  return true;
}
