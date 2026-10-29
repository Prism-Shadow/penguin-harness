/**
 * A Benchmark's manifest, benchmark_config.toml (src/state/benchmark-manifest.ts).
 *
 * - A manifest written is read back as written. The file is TOML: the keys an older release reads
 *   (title, description, runs, status) stay top-level, `id` and `version` beside them, and the
 *   `[origin]` table comes last.
 * - A manifest written before `id`, `version` and `[origin]` existed reads as it always did and is
 *   left as it is: its directory's id, unversioned, of unknown origin.
 * - The older keys keep their lenient reading: no title is the directory name, a status that is
 *   neither draft nor failed (or none) is published, and a run count that is not a positive
 *   integer is left out.
 * - A field the manifest does not know is ignored, so a later release's manifest still reads.
 * - A directory with no manifest is not a Benchmark, and neither is one whose name is not an id
 *   (`.seeding/`, `.harbor/`).
 * - A manifest whose new keys are out of shape is refused with a code naming the rule: an `id`
 *   other than the directory's is `benchmark_id_mismatch`; an `id` outside the id characters, a
 *   version that is not a date version, an origin that is not a table of a known kind, an origin
 *   link that is not http(s) and an origin ref that is not a commit are `benchmark_manifest_invalid`,
 *   and so is a file that is not TOML.
 * - An origin's `imported_at` written as a TOML date-time reads as its ISO 8601 text.
 * - A manifest beyond the limits a written one keeps (a blank or over-long title, an over-long
 *   description, a run count outside 1..1000, a status nobody defined, a bad version or origin) is
 *   never written.
 * - Versions: a new revision is the day's `.1`; another the same day takes the next number
 *   (`.10` after `.9`); a later day starts again at `.1`; a version never goes backwards; a
 *   previous version that does not parse counts for nothing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BenchmarkManifestError,
  nextDateVersion,
  readBenchmarkManifest,
  writeBenchmarkManifest,
  type BenchmarkManifest,
} from "../src/state/index.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bench-manifest-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A Benchmark directory under the temp root, created empty. */
async function benchDir(id: string): Promise<string> {
  const dir = path.join(tmp, id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

const manifest = (over: Partial<BenchmarkManifest> = {}): BenchmarkManifest => ({
  id: "report-writing-v1",
  title: "Report writing",
  description: "Hard cases for the report writer",
  version: "2026.10.09.1",
  status: "published",
  runs: 2,
  origin: { kind: "manual" },
  ...over,
});

/** Writes `toml` as the directory's benchmark_config.toml, raw: what an Agent or a person may have put there. */
async function writeRaw(dir: string, toml: string): Promise<void> {
  await fs.writeFile(path.join(dir, "benchmark_config.toml"), toml);
}

async function readRaw(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8");
}

/** The error reading `dir`'s manifest throws, or the manifest when it does not throw. */
async function refusal(dir: string): Promise<unknown> {
  return readBenchmarkManifest(dir).catch((e: unknown) => e);
}

describe("benchmark_config.toml", () => {
  it("a manifest written is read back as written, and an older reader finds its keys where they always were", async () => {
    const dir = await benchDir("report-writing-v1");
    const written = manifest({
      origin: {
        kind: "git",
        url: "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/main/packages/x",
        ref: "c12d65bc20beb5130ed57b3b7983c62d497b7d2f",
        path: "packages/x",
        imported_at: "2026-10-09T08:00:00.000Z",
      },
    });

    await writeBenchmarkManifest(dir, written);

    expect(await readBenchmarkManifest(dir)).toEqual(written);
    // Plain TOML: title, description, runs and status are top-level, as a reader from before the
    // new keys expects, and the origin is a table of its own that holds nothing else.
    expect(parseToml(await readRaw(dir))).toEqual(written);
  });

  it("a manifest from before id, version and origin reads as it always did, and is left as it is", async () => {
    const dir = await benchDir("swe-bench-v1");
    // What earlier releases' seeding, the create form and benchmark-design wrote.
    const old =
      'title = "SWE Bench v1"\ndescription = "Hard cases"\nruns = 2\nstatus = "published"\n\n';
    await writeRaw(dir, old);

    expect(await readBenchmarkManifest(dir)).toEqual({
      id: "swe-bench-v1",
      title: "SWE Bench v1",
      description: "Hard cases",
      status: "published",
      runs: 2,
    });
    expect(await readRaw(dir)).toBe(old);
    expect(await fs.readdir(dir)).toEqual(["benchmark_config.toml"]);
  });

  it("the older keys are read as leniently as ever: no title is the directory name, no status or an unknown one is published, a bad run count is left out", async () => {
    const bare = await benchDir("bare-bench");
    await writeRaw(bare, 'description = "Old"\n');
    const odd = await benchDir("odd-bench");
    await writeRaw(odd, 'title = ""\nruns = 0\nstatus = "someday"\n');
    const draft = await benchDir("draft-bench");
    await writeRaw(draft, 'title = "Draft"\nruns = "two"\nstatus = "draft"\n');

    expect(await readBenchmarkManifest(bare)).toEqual({
      id: "bare-bench",
      title: "bare-bench",
      description: "Old",
      status: "published",
    });
    expect(await readBenchmarkManifest(odd)).toEqual({
      id: "odd-bench",
      title: "odd-bench",
      status: "published",
    });
    expect(await readBenchmarkManifest(draft)).toEqual({
      id: "draft-bench",
      title: "Draft",
      status: "draft",
    });
  });

  it("a field the manifest does not know is ignored, so a later release's manifest still reads", async () => {
    const dir = await benchDir("report-writing-v1");
    await writeRaw(
      dir,
      'id = "report-writing-v1"\ntitle = "Report writing"\nlicense = "MIT"\n\n[origin]\nkind = "zip"\nmirror = "x"\n',
    );

    expect(await readBenchmarkManifest(dir)).toEqual({
      id: "report-writing-v1",
      title: "Report writing",
      status: "published",
      origin: { kind: "zip" },
    });
  });

  it("a directory with no manifest, or whose name is not an id, is not a Benchmark", async () => {
    const empty = await benchDir("half-deleted");
    await fs.writeFile(path.join(empty, "scoreboard.yaml"), "evaluations: []\n");
    const staging = await benchDir(".seeding");
    await writeRaw(staging, 'title = "Staged"\n');

    expect(await readBenchmarkManifest(empty)).toBeNull();
    expect(await readBenchmarkManifest(staging)).toBeNull();
  });

  it.each([
    ["another directory's id", 'id = "other-bench"\ntitle = "Copy"\n', "benchmark_id_mismatch"],
    ["an id outside the id characters", 'id = "../x"\n', "benchmark_manifest_invalid"],
    ["an id that is not text", "id = 7\n", "benchmark_manifest_invalid"],
    ["a version that is not a date version", 'version = "1.0.0"\n', "benchmark_manifest_invalid"],
    ["a version that is not text", "version = 2026\n", "benchmark_manifest_invalid"],
    ["an origin that is not a table", 'origin = "git"\n', "benchmark_manifest_invalid"],
    ["an origin kind nobody defined", '[origin]\nkind = "ftp"\n', "benchmark_manifest_invalid"],
    [
      "an origin without a kind",
      '[origin]\nurl = "https://x.test/"\n',
      "benchmark_manifest_invalid",
    ],
    [
      "an origin link that is not http(s)",
      '[origin]\nkind = "git"\nurl = "javascript:alert(1)"\n',
      "benchmark_manifest_invalid",
    ],
    [
      "an origin ref that is a branch, not a commit",
      '[origin]\nkind = "git"\nurl = "https://github.com/o/r/tree/main/x"\nref = "main"\n',
      "benchmark_manifest_invalid",
    ],
    ["an empty origin path", '[origin]\nkind = "git"\npath = ""\n', "benchmark_manifest_invalid"],
    ["text that is not TOML", "title = \n", "benchmark_manifest_invalid"],
  ])("a manifest with %s is refused", async (_case, toml, code) => {
    const dir = await benchDir("report-writing-v1");
    await writeRaw(dir, toml);

    const error = await refusal(dir);

    expect(error).toBeInstanceOf(BenchmarkManifestError);
    expect((error as BenchmarkManifestError).code).toBe(code);
  });

  it("a refusal names what is wrong, for the person who has to fix the file", async () => {
    const copied = await benchDir("copied-bench");
    await writeRaw(copied, 'id = "report-writing-v1"\n');
    const broken = await benchDir("broken-bench");
    await writeRaw(broken, 'title = "Broken"\nstatus = \n');

    const mismatch = (await refusal(copied)) as BenchmarkManifestError;
    const notToml = (await refusal(broken)) as BenchmarkManifestError;

    expect(mismatch.message).toContain("report-writing-v1");
    expect(mismatch.message).toContain("copied-bench");
    // One line, with where the file breaks; never the parser's code frame.
    expect(notToml.message).toContain("line 2");
    expect(notToml.message).not.toContain("\n");
  });

  it("an origin's imported_at written as a TOML date-time reads as its ISO 8601 text", async () => {
    const dir = await benchDir("report-writing-v1");
    await writeRaw(dir, '[origin]\nkind = "zip"\nimported_at = 2026-10-09T08:00:00Z\n');

    expect((await readBenchmarkManifest(dir))?.origin).toEqual({
      kind: "zip",
      imported_at: "2026-10-09T08:00:00.000Z",
    });
  });

  it.each([
    ["a blank title", manifest({ title: "  " })],
    ["a title over 200 characters", manifest({ title: "t".repeat(201) })],
    ["a description over 2000 characters", manifest({ description: "d".repeat(2001) })],
    ["zero runs", manifest({ runs: 0 })],
    ["a fractional run count", manifest({ runs: 1.5 })],
    ["more than 1000 runs", manifest({ runs: 1001 })],
    ["a status nobody defined", manifest({ status: "someday" as BenchmarkManifest["status"] })],
    ["a version that is not a date version", manifest({ version: "v2" })],
    ["an origin ref that is not a commit", manifest({ origin: { kind: "git", ref: "main" } })],
    ["an id outside the id characters", manifest({ id: "../x" })],
  ])("a manifest with %s is never written", async (_case, refused) => {
    const dir = await benchDir("report-writing-v1");

    await expect(writeBenchmarkManifest(dir, refused)).rejects.toBeInstanceOf(
      BenchmarkManifestError,
    );
    expect(await fs.readdir(dir)).toEqual([]);
  });
});

describe("Benchmark versions", () => {
  const oct9 = new Date(2026, 9, 9, 12);

  it("a new Benchmark's first version is the day's .1", () => {
    expect(nextDateVersion(undefined, oct9)).toBe("2026.10.09.1");
  });

  it("another revision the same day takes the next number, and .10 follows .9", () => {
    expect(nextDateVersion("2026.10.09.1", oct9)).toBe("2026.10.09.2");
    expect(nextDateVersion("2026.10.09.9", oct9)).toBe("2026.10.09.10");
  });

  it("a revision on a later day starts again at .1", () => {
    expect(nextDateVersion("2026.10.08.7", oct9)).toBe("2026.10.09.1");
  });

  it("a version never goes backwards: one dated after today takes its next number", () => {
    expect(nextDateVersion("2026.10.11.2", oct9)).toBe("2026.10.11.3");
  });

  it("a previous version that does not parse counts for nothing: the day's .1", () => {
    expect(nextDateVersion("v2", oct9)).toBe("2026.10.09.1");
    expect(nextDateVersion("", oct9)).toBe("2026.10.09.1");
  });
});
