/**
 * Benchmark packages as zips: importing one into the Evaluation Center
 * (`POST /api/projects/:p/benchmarks/archive`) and exporting one from a Benchmark's page
 * (`GET /api/projects/:p/benchmarks/:benchmarkId/archive`).
 *
 * - A member imports a package: it lists with its cases and the package's version, an empty
 *   scoreboard and origin `zip`; its files land byte for byte, and a dot-entry inside a case is
 *   left out. A package zipped at its root imports under the id its manifest declares. A package
 *   whose manifest predates `id`, `version` and `origin` imports under its directory's name,
 *   unversioned, and its copy's manifest names the id from then on. A package
 *   an Agent fetched from a repository folder (`penguin benchmark import --origin-…`) lists with
 *   that folder as its git origin; an origin that is not a git folder at a commit is refused. A
 *   folder zipped as that command uploads it (benchmark-package.ts) imports as its zip would, and
 *   is refused by name when it holds the copy's own state or a link. An outsider cannot import.
 * - A second import of a taken id is a 409 whose details name the id, and changes nothing; with
 *   `overwrite` the directory is replaced whole, its evaluation records and `.jobs/` gone — but
 *   not while an evaluation of it is still running (a trial under `.jobs/` without its result, or
 *   the Test Agent's State packed for one), which is a 409 `benchmark_busy` that changes nothing
 *   until the evaluation ends. Overwrites of one id sent at once each land or answer that 409,
 *   never a failure, and leave one whole copy.
 * - An export carries `benchmark_config.toml` as the file reads and the cases, and none of the
 *   copy's own state (scoreboard, `.jobs/`, dot-entries, symlinks, stray files); it imports back
 *   as the same package with no scores. A Benchmark without a version exports as `<id>.zip`.
 *   Exporting an unchanged Benchmark again, later, gives the same bytes.
 * - A zip that is not a package is refused before anything is written: entries that climb out
 *   (zip-slip), absolute or backslashed paths, names holding a control character, names a disk
 *   that ignores letter case would take for one, a link, the copy's own state, anything else at
 *   the top level, a draft, a case without both READMEs, a directory named other than its id or
 *   by no id at all, a manifest at the root that names no id, a manifest that is not TOML, one
 *   past the create form's limits, two top-level directories, bytes that are not a zip, an empty
 *   upload. So is one past the caps — over 14MB zipped, more than 1000 files, an entry declaring
 *   more than it may inflate to — with 413.
 * - Only a published Benchmark has a package to export: a draft or a failed one, one whose
 *   manifest cannot be read, and one whose hand-edited manifest is past what an import takes,
 *   answer 409 with the reason; a missing one 404; one holding a file past the caps 413; an
 *   outsider 404.
 *
 * One app for the file; every case works in a Project of its own, with `benchmarks/` emptied of
 * the Benchmarks a new Project is seeded with.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Zippable } from "fflate";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { benchmarksDir } from "@prismshadow/penguin-core";
import { readBenchmarkUpload } from "../src/benchmark-package.js";
import type {
  BenchmarkArchiveImportResponse,
  BenchmarksResponse,
  ErrorBody,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, canCreateSymlink, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SHA = "c12d65bc20beb5130ed57b3b7983c62d497b7d2f";
const FOLDER = `https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/${SHA}/packages/report-writing-v1`;

/** A manifest as the package carries it; a key `over` sets to undefined is left out of the file. */
function manifest(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: "Report writing under conflicting sources",
    description: "Two cases: conflicting briefs, a strict format.",
    version: "2026.10.08.3",
    status: "published",
    runs: 2,
    origin: { kind: "builtin" },
    ...over,
  };
}

/** The cases of the package every scenario starts from, by path inside the Benchmark. */
const CASES: Record<string, string> = {
  "CASE-001-contradictions/statement/README.md": "# Two briefs\n\nWrite the report.\n",
  "CASE-001-contradictions/statement/materials/brief-a.md": "Brief A says 3%.\n",
  "CASE-001-contradictions/rubric/README.md":
    "- 100 pts: names the conflict and takes the newer source.\n",
  "CASE-002-format/statement/README.md": "# A strict format\n\nTwo pages, cited.\n",
  "CASE-002-format/rubric/README.md": "- 100 pts: two pages, every claim cited.\n",
};

/** A package's zip entries under `dir/` (or at the root when `dir` is ""), the manifest's id `id`. */
function packageFiles(
  id: string,
  dir: string = id,
  over: Record<string, unknown> = {},
): Record<string, Uint8Array> {
  const at = (rel: string) => (dir === "" ? rel : `${dir}/${rel}`);
  const files: Record<string, Uint8Array> = {
    [at("benchmark_config.toml")]: strToU8(stringifyToml(manifest(id, over))),
  };
  for (const [rel, text] of Object.entries(CASES)) files[at(rel)] = strToU8(text);
  return files;
}

const zipB64 = (files: Zippable): string => Buffer.from(zipSync(files)).toString("base64");

/**
 * A zip whose named entries declare `declared` bytes uncompressed, in the local header and the
 * central directory alike, over the payload they really hold: the shape of a zip bomb, since a
 * reader allocates what the header says.
 */
function zipB64Declaring(files: Record<string, Uint8Array>, declared: Record<string, number>) {
  const zip = zipSync(files);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const nameAt = (start: number, lenAt: number, nameOffset: number): string =>
    decoder.decode(
      zip.subarray(start + nameOffset, start + nameOffset + view.getUint16(start + lenAt, true)),
    );
  for (let i = 0; i + 4 <= zip.byteLength; i++) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) {
      const size = declared[nameAt(i, 26, 30)];
      if (size !== undefined) view.setUint32(i + 22, size, true);
    }
    if (signature === 0x02014b50) {
      const size = declared[nameAt(i, 28, 46)];
      if (size !== undefined) view.setUint32(i + 24, size, true);
    }
  }
  return Buffer.from(zip).toString("base64");
}

/** One evaluation, in the scoreboard shape the list reads. */
const SCOREBOARD = [
  "evaluations:",
  '  - time: "2026-10-08T10:00:00Z"',
  "    agent_id: default_agent",
  "    version: 1",
  "    provider: deepseek",
  "    model_id: deepseek-v4-pro",
  "    thinking_level: medium",
  "    score: 50",
  "    cost: null",
  "    duration_ms: 1000",
  "    cases:",
  "      - case: CASE-001-contradictions",
  "        score: 50",
  "        cost: null",
  "        duration_ms: 1000",
  "        runs:",
  "          - score: 50",
  "            cost: null",
  "            duration_ms: 1000",
  "            session_id: session-1",
  "",
].join("\n");

/** One evaluation cell's Harbor job under `.jobs/`, and the trial directory Harbor writes in it. */
const JOB = "CASE-001-contradictions-run1-20261008T100000Z";
const TRIAL = `${JOB}/report-writing-contradictions__a1B2c3D`;

async function write(dir: string, rel: string, data: string | Uint8Array): Promise<void> {
  const file = path.join(dir, ...rel.split("/"));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

describe("benchmark packages", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;
  /** The Project's `benchmarks/`. */
  let dir: string;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await owner.post("/api/projects", { projectId: `owner_a-pkg_${projects}`, name: "Pkg" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    dir = benchmarksDir(t.root, projectId);
    for (const name of await fs.readdir(dir)) {
      await fs.rm(path.join(dir, name), { recursive: true, force: true });
    }
    base = `/api/projects/${projectId}/benchmarks`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });

  const list = async () =>
    ((await (await member.get(base)).json()) as BenchmarksResponse).benchmarks;

  describe("import", () => {
    it("a member imports a package: it lists with its cases, its own version and no evaluations, from a zip", async () => {
      const files = packageFiles("report-writing-v1");
      // A dot-entry inside a case is no part of the package.
      files["report-writing-v1/CASE-001-contradictions/statement/.DS_Store"] = strToU8("x");
      const before = Date.now();

      const res = await member.post(`${base}/archive`, { dataBase64: zipB64(files) });

      expect(res.status).toBe(201);
      const { benchmark } = (await res.json()) as BenchmarkArchiveImportResponse;
      expect(benchmark).toMatchObject({
        id: "report-writing-v1",
        title: "Report writing under conflicting sources",
        version: "2026.10.08.3",
        status: "published",
        runs: 2,
        caseCount: 2,
        evaluations: [],
        origin: { kind: "zip" },
      });
      const importedAt = Date.parse(benchmark.origin!.importedAt!);
      expect(importedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(importedAt).toBeLessThanOrEqual(Date.now());
      expect((await list()).map((b) => b.id)).toEqual(["report-writing-v1"]);

      const benchDir = path.join(dir, "report-writing-v1");
      for (const [rel, text] of Object.entries(CASES)) {
        expect(await fs.readFile(path.join(benchDir, rel), "utf8"), rel).toBe(text);
      }
      expect(await exists(path.join(benchDir, "CASE-001-contradictions/statement/.DS_Store"))).toBe(
        false,
      );
      expect(parseYaml(await fs.readFile(path.join(benchDir, "scoreboard.yaml"), "utf8"))).toEqual({
        evaluations: [],
      });
      // Nothing left in staging.
      expect((await fs.readdir(dir)).sort()).toEqual(["report-writing-v1"]);
    });

    it("a package zipped at its root imports under the id its manifest declares", async () => {
      const res = await member.post(`${base}/archive`, {
        dataBase64: zipB64(packageFiles("report-writing-v1", "")),
      });

      expect(res.status).toBe(201);
      expect((await list()).map((b) => [b.id, b.caseCount])).toEqual([["report-writing-v1", 2]]);
    });

    it("a package whose manifest predates id, version and origin imports under its directory's name, unversioned, and its copy names the id", async () => {
      const old = { id: undefined, version: undefined, origin: undefined };

      const res = await member.post(`${base}/archive`, {
        dataBase64: zipB64(packageFiles("report-writing-v1", "report-writing-v1", old)),
      });

      expect(res.status).toBe(201);
      const { benchmark } = (await res.json()) as BenchmarkArchiveImportResponse;
      expect(benchmark).toMatchObject({ id: "report-writing-v1", origin: { kind: "zip" } });
      expect(benchmark).not.toHaveProperty("version");
      const written = parseToml(
        await fs.readFile(path.join(dir, "report-writing-v1", "benchmark_config.toml"), "utf8"),
      );
      expect(written).toMatchObject({ id: "report-writing-v1", origin: { kind: "zip" } });
      expect(written).not.toHaveProperty("version");
    });

    it("a package fetched from a repository folder, named as its origin, lists with that git origin", async () => {
      const origin = { kind: "git", url: FOLDER, ref: SHA, path: "packages/report-writing-v1" };

      const res = await member.post(`${base}/archive`, {
        dataBase64: zipB64(packageFiles("report-writing-v1")),
        origin,
      });

      expect(res.status).toBe(201);
      const { benchmark } = (await res.json()) as BenchmarkArchiveImportResponse;
      expect(benchmark.origin).toMatchObject(origin);
      expect(Date.parse(benchmark.origin!.importedAt!)).not.toBeNaN();
      const manifestOnDisk = parseToml(
        await fs.readFile(path.join(dir, "report-writing-v1", "benchmark_config.toml"), "utf8"),
      ) as { origin: Record<string, string> };
      expect(manifestOnDisk.origin).toMatchObject(origin);
    });

    it.each([
      ["a kind other than git", { kind: "zip" }],
      ["a link that is not http(s)", { url: "javascript:alert(1)" }],
      ["a branch where the commit goes", { ref: "main" }],
      ["no folder", { path: "" }],
    ])("refuses an origin with %s, writing nothing", async (_what, over) => {
      const origin = { kind: "git", url: FOLDER, ref: SHA, path: "packages/x", ...over };

      const res = await member.post(`${base}/archive`, {
        dataBase64: zipB64(packageFiles("report-writing-v1")),
        origin,
      });

      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorBody).error.code).toBe("bad_request");
      expect(await fs.readdir(dir)).toEqual([]);
    });

    describe("a folder as `penguin benchmark import` uploads it", () => {
      let folder: string;
      beforeEach(async () => {
        folder = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-benchmark-folder-"));
        for (const [rel, data] of Object.entries(packageFiles("report-writing-v1", ""))) {
          await write(folder, rel, data);
        }
      });
      afterEach(async () => {
        await fs.rm(folder, { recursive: true, force: true });
      });

      const upload = async () =>
        member.post(`${base}/archive`, {
          dataBase64: Buffer.from(await readBenchmarkUpload(folder)).toString("base64"),
        });

      it("imports as the package's zip would", async () => {
        const res = await upload();

        expect(res.status).toBe(201);
        expect((await list()).map((b) => [b.id, b.caseCount])).toEqual([["report-writing-v1", 2]]);
      });

      it("is refused by name when it holds the copy's own state", async () => {
        await write(folder, "scoreboard.yaml", SCOREBOARD);

        const res = await upload();

        expect(res.status).toBe(400);
        const { error } = (await res.json()) as ErrorBody;
        expect(error.code).toBe("benchmark_archive_invalid");
        expect(error.message.endsWith(": scoreboard.yaml")).toBe(true);
        expect(await fs.readdir(dir)).toEqual([]);
      });

      it.runIf(canCreateSymlink())(
        "is refused by name when it holds a link, which is never followed",
        async () => {
          await fs.symlink(
            path.join(folder, "CASE-002-format", "rubric", "README.md"),
            path.join(folder, "CASE-001-contradictions", "statement", "rubric.md"),
          );

          const res = await upload();

          expect(res.status).toBe(400);
          const { error } = (await res.json()) as ErrorBody;
          expect(error.code).toBe("benchmark_archive_invalid");
          expect(error.message.endsWith(": CASE-001-contradictions/statement/rubric.md")).toBe(
            true,
          );
          expect(await fs.readdir(dir)).toEqual([]);
        },
      );
    });

    it("an outsider cannot import into the Project", async () => {
      const res = await outsider.post(`${base}/archive`, {
        dataBase64: zipB64(packageFiles("report-writing-v1")),
      });

      expect(res.status).toBe(404);
      expect(await fs.readdir(dir)).toEqual([]);
    });

    it("a taken id is a 409 whose details name it; an overwrite replaces the directory whole, its evaluation records and .jobs/ included", async () => {
      const dataBase64 = zipB64(packageFiles("report-writing-v1"));
      expect((await member.post(`${base}/archive`, { dataBase64 })).status).toBe(201);
      const benchDir = path.join(dir, "report-writing-v1");
      await write(benchDir, "scoreboard.yaml", SCOREBOARD);
      // A finished evaluation's trial: the job and its trial each hold their result.json.
      await write(benchDir, `.jobs/${JOB}/result.json`, "{}");
      await write(benchDir, `.jobs/${TRIAL}/result.json`, "{}");
      await write(benchDir, "CASE-003-old/statement/README.md", "# An older case\n");
      expect((await list())[0]!.evaluations).toHaveLength(1);

      const again = await member.post(`${base}/archive`, { dataBase64 });

      expect(again.status).toBe(409);
      const { error } = (await again.json()) as ErrorBody;
      expect(error).toMatchObject({
        code: "benchmark_exists",
        details: { benchmarkId: "report-writing-v1" },
      });
      expect((await list())[0]!.evaluations).toHaveLength(1);

      const replaced = await member.post(`${base}/archive`, { dataBase64, overwrite: true });

      expect(replaced.status).toBe(201);
      expect((await list())[0]).toMatchObject({ caseCount: 2, evaluations: [] });
      expect(await exists(path.join(benchDir, ".jobs"))).toBe(false);
      expect(await exists(path.join(benchDir, "CASE-003-old"))).toBe(false);
      expect((await fs.readdir(dir)).sort()).toEqual(["report-writing-v1"]);
    });

    /** What a running evaluation leaves under `.jobs/`, and what is there once it is done. */
    const runningEvaluations: Array<
      [string, (benchDir: string) => Promise<void>, (benchDir: string) => Promise<void>]
    > = [
      [
        "a trial that has no result yet",
        async (benchDir) => {
          await write(benchDir, `.jobs/${JOB}/config.json`, "{}");
          await write(benchDir, `.jobs/${TRIAL}/trial.log`, "running\n");
        },
        (benchDir) => write(benchDir, `.jobs/${TRIAL}/result.json`, "{}"),
      ],
      [
        "the Test Agent's State packed for a trial being launched",
        (benchDir) => write(benchDir, `.jobs/${JOB}.agent-state.tar.gz`, "state"),
        (benchDir) => fs.rm(path.join(benchDir, ".jobs", `${JOB}.agent-state.tar.gz`)),
      ],
    ];

    it.each(runningEvaluations)(
      "an overwrite while an evaluation runs (%s) is a 409 benchmark_busy that changes nothing, until the evaluation ends",
      async (_what, run, finish) => {
        const dataBase64 = zipB64(packageFiles("report-writing-v1"));
        expect((await member.post(`${base}/archive`, { dataBase64 })).status).toBe(201);
        const benchDir = path.join(dir, "report-writing-v1");
        await write(benchDir, "scoreboard.yaml", SCOREBOARD);
        await run(benchDir);

        const refused = await member.post(`${base}/archive`, { dataBase64, overwrite: true });

        expect(refused.status).toBe(409);
        expect(((await refused.json()) as ErrorBody).error.code).toBe("benchmark_busy");
        expect((await list())[0]!.evaluations).toHaveLength(1);
        expect(await exists(path.join(benchDir, ".jobs"))).toBe(true);

        await finish(benchDir);
        const replaced = await member.post(`${base}/archive`, { dataBase64, overwrite: true });

        expect(replaced.status).toBe(201);
        expect((await list())[0]!.evaluations).toEqual([]);
      },
    );

    it("overwrites of one id sent at once each land or answer 409 benchmark_exists, and leave one whole copy", async () => {
      const dataBase64 = zipB64(packageFiles("report-writing-v1"));
      expect((await member.post(`${base}/archive`, { dataBase64 })).status).toBe(201);

      const answers = await Promise.all(
        Array.from({ length: 4 }, () =>
          member.post(`${base}/archive`, { dataBase64, overwrite: true }),
        ),
      );

      for (const res of answers) {
        if (res.status === 201) continue;
        expect(res.status).toBe(409);
        expect(((await res.json()) as ErrorBody).error.code).toBe("benchmark_exists");
      }
      expect(answers.some((res) => res.status === 201)).toBe(true);
      expect(await fs.readdir(dir)).toEqual(["report-writing-v1"]);
      for (const [rel, text] of Object.entries(CASES)) {
        expect(await fs.readFile(path.join(dir, "report-writing-v1", rel), "utf8"), rel).toBe(text);
      }
    });

    const refusals: Array<[string, () => string, number, string]> = [
      [
        "an entry that climbs out of its case (zip-slip)",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/CASE-001-contradictions/../../../escape.md": strToU8("x"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "an absolute entry",
        () => zipB64({ ...packageFiles("report-writing-v1"), "/escape.md": strToU8("x") }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "an entry with a backslash",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1\\escape.md": strToU8("x"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "an entry whose name holds a NUL",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/CASE-001-contradictions/statement/notes\u0000.md": strToU8("x"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "an entry whose name holds a control character",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/CASE-001-contradictions/statement/\u001b[2Jnotes.md": strToU8("x"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "two files whose names differ only in letter case",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/CASE-001-contradictions/statement/readme.md": strToU8("x"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "two cases whose names differ only in letter case",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/CASE-002-FORMAT/statement/README.md": strToU8("# Again\n"),
            "report-writing-v1/CASE-002-FORMAT/rubric/README.md": strToU8("- 100 pts\n"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "a file named, but for letter case, like a directory other entries need",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/CASE-002-format/STATEMENT": strToU8("x"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "a symbolic link",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/CASE-001-contradictions/statement/link.md": [
              strToU8("../../../../secret"),
              { os: 3, attrs: 0o120777 << 16 },
            ],
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "the copy's scoreboard",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/scoreboard.yaml": strToU8(SCOREBOARD),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "the copy's Harbor trials",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/.jobs/trial-1/result.json": strToU8("{}"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "a file beside the cases",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/notes.md": strToU8("scratch"),
          }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "a draft",
        () => zipB64(packageFiles("report-writing-v1", "report-writing-v1", { status: "draft" })),
        400,
        "benchmark_not_published",
      ],
      [
        "a case without its rubric",
        () => {
          const files = packageFiles("report-writing-v1");
          delete files["report-writing-v1/CASE-002-format/rubric/README.md"];
          return zipB64(files);
        },
        400,
        "benchmark_case_invalid",
      ],
      [
        "a package with no case",
        () =>
          zipB64({
            "report-writing-v1/benchmark_config.toml": strToU8(
              stringifyToml(manifest("report-writing-v1")),
            ),
          }),
        400,
        "benchmark_case_invalid",
      ],
      [
        "a directory named other than the manifest's id",
        () => zipB64(packageFiles("report-writing-v1", "renamed")),
        400,
        "benchmark_id_mismatch",
      ],
      [
        "a directory whose name is no id, around a manifest that names none",
        () => zipB64(packageFiles("report-writing-v1", "report writing (copy)", { id: undefined })),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "a manifest at the root that names no id",
        () => zipB64(packageFiles("report-writing-v1", "", { id: undefined })),
        400,
        "benchmark_manifest_invalid",
      ],
      [
        "a manifest that is not TOML",
        () =>
          zipB64({
            ...packageFiles("report-writing-v1"),
            "report-writing-v1/benchmark_config.toml": strToU8('title = "unterminated\n'),
          }),
        400,
        "benchmark_manifest_invalid",
      ],
      [
        "a manifest past the create form's limits",
        () => zipB64(packageFiles("report-writing-v1", "report-writing-v1", { runs: 5000 })),
        400,
        "benchmark_manifest_invalid",
      ],
      [
        "two top-level directories",
        () => zipB64({ ...packageFiles("report-writing-v1"), "other/README.md": strToU8("x") }),
        400,
        "benchmark_archive_invalid",
      ],
      [
        "bytes that are not a zip",
        () => Buffer.from("not a zip at all").toString("base64"),
        400,
        "benchmark_archive_invalid",
      ],
      ["an empty upload", () => "", 400, "benchmark_archive_invalid"],
      [
        "a zip over 14MB",
        () => Buffer.alloc(14 * 1024 * 1024 + 1).toString("base64"),
        413,
        "benchmark_too_large",
      ],
      [
        "base64 longer than any zip within 14MB encodes to",
        () => Buffer.alloc(14 * 1024 * 1024 + 4).toString("base64"),
        413,
        "benchmark_too_large",
      ],
      [
        "more than 1000 files",
        () => {
          const files = packageFiles("report-writing-v1");
          for (let i = 0; i < 1000; i++) {
            files[`report-writing-v1/CASE-001-contradictions/statement/many/${i}.md`] =
              strToU8("x");
          }
          return zipB64(files);
        },
        413,
        "benchmark_too_large",
      ],
      [
        "an entry declaring more than it may inflate to",
        () =>
          zipB64Declaring(packageFiles("report-writing-v1"), {
            "report-writing-v1/CASE-001-contradictions/statement/README.md": 512 * 1024 * 1024,
          }),
        413,
        "benchmark_too_large",
      ],
    ];

    it.each(refusals)("refuses %s, writing nothing", async (_what, data, status, code) => {
      const res = await member.post(`${base}/archive`, { dataBase64: data() });

      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
      expect(await fs.readdir(dir)).toEqual([]);
      expect(await exists(path.join(t.root, projectId, "escape.md"))).toBe(false);
      expect(await exists(path.join(t.root, "escape.md"))).toBe(false);
    });
  });

  describe("export", () => {
    /** A published Benchmark on disk, as an Agent's import from the repository leaves one, with this copy's own state beside its package. */
    async function seedBenchmark(over: Record<string, unknown> = {}): Promise<string> {
      const benchDir = path.join(dir, "report-writing-v1");
      const manifestText = stringifyToml(
        manifest("report-writing-v1", {
          origin: {
            kind: "git",
            url: FOLDER,
            ref: SHA,
            path: "packages/report-writing-v1",
            imported_at: "2026-10-08T09:00:00.000Z",
          },
          ...over,
        }),
      );
      await write(benchDir, "benchmark_config.toml", manifestText);
      for (const [rel, text] of Object.entries(CASES)) await write(benchDir, rel, text);
      await write(benchDir, "scoreboard.yaml", SCOREBOARD);
      await write(benchDir, ".jobs/trial-1/result.json", "{}");
      await write(benchDir, "CASE-001-contradictions/statement/.DS_Store", "x");
      await write(benchDir, "notes.md", "the builder's scratch\n");
      if (canCreateSymlink()) {
        await fs.symlink(
          path.join(benchDir, "CASE-002-format", "rubric", "README.md"),
          path.join(benchDir, "CASE-001-contradictions", "statement", "rubric-link.md"),
        );
      }
      return manifestText;
    }

    it("carries the manifest as it reads and the cases, none of the copy's own state, and imports back as the same package with no scores", async () => {
      const manifestText = await seedBenchmark();

      const res = await member.get(`${base}/report-writing-v1/archive`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("content-disposition")).toBe(
        "attachment; filename*=UTF-8''report-writing-v1-v2026.10.08.3.zip",
      );
      const zip = new Uint8Array(await res.arrayBuffer());
      const entries = unzipSync(zip);
      expect(Object.keys(entries).sort()).toEqual(
        ["benchmark_config.toml", ...Object.keys(CASES)]
          .map((rel) => `report-writing-v1/${rel}`)
          .sort(),
      );
      expect(strFromU8(entries["report-writing-v1/benchmark_config.toml"]!)).toBe(manifestText);

      // Back in, where the Benchmark no longer is.
      await fs.rm(path.join(dir, "report-writing-v1"), { recursive: true });
      const imported = await member.post(`${base}/archive`, {
        dataBase64: Buffer.from(zip).toString("base64"),
      });

      expect(imported.status).toBe(201);
      const benchDir = path.join(dir, "report-writing-v1");
      for (const [rel, text] of Object.entries(CASES)) {
        expect(await fs.readFile(path.join(benchDir, rel), "utf8"), rel).toBe(text);
      }
      expect((await fs.readdir(benchDir)).sort()).toEqual([
        "CASE-001-contradictions",
        "CASE-002-format",
        "benchmark_config.toml",
        "scoreboard.yaml",
      ]);
      const [listed] = await list();
      expect(listed).toMatchObject({
        id: "report-writing-v1",
        title: "Report writing under conflicting sources",
        description: "Two cases: conflicting briefs, a strict format.",
        version: "2026.10.08.3",
        runs: 2,
        caseCount: 2,
        evaluations: [],
        origin: { kind: "zip" },
      });
      // The repository the first copy came from is not this copy's origin.
      expect(listed!.origin).not.toHaveProperty("url");
    });

    it("names the zip by the id alone for a Benchmark whose manifest predates versions, and it imports back", async () => {
      const benchDir = path.join(dir, "report-writing-v1");
      // As an earlier release's create form wrote it: no id, no version, no origin.
      const old = 'title = "Report writing"\nruns = 2\nstatus = "published"\n\n';
      await write(benchDir, "benchmark_config.toml", old);
      for (const [rel, text] of Object.entries(CASES)) await write(benchDir, rel, text);

      const res = await member.get(`${base}/report-writing-v1/archive`);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe(
        "attachment; filename*=UTF-8''report-writing-v1.zip",
      );
      const zip = new Uint8Array(await res.arrayBuffer());
      expect(strFromU8(unzipSync(zip)["report-writing-v1/benchmark_config.toml"]!)).toBe(old);
      await fs.rm(benchDir, { recursive: true });
      const imported = await member.post(`${base}/archive`, {
        dataBase64: Buffer.from(zip).toString("base64"),
      });
      expect(imported.status).toBe(201);
      expect((await list()).map((b) => [b.id, b.title, b.version])).toEqual([
        ["report-writing-v1", "Report writing", undefined],
      ]);
    });

    const unexportable: Array<[string, (benchDir: string) => Promise<void>, number, string]> = [
      ["a missing Benchmark", async () => {}, 404, "not_found"],
      [
        "a draft",
        async () => {
          await seedBenchmark({ status: "draft" });
        },
        409,
        "benchmark_not_published",
      ],
      [
        "a failed calibration",
        async () => {
          await seedBenchmark({ status: "failed" });
        },
        409,
        "benchmark_not_published",
      ],
      [
        "a manifest that is not TOML",
        async (benchDir) => {
          await seedBenchmark();
          await write(benchDir, "benchmark_config.toml", 'title = "unterminated\n');
        },
        409,
        "benchmark_manifest_invalid",
      ],
      [
        "a manifest naming another directory",
        async () => {
          await seedBenchmark({ id: "someone-else" });
        },
        409,
        "benchmark_id_mismatch",
      ],
      [
        "a hand-edited manifest past what an import takes",
        async () => {
          await seedBenchmark({ runs: 5000 });
        },
        409,
        "benchmark_manifest_invalid",
      ],
      [
        "a file over 5MB",
        async (benchDir) => {
          await seedBenchmark();
          await write(
            benchDir,
            "CASE-001-contradictions/statement/large.bin",
            new Uint8Array(5 * 1024 * 1024 + 1),
          );
        },
        413,
        "benchmark_too_large",
      ],
    ];

    it.each(unexportable)("has no package for %s", async (_what, arrange, status, code) => {
      await arrange(path.join(dir, "report-writing-v1"));

      const res = await member.get(`${base}/report-writing-v1/archive`);

      expect(res.status).toBe(status);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    });

    it("an outsider cannot export", async () => {
      await seedBenchmark();

      expect((await outsider.get(`${base}/report-writing-v1/archive`)).status).toBe(404);
    });

    it("exports an unchanged Benchmark as the same bytes, whenever it is exported", async () => {
      await seedBenchmark();
      const exportAt = async (when: number): Promise<Buffer> => {
        vi.setSystemTime(when);
        const res = await member.get(`${base}/report-writing-v1/archive`);
        expect(res.status).toBe(200);
        return Buffer.from(await res.arrayBuffer());
      };

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const now = Date.now();
        const first = await exportAt(now);
        const anHourLater = await exportAt(now + 61 * 60 * 1000);

        expect(anHourLater.equals(first)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
