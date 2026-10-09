/**
 * A Benchmark's manifest, benchmark.json (src/state/benchmark-manifest.ts).
 *
 * - A manifest written is read back as written, and the file on disk is that manifest as JSON.
 * - A directory with neither benchmark.json nor the legacy TOML is not a Benchmark, and neither
 *   is one whose name is not an id (`.seeding/`, `.harbor/`).
 * - A manifest that breaks a rule is refused with a code naming the rule (an id other than the
 *   directory's is `benchmark_id_mismatch`); a field it does not know is ignored.
 * - A manifest the reader would refuse is never written.
 * - Versions: a new revision is the day's `.1`; another the same day takes the next number
 *   (`.10` after `.9`); a later day starts again at `.1`; a version never goes backwards; a
 *   previous version that does not parse counts for nothing.
 * - compat(0.3.0), a Benchmark from before benchmark.json:
 *   - a TOML-only Benchmark reads as its TOML says and gets a benchmark.json beside the TOML,
 *     which stays; its version is the day the TOML was last written, `.1`; a seeded id is
 *     `builtin`, any other `agent`;
 *   - the TOML is read as leniently as before: no title is the directory name, no or an unknown
 *     status is published, no runs is 1;
 *   - when both files are there, benchmark.json is the one read and the TOML is left alone;
 *   - a draft is read but not converted until its TOML says it is done;
 *   - a TOML that does not parse is refused and nothing is written;
 *   - a data root that cannot be written to still reads the Benchmark.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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

/** Writes `fields` as benchmark.json, raw: what an Agent or a person may have put there. */
async function writeRaw(dir: string, fields: unknown): Promise<void> {
  await fs.writeFile(
    path.join(dir, "benchmark.json"),
    typeof fields === "string" ? fields : JSON.stringify(fields),
  );
}

/** Writes a legacy benchmark_config.toml last written on `day` (local noon, so no zone moves the day). */
async function writeLegacy(dir: string, toml: string, day = new Date(2026, 6, 16, 12)) {
  const file = path.join(dir, "benchmark_config.toml");
  await fs.writeFile(file, toml);
  await fs.utimes(file, day, day);
}

describe("benchmark.json", () => {
  it("a manifest written is read back as written, and the file is that manifest as JSON", async () => {
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
    expect(JSON.parse(await fs.readFile(path.join(dir, "benchmark.json"), "utf8"))).toEqual(
      written,
    );
  });

  it("a directory with no manifest, or whose name is not an id, is not a Benchmark", async () => {
    const empty = await benchDir("half-deleted");
    await fs.writeFile(path.join(empty, "scoreboard.yaml"), "evaluations: []\n");
    const staging = await benchDir(".seeding");
    await writeRaw(staging, manifest({ id: ".seeding" }));

    expect(await readBenchmarkManifest(empty)).toBeNull();
    expect(await readBenchmarkManifest(staging)).toBeNull();
  });

  it.each([
    ["not JSON", "{ title: nope", "benchmark_manifest_invalid"],
    ["not an object", "[]", "benchmark_manifest_invalid"],
    ["another directory's id", { ...manifest(), id: "other-bench" }, "benchmark_id_mismatch"],
    [
      "an id outside the id characters",
      { ...manifest(), id: "../x" },
      "benchmark_manifest_invalid",
    ],
    ["a blank title", { ...manifest(), title: "  " }, "benchmark_manifest_invalid"],
    [
      "a title over 200 characters",
      { ...manifest(), title: "t".repeat(201) },
      "benchmark_manifest_invalid",
    ],
    [
      "a description over 2000 characters",
      { ...manifest(), description: "d".repeat(2001) },
      "benchmark_manifest_invalid",
    ],
    ["no version", { ...manifest(), version: undefined }, "benchmark_manifest_invalid"],
    [
      "a version that is not a date version",
      { ...manifest(), version: "1.0.0" },
      "benchmark_manifest_invalid",
    ],
    ["no status", { ...manifest(), status: undefined }, "benchmark_manifest_invalid"],
    ["a status nobody defined", { ...manifest(), status: "someday" }, "benchmark_manifest_invalid"],
    ["zero runs", { ...manifest(), runs: 0 }, "benchmark_manifest_invalid"],
    ["a fractional run count", { ...manifest(), runs: 1.5 }, "benchmark_manifest_invalid"],
    ["more than 1000 runs", { ...manifest(), runs: 1001 }, "benchmark_manifest_invalid"],
    ["no origin", { ...manifest(), origin: undefined }, "benchmark_manifest_invalid"],
    [
      "an origin kind nobody defined",
      { ...manifest(), origin: { kind: "ftp" } },
      "benchmark_manifest_invalid",
    ],
    [
      "an origin link that is not http(s)",
      { ...manifest(), origin: { kind: "git", url: "javascript:alert(1)" } },
      "benchmark_manifest_invalid",
    ],
    [
      "an origin ref that is a branch, not a commit",
      {
        ...manifest(),
        origin: { kind: "git", url: "https://github.com/o/r/tree/main/x", ref: "main" },
      },
      "benchmark_manifest_invalid",
    ],
  ])("a manifest with %s is refused", async (_case, fields, code) => {
    const dir = await benchDir("report-writing-v1");
    await writeRaw(dir, fields);

    const error = await readBenchmarkManifest(dir).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BenchmarkManifestError);
    expect((error as BenchmarkManifestError).code).toBe(code);
  });

  it("a field the manifest does not know is ignored, so a later release's manifest still reads", async () => {
    const dir = await benchDir("report-writing-v1");
    await writeRaw(dir, { ...manifest(), license: "MIT", origin: { kind: "zip", mirror: "x" } });

    expect(await readBenchmarkManifest(dir)).toEqual(manifest({ origin: { kind: "zip" } }));
  });

  it("a manifest the reader would refuse is never written", async () => {
    const dir = await benchDir("report-writing-v1");

    await expect(writeBenchmarkManifest(dir, manifest({ runs: 0 }))).rejects.toBeInstanceOf(
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

describe("compat(0.3.0): a Benchmark from before benchmark.json", () => {
  it("a TOML-only Benchmark reads as its TOML says and gets a benchmark.json beside the TOML, which stays", async () => {
    const dir = await benchDir("report-writing-v1");
    const toml =
      'title = "Report writing"\ndescription = "Hard cases"\nruns = 2\nstatus = "published"\n';
    await writeLegacy(dir, toml);

    const read = await readBenchmarkManifest(dir);

    const adopted: BenchmarkManifest = {
      id: "report-writing-v1",
      title: "Report writing",
      description: "Hard cases",
      version: "2026.07.16.1",
      status: "published",
      runs: 2,
      origin: { kind: "agent" },
    };
    expect(read).toEqual(adopted);
    expect(JSON.parse(await fs.readFile(path.join(dir, "benchmark.json"), "utf8"))).toEqual(
      adopted,
    );
    expect(await fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8")).toBe(toml);
  });

  it.each(["example-benchmark", "penguinharness-benchmark-sec-c"])(
    "a copy seeded under %s before benchmark.json is adopted as builtin",
    async (id) => {
      const dir = await benchDir(id);
      await writeLegacy(dir, 'title = "Seeded"\nruns = 1\nstatus = "published"\n');

      expect((await readBenchmarkManifest(dir))?.origin).toEqual({ kind: "builtin" });
    },
  );

  it("the TOML is read as leniently as before: no title is the directory name, no status is published, no runs is 1", async () => {
    const dir = await benchDir("swe-bench-v1");
    await writeLegacy(dir, 'description = "Old"\n');
    const unknown = await benchDir("unknown-bench");
    await writeLegacy(unknown, 'title = "Unknown"\nruns = 5000\nstatus = "someday"\n');

    expect(await readBenchmarkManifest(dir)).toMatchObject({
      title: "swe-bench-v1",
      status: "published",
      runs: 1,
    });
    expect(await readBenchmarkManifest(unknown)).toMatchObject({ status: "published", runs: 1000 });
  });

  it("when both files are there, benchmark.json is the one read and the TOML is left alone", async () => {
    const dir = await benchDir("report-writing-v1");
    const toml = 'title = "Stale title"\nruns = 9\nstatus = "draft"\n';
    await writeLegacy(dir, toml);
    await writeBenchmarkManifest(dir, manifest());

    expect(await readBenchmarkManifest(dir)).toEqual(manifest());
    expect(await fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8")).toBe(toml);
  });

  it("a draft is read but not converted until its TOML says it is done", async () => {
    const dir = await benchDir("report-writing-v1");
    await writeLegacy(dir, 'title = "Report writing"\nruns = 1\nstatus = "draft"\n');

    expect(await readBenchmarkManifest(dir)).toMatchObject({ status: "draft" });
    expect(await exists(path.join(dir, "benchmark.json"))).toBe(false);

    // The copy of benchmark-design that is still building it publishes into the TOML.
    await writeLegacy(dir, 'title = "Report writing"\nruns = 1\nstatus = "published"\n');

    expect(await readBenchmarkManifest(dir)).toMatchObject({ status: "published" });
    expect(await exists(path.join(dir, "benchmark.json"))).toBe(true);
  });

  it("a TOML that does not parse is refused, and nothing is written", async () => {
    const dir = await benchDir("report-writing-v1");
    await writeLegacy(dir, "title = \n");

    const error = await readBenchmarkManifest(dir).catch((e: unknown) => e);

    expect((error as BenchmarkManifestError).code).toBe("benchmark_config_invalid");
    expect(await exists(path.join(dir, "benchmark.json"))).toBe(false);
  });

  // A directory's mode does not stop Windows from writing into it, nor root anywhere.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "a data root that cannot be written to still reads the Benchmark",
    async () => {
      const dir = await benchDir("report-writing-v1");
      await writeLegacy(dir, 'title = "Report writing"\nruns = 1\nstatus = "published"\n');
      await fs.chmod(dir, 0o555);
      try {
        expect(await readBenchmarkManifest(dir)).toMatchObject({ title: "Report writing" });
        expect(await exists(path.join(dir, "benchmark.json"))).toBe(false);
      } finally {
        await fs.chmod(dir, 0o755);
      }
    },
  );
});
