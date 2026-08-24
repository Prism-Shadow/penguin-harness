/**
 * A machine's own identity: one UUID per machine, kept at `<data root>/machine-id`.
 *
 * Minted by the server that runs there, not by whoever is looking at it. That is what makes
 * it an identity rather than a label: two controllers that both install to a host read back
 * the SAME id, and it survives the host being renamed, re-aliased in someone's ssh config,
 * or reached through a different jump host.
 *
 * The ssh alias cannot do that job. An alias is a line in one machine's config file — the
 * same host is `build-box` here and `bb` there, and two aliases for one host are two names
 * for one machine. Aliases stay what people READ (they are what someone chose and what they
 * recognise); the UUID is what anything stored has to point at.
 *
 * The file is deliberately not in the program directory: reinstalling replaces the program
 * and must not hand the machine a new identity, while wiping the data root is already
 * "start over as a new machine".
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function machineIdPath(dataRoot: string): string {
  return path.join(dataRoot, "machine-id");
}

/** A well-formed UUID, or null. Anything else on disk is treated as no id at all. */
export function parseMachineId(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed.toLowerCase()
    : null;
}

/**
 * This machine's id, minted on first call and stable ever after.
 *
 * Written through a temp file and a rename: an identity read back half-written would be a
 * DIFFERENT machine as far as everything pointing at it is concerned, which is worse than
 * failing to write one. A damaged file is replaced rather than honoured — a value that is
 * not a UUID never came from here.
 *
 * Racing servers on one data root are settled by the rename: both mint, one wins, and the
 * winner is what every later read returns. (Two servers sharing a data root is already
 * refused by the lock; this only has to not corrupt anything if it ever happens.)
 */
export function readOrCreateMachineId(dataRoot: string): string {
  const file = machineIdPath(dataRoot);
  const existing = parseMachineId(readIfPresent(file));
  if (existing !== null) return existing;

  const minted = randomUUID();
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(tmp, `${minted}\n`);
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the temp file is litter at worst */
    }
    // Could not persist it. Re-read once: the likely cause is another process having just
    // written one, and adopting theirs beats handing out an id that will not survive.
    return parseMachineId(readIfPresent(file)) ?? minted;
  }
  // Read back rather than trusting the write: a concurrent rename may have landed last.
  return parseMachineId(readIfPresent(file)) ?? minted;
}

function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
