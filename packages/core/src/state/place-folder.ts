/**
 * Writing one folder into a directory of folders, all at once: the copy is staged in a temporary
 * directory under `<dir>/.seeding/` and renamed into `<dir>/<id>`, so a write that fails part-way
 * leaves nothing under the id. The seeds a built-in plugin ships for a system app's data are
 * written this way (the server's services/app-seeds.ts).
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Where a folder is written under its directory before it is renamed into place. */
export const PLACE_STAGING_DIR = ".seeding";

/** Whether anything is under `p`, a symlink included wherever it points. */
async function occupied(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export interface PlaceFolderOptions {
  /** Replace whatever is already under the id, whole; without it the id must be free. */
  replace?: boolean;
}

/**
 * The last placement asked for per directory, settled either way: the next one starts after it.
 * Two that overlap race each other's renames — one can move the other's fresh copy aside and fail
 * to put its own old one back, which then stays under `.seeding/` for good — and one finishing
 * removes `.seeding/` while the next is about to stage in it.
 */
const placing = new Map<string, Promise<void>>();

/**
 * Writes the folder `id` into `dir`: `write` fills a temporary directory under `.seeding/`, which
 * is then renamed to `<dir>/<id>`. A write that fails part-way leaves nothing under the id, and the
 * staging directory goes as soon as it is empty.
 *
 * Without `replace` the id has to be free, so a caller that must not overwrite checks first. A copy
 * that another writer got under the id first — after that check, or between the two renames of a
 * replacement — fails this one with EEXIST, whatever the platform reported (a rename onto a
 * directory that holds anything is ENOTEMPTY or EEXIST, and EPERM on Windows). With `replace`,
 * what is under the id is moved aside, the new copy is renamed in, and only then is the old one
 * removed: the id never holds a half-written copy, and holds nothing only between the two renames.
 * A symlink under the id is moved and removed as a link; what it points to is never touched.
 *
 * Placements into one `dir` made by this process run one at a time, in the order they were asked
 * for (see {@link placing}); the other writer above is another process.
 */
export function placeFolder(
  dir: string,
  id: string,
  write: (folder: string) => Promise<void>,
  options: PlaceFolderOptions = {},
): Promise<void> {
  const key = path.resolve(dir);
  const placed = (placing.get(key) ?? Promise.resolve()).then(() => place(dir, id, write, options));
  const settled = placed.then(
    () => {},
    () => {},
  );
  placing.set(key, settled);
  void settled.then(() => {
    if (placing.get(key) === settled) placing.delete(key);
  });
  return placed;
}

async function place(
  dir: string,
  id: string,
  write: (folder: string) => Promise<void>,
  options: PlaceFolderOptions,
): Promise<void> {
  const staging = path.join(dir, PLACE_STAGING_DIR);
  await fs.mkdir(staging, { recursive: true });
  try {
    const tmp = await fs.mkdtemp(path.join(staging, `${id}-`));
    try {
      await write(tmp);
      const target = path.join(dir, id);
      if (options.replace === true) await swapIn(tmp, target);
      else await renameInto(tmp, target);
    } catch (error) {
      await fs.rm(tmp, { recursive: true, force: true });
      throw error;
    }
  } finally {
    // Empty once this folder is out of it, unless another process is still writing there.
    await fs.rmdir(staging).catch(() => {});
  }
}

/**
 * Renames the staged copy `incoming` to `target`. When that fails with something under `target`
 * — another writer's copy, renamed in first — the failure is EEXIST on every platform.
 */
async function renameInto(incoming: string, target: string): Promise<void> {
  try {
    await fs.rename(incoming, target);
  } catch (error) {
    if (!(await occupied(target))) throw error;
    throw Object.assign(new Error(`Already taken: ${target}`, { cause: error }), {
      code: "EEXIST",
    });
  }
}

/** Renames `incoming` to `target`, moving what is there aside first and removing it afterwards. */
async function swapIn(incoming: string, target: string): Promise<void> {
  // A sibling of the staged copy, unique because the staged copy's name is.
  const aside = `${incoming}.replaced`;
  let moved = false;
  try {
    await fs.rename(target, aside);
    moved = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await renameInto(incoming, target);
  } catch (error) {
    // Put the old copy back rather than leave the id empty — unless another writer's copy took
    // the id in the meantime, which replaced the old one as surely as this one would have.
    if (moved) {
      await fs.rename(aside, target).catch(async () => {
        if (await occupied(target)) {
          await fs.rm(aside, { recursive: true, force: true }).catch(() => {});
        }
      });
    }
    throw error;
  }
  // The new copy is in place; an old one that cannot be removed now stays under staging, which
  // is never listed, rather than failing a replacement that has already happened.
  if (moved) await fs.rm(aside, { recursive: true, force: true }).catch(() => {});
}
