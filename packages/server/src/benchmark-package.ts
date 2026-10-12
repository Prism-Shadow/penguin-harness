/**
 * A Benchmark package on this machine as the zip `POST /api/projects/:p/benchmarks/archive` takes:
 * what `penguin benchmark import` uploads. A zip file goes as it is. A folder is zipped whole, its
 * entries at the zip's root and nothing left out — dot-entries, stray files and links included, a
 * link as a link — so that the server's checks (services/benchmark-archive.ts) see what the folder
 * holds and refuse by name what a package may not carry. Nothing is trimmed here: an Agent that
 * imports a folder gets the verdict a person uploading its zip would.
 *
 * The folder is held to the import's caps while it is read — 1000 files, 5MB a file, 20MB in all,
 * 14MB zipped — so a wrong path (a whole repository, say) fails at once rather than being read
 * into memory for the server to refuse.
 *
 * Published as `@prismshadow/penguin-server/benchmark-package`, side-effect-free and without the
 * server, for the CLI.
 */
import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";
import {
  MAX_ARCHIVE_BYTES,
  MAX_BENCHMARK_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from "./services/skill-import-limits.js";

/** Why a path cannot go up as a Benchmark package; the caller words it. */
export type BenchmarkUploadProblem =
  | { kind: "missing" }
  /** Neither a folder nor a file. */
  | { kind: "unsupported" }
  | { kind: "tooManyFiles"; limit: number }
  /** `file` is the entry's path inside the folder. */
  | { kind: "fileTooLarge"; file: string; limitBytes: number }
  /** The folder's files add up to more than the package may hold. */
  | { kind: "tooLarge"; limitBytes: number }
  /** The zip, given or made, is larger than an upload may be. */
  | { kind: "zipTooLarge"; limitBytes: number };

export class BenchmarkUploadError extends Error {
  constructor(readonly problem: BenchmarkUploadProblem) {
    super(`Not a Benchmark package upload: ${problem.kind}`);
    this.name = "BenchmarkUploadError";
  }
}

/** The zip format's host id for Unix: an entry's high attribute bits are then its `st_mode`. */
const UNIX_HOST = 3;

/** The `st_mode` an entry that is neither a file nor a directory is recorded with. */
function specialMode(entry: Dirent): number {
  if (entry.isSymbolicLink()) return 0o120777;
  if (entry.isSocket()) return 0o140644;
  if (entry.isBlockDevice()) return 0o060644;
  if (entry.isCharacterDevice()) return 0o020644;
  return 0o010644; // a FIFO, or a type this platform does not name
}

/** Code-unit order: the same zip from the same folder, whatever the locale. */
function byName(a: Dirent, b: Dirent): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * The bytes to upload for `source`: the zip file itself, or the folder zipped as the module doc
 * says. Throws BenchmarkUploadError for a path that cannot go up (nothing there, past a cap), and
 * whatever the filesystem throws for a path it cannot read.
 */
export async function readBenchmarkUpload(source: string): Promise<Uint8Array> {
  let stat: Stats;
  try {
    stat = await fs.stat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BenchmarkUploadError({ kind: "missing" });
    }
    throw error;
  }
  const zipTooLarge = () =>
    new BenchmarkUploadError({ kind: "zipTooLarge", limitBytes: MAX_ARCHIVE_BYTES });
  if (stat.isFile()) {
    if (stat.size > MAX_ARCHIVE_BYTES) throw zipTooLarge();
    return new Uint8Array(await fs.readFile(source));
  }
  if (!stat.isDirectory()) throw new BenchmarkUploadError({ kind: "unsupported" });

  const files: Zippable = {};
  let count = 0;
  let total = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort(byName)) {
      const abs = path.join(dir, entry.name);
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        await walk(abs, `${name}/`);
        continue;
      }
      count += 1;
      if (count > MAX_BENCHMARK_ARCHIVE_FILES) {
        throw new BenchmarkUploadError({
          kind: "tooManyFiles",
          limit: MAX_BENCHMARK_ARCHIVE_FILES,
        });
      }
      if (!entry.isFile()) {
        // A link or a special file goes in as what it is, its type in the entry's mode and a
        // link's target as its content, for the server to refuse by name: never followed, never
        // read.
        const target = entry.isSymbolicLink() ? await fs.readlink(abs).catch(() => "") : "";
        files[name] = [strToU8(target), { os: UNIX_HOST, attrs: specialMode(entry) << 16 }];
        continue;
      }
      const size = (await fs.stat(abs)).size;
      if (size > MAX_FILE_BYTES) {
        throw new BenchmarkUploadError({
          kind: "fileTooLarge",
          file: name,
          limitBytes: MAX_FILE_BYTES,
        });
      }
      total += size;
      if (total > MAX_TOTAL_BYTES) {
        throw new BenchmarkUploadError({ kind: "tooLarge", limitBytes: MAX_TOTAL_BYTES });
      }
      files[name] = new Uint8Array(await fs.readFile(abs));
    }
  };
  await walk(source, "");
  const zip = zipSync(files);
  if (zip.byteLength > MAX_ARCHIVE_BYTES) throw zipTooLarge();
  return zip;
}
