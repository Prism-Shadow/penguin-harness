/**
 * A Benchmark package as a zip, both ways: reading the one a member uploads to the Evaluation
 * Center, and packing a Benchmark's directory for the Export button on its page.
 *
 * The package is what core's benchmark-manifest.ts defines: `benchmark_config.toml` and every
 * `CASE-*` tree. Everything else in a Benchmark's directory belongs to that copy and never travels:
 * `scoreboard.yaml` (its evaluation records), the `.jobs/` Harbor trials, any other entry whose
 * name starts with a dot, and symlinks. Packing leaves them out. An upload carrying one of them at
 * its top level — or anything else that is neither `benchmark_config.toml` nor a `CASE-*`
 * directory — is refused, naming the entry, rather than trimmed: such a zip is a copy of
 * someone's directory, not a package. A dot-entry inside a case (a `.DS_Store`) is no part of the
 * package either; it is skipped on the way in, as it is on the way out. A link or other special
 * file is refused wherever it is: fflate hands every entry back as plain bytes, so the type is
 * read from the central directory.
 *
 * Both directions hold the same caps — 1000 files, 5MB a file and 20MB inflated (the declared
 * sizes, checked before anything inflates), 14MB zipped — and the same manifest rules (core's
 * checkBenchmarkManifest on top of what the list reads), so whatever Export produces, Import
 * takes back. Nothing in a package is ever executed: it is Markdown and the small files its cases
 * name.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strFromU8, zipSync } from "fflate";
import { parse as parseToml } from "smol-toml";
import {
  BENCHMARK_MANIFEST,
  BenchmarkManifestError,
  checkBenchmarkManifest,
  isValidId,
  parseBenchmarkManifest,
  type BenchmarkManifest,
} from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import {
  MAX_ARCHIVE_BYTES,
  MAX_BENCHMARK_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  assertSafeEntryPath,
  unzipBounded,
} from "./skill-import-limits.js";

/** A case's directory: `CASE-` and the id alphabet, the create route's rule for a case id. */
const CASE_DIR = /^CASE-[A-Za-z0-9_-]+$/;

/** The two READMEs that make a case: its statement and its rubric. */
const CASE_READMES = ["statement/README.md", "rubric/README.md"] as const;

/**
 * A control character, NUL above all: no disk takes NUL in a name, and a name holding any other
 * one never lists as it is (a newline splits it, an escape sequence redraws the terminal).
 */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * The time every exported entry carries: fixed, so that exporting an unchanged Benchmark again
 * gives the same bytes. Built from local fields because a zip stores local time — 1980-01-01, the
 * format's first day, reads back as itself in every time zone.
 */
const PACKAGE_MTIME = new Date(1980, 0, 1);

/** Code-unit order: the same on every machine, whatever its locale. */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** A package read from an upload: its manifest, and the files of its cases. */
export interface BenchmarkPackage {
  manifest: BenchmarkManifest;
  /** Every case file, keyed by its path inside the Benchmark's directory ("/"-separated). */
  caseFiles: Map<string, Uint8Array>;
}

/** Over the caps, in either direction. */
export function benchmarkTooLarge(message: string): HttpError {
  return new HttpError(413, "benchmark_too_large", message);
}

function archiveInvalid(message: string): HttpError {
  return new HttpError(400, "benchmark_archive_invalid", message);
}

/**
 * The `id` a manifest declares, for a zip whose `benchmark_config.toml` sits at the root and has
 * no directory to be named by: "" when it names none, which the manifest's parser then refuses as
 * a missing id — and text that is not TOML is the parser's to refuse too.
 */
function declaredId(text: string): string {
  try {
    const { id } = parseToml(text);
    return typeof id === "string" ? id : "";
  } catch {
    return "";
  }
}

/**
 * The entries a zip records as something other than a regular file or a directory — a symbolic
 * link above all. Only the central directory says so: a Unix zipper (host 3) keeps the entry's
 * `st_mode` in the high half of its external attributes. An archive made elsewhere records no type
 * there, and its entries are plain files. The directory is not re-validated here; this runs after
 * fflate has read the same archive without complaint.
 */
function specialEntries(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end-of-central-directory record: 22 bytes, then a comment of up to 64KB, at the very end.
  let end = -1;
  for (let i = zip.byteLength - 22; i >= Math.max(0, zip.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return [];
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const found: string[] = [];
  for (let n = 0; n < count && at + 46 <= zip.byteLength; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const host = view.getUint8(at + 5);
    const utf8 = (view.getUint16(at + 8, true) & 0x800) !== 0;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const type = (view.getUint32(at + 38, true) >>> 16) & 0o170000;
    if (host === 3 && type !== 0 && type !== 0o100000 && type !== 0o040000) {
      found.push(strFromU8(zip.subarray(at + 46, at + 46 + nameLength), !utf8));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return found;
}

/**
 * Reads an uploaded zip as a Benchmark package, or refuses it. In order: the zipped size (413
 * `benchmark_too_large` over 14MB; an empty upload is 400 `benchmark_archive_invalid`), the caps
 * read off the central directory before inflating (413), every entry's path (zip-slip, control
 * characters) and type (no links), the layout (`benchmark_config.toml` at the root, where it must
 * then name its id, or exactly one top-level directory holding it, whose name must then be the
 * manifest's id), what the package may hold (above), names a disk that ignores letter case would
 * take for one, the manifest (core's parser, then the limits a written manifest keeps; their
 * error code and message, 400), its status (400 `benchmark_not_published` unless `published`: a
 * draft or a failed calibration is not a package anyone can use) and the cases (400
 * `benchmark_case_invalid`: at least one, each with both READMEs).
 */
export function readBenchmarkArchive(archive: Uint8Array): BenchmarkPackage {
  if (archive.byteLength === 0) throw archiveInvalid("The zip archive is empty.");
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw benchmarkTooLarge("The zip archive exceeds the 14MB limit.");
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipBounded(archive, {
      maxFiles: MAX_BENCHMARK_ARCHIVE_FILES,
      tooLarge: benchmarkTooLarge,
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw archiveInvalid("dataBase64 is not a valid zip archive.");
  }
  for (const name of Object.keys(entries)) {
    try {
      assertSafeEntryPath(name);
    } catch (error) {
      throw archiveInvalid((error as Error).message);
    }
    if (CONTROL_CHARACTER.test(name)) {
      throw archiveInvalid(`Invalid zip entry path (control character): ${JSON.stringify(name)}`);
    }
  }
  const special = specialEntries(archive);
  if (special.length > 0) {
    throw archiveInvalid(
      `A package holds regular files only; this entry is a link or a special file: ${special[0]}`,
    );
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (files.length === 0) throw archiveInvalid("The zip archive contains no files.");

  const names = files.map(([name]) => name);
  let prefix = "";
  let dirName: string | undefined;
  if (!names.includes(BENCHMARK_MANIFEST)) {
    const topLevels = new Set(names.map((name) => name.split("/", 1)[0]!));
    dirName = topLevels.size === 1 ? [...topLevels][0] : undefined;
    if (dirName === undefined || !names.includes(`${dirName}/${BENCHMARK_MANIFEST}`)) {
      throw archiveInvalid(
        `The zip must contain ${BENCHMARK_MANIFEST} at its root, or exactly one top-level directory containing it.`,
      );
    }
    // The directory names the Benchmark whenever its manifest does not.
    if (!isValidId(dirName)) {
      throw archiveInvalid(
        `The top-level directory must be named by the Benchmark's id (letters, digits, "_" and "-"): ${dirName}`,
      );
    }
    prefix = `${dirName}/`;
  }

  let manifestText = "";
  const caseFiles = new Map<string, Uint8Array>();
  for (const [name, data] of files) {
    const rel = name.slice(prefix.length);
    if (rel === BENCHMARK_MANIFEST) {
      manifestText = strFromU8(data);
      continue;
    }
    // A file entry named like the top-level directory leaves nothing once the prefix is off.
    if (rel === "") throw archiveInvalid(`Invalid zip entry path (names a directory): ${name}`);
    const segments = rel.split("/");
    const top = segments[0]!;
    if (top.startsWith(".") || top === "scoreboard.yaml") {
      throw archiveInvalid(
        `A package never carries a copy's own state (scoreboard.yaml, .jobs/ or another entry starting with "."): ${name}`,
      );
    }
    if (!CASE_DIR.test(top) || segments.length < 2) {
      throw archiveInvalid(
        `A package holds only ${BENCHMARK_MANIFEST} and CASE-* directories (letters, digits, "_" and "-" after CASE-): ${name}`,
      );
    }
    if (segments.some((segment) => segment.startsWith("."))) continue;
    caseFiles.set(rel, data);
  }
  // Every path the copy will hold, as a disk that ignores letter case (macOS, Windows) sees it:
  // two entries it takes for one would land one over the other, and a file where another entry
  // needs a directory would fail the write half-way.
  const claimed = new Map<string, { path: string; directory: boolean }>();
  const claim = (p: string, directory: boolean): void => {
    const key = p.normalize("NFC").toLowerCase();
    const prior = claimed.get(key);
    if (prior === undefined) {
      claimed.set(key, { path: p, directory });
    } else if (prior.directory !== directory) {
      throw archiveInvalid(
        `Invalid zip entry path (a file where a directory must be): ${directory ? prior.path : p}`,
      );
    } else if (prior.path !== p) {
      throw archiveInvalid(
        `Invalid zip entry path (the same name as ${prior.path} where letter case is ignored): ${p}`,
      );
    }
  };
  for (const rel of caseFiles.keys()) {
    const segments = rel.split("/");
    for (let i = 1; i < segments.length; i++) claim(segments.slice(0, i).join("/"), true);
    claim(rel, false);
  }

  let manifest: BenchmarkManifest;
  try {
    manifest = parseBenchmarkManifest(manifestText, dirName ?? declaredId(manifestText));
    // What the copy's manifest will be written to: the list reads an older, hand-edited file
    // leniently, but a package that crosses servers holds to the create form's limits.
    checkBenchmarkManifest(manifest);
  } catch (error) {
    if (error instanceof BenchmarkManifestError)
      throw new HttpError(400, error.code, error.message);
    throw error;
  }
  if (manifest.status !== "published") {
    throw new HttpError(
      400,
      "benchmark_not_published",
      `Only a published Benchmark can be imported; this package is ${manifest.status}.`,
    );
  }

  const cases = [...new Set([...caseFiles.keys()].map((rel) => rel.split("/", 1)[0]!))].sort();
  if (cases.length === 0) {
    throw new HttpError(
      400,
      "benchmark_case_invalid",
      "The package holds no case: a CASE-* directory with statement/README.md and rubric/README.md.",
    );
  }
  for (const caseId of cases) {
    for (const readme of CASE_READMES) {
      if (!caseFiles.has(`${caseId}/${readme}`)) {
        throw new HttpError(400, "benchmark_case_invalid", `${caseId} has no ${readme}.`);
      }
    }
  }
  return { manifest, caseFiles };
}

/**
 * The package of the Benchmark in `benchDir` as a zip under one top-level `<id>/` directory: its
 * `benchmark_config.toml` as the file reads (origin included, so the receiver can tell where it
 * came from) and every `CASE-*` tree, minus dot-entries, symlinks and other special files. Over
 * the import's caps it is a 413, since the zip could not be imported anywhere; a manifest gone
 * since `manifest` was read is a 404, since the Benchmark went with it.
 */
export async function packBenchmark(
  benchDir: string,
  manifest: BenchmarkManifest,
): Promise<Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  let count = 0;
  let total = 0;
  const tooLarge = () =>
    benchmarkTooLarge(
      `Benchmark exceeds the package limits (${MAX_BENCHMARK_ARCHIVE_FILES} files, 5MB per file, 20MB in all, 14MB zipped).`,
    );
  const add = (rel: string, data: Uint8Array) => {
    count += 1;
    total += data.byteLength;
    if (count > MAX_BENCHMARK_ARCHIVE_FILES || data.byteLength > MAX_FILE_BYTES) throw tooLarge();
    if (total > MAX_TOTAL_BYTES) throw tooLarge();
    out[`${manifest.id}/${rel}`] = data;
  };
  const walk = async (abs: string, rel: string): Promise<void> => {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const entry of entries.sort(byName)) {
      if (entry.name.startsWith(".")) continue;
      const child = path.join(abs, entry.name);
      if (entry.isDirectory()) await walk(child, `${rel}/${entry.name}`);
      else if (entry.isFile())
        add(`${rel}/${entry.name}`, new Uint8Array(await fs.readFile(child)));
    }
  };

  let manifestBytes: Uint8Array;
  try {
    manifestBytes = new Uint8Array(await fs.readFile(path.join(benchDir, BENCHMARK_MANIFEST)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new HttpError(404, "not_found", `Benchmark does not exist: ${manifest.id}`);
  }
  add(BENCHMARK_MANIFEST, manifestBytes);
  const top = await fs.readdir(benchDir, { withFileTypes: true });
  for (const entry of top.sort(byName)) {
    if (entry.isDirectory() && CASE_DIR.test(entry.name)) {
      await walk(path.join(benchDir, entry.name), entry.name);
    }
  }
  const zip = zipSync(out, { mtime: PACKAGE_MTIME });
  if (zip.byteLength > MAX_ARCHIVE_BYTES) throw tooLarge();
  return zip;
}
