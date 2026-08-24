/**
 * A machine's own identity: one short random id per machine, kept at `<data root>/machine-id`.
 *
 * Minted by the server that runs there, not by whoever is looking at it. That is what makes
 * it an identity rather than a label: two controllers that both install to a host read back
 * the SAME id, and it survives the host being renamed, re-aliased in someone's ssh config,
 * or reached through a different jump host.
 *
 * The ssh alias cannot do that job. An alias is a line in one machine's config file — the
 * same host is `build-box` here and `bb` there, and two aliases for one host are two names
 * for one machine. Aliases stay what people READ (they are what someone chose and what they
 * recognise); this id is what anything stored has to point at.
 *
 * The file is deliberately not in the program directory: reinstalling replaces the program
 * and must not hand the machine a new identity, while wiping the data root is already
 * "start over as a new machine".
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * 12 random bytes, base64url — 16 characters, and 96 bits of it.
 *
 * Twelve because it divides by three: base64 encodes three bytes to four characters, so
 * this is the longest id with no `=` padding to strip and no partial group to think about.
 * base64url rather than base64 because the id ends up in paths, query strings and file
 * names, where `+` and `/` do not survive.
 *
 * 96 bits is far past what this needs — ids are minted independently on machines that never
 * coordinate, so the bar is the birthday bound, and even a million machines collide with
 * probability around 1e-17. The length is the constraint that matters: a person reads these
 * in a tooltip and a log line, and a 36-character UUID is a wall.
 */
const MACHINE_ID_BYTES = 12;

/** The minted shape: 16 base64url characters. */
const MACHINE_ID_RE = /^[A-Za-z0-9_-]{16}$/;

/**
 * The shape minted before the id was shortened. Still accepted, and never rewritten: a
 * machine that already answered with one of these IS that machine to everything pointing at
 * it, and re-minting would quietly turn it into a different one.
 */
const LEGACY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function machineIdPath(dataRoot: string): string {
  return path.join(dataRoot, "machine-id");
}

/** A well-formed id, or null. Anything else on disk is treated as no id at all. */
export function parseMachineId(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (MACHINE_ID_RE.test(trimmed)) return trimmed; // base64url is case-SIGNIFICANT
  return LEGACY_UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * This machine's id, minted on first call and stable ever after.
 *
 * Written through a temp file and a rename: an identity read back half-written would be a
 * DIFFERENT machine as far as everything pointing at it is concerned, which is worse than
 * failing to write one. A damaged file is replaced rather than honoured — a value that is
 * not one of these shapes never came from here.
 *
 * Racing servers on one data root are settled by the rename: both mint, one wins, and the
 * winner is what every later read returns. (Two servers sharing a data root is already
 * refused by the lock; this only has to not corrupt anything if it ever happens.)
 */
export function readOrCreateMachineId(dataRoot: string): string {
  const file = machineIdPath(dataRoot);
  const existing = parseMachineId(readIfPresent(file));
  if (existing !== null) return existing;

  const minted = randomBytes(MACHINE_ID_BYTES).toString("base64url");
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
