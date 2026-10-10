/**
 * `penguin benchmark import` — bring a Benchmark package into the Project's Evaluation Center the
 * way the import dialog's zip upload does, for an Agent in a conversation or a script.
 *
 *   penguin benchmark import <dir-or-zip> [--overwrite]
 *                    [--origin-url <link> --origin-ref <commit> --origin-path <folder>]
 *                    [--project-id <id>] [--json] [--server <url>]
 *
 * A zip goes up as it is; a folder is zipped whole first, every entry as it is (the server's
 * benchmark-package.ts). Both go to `POST /api/projects/:p/benchmarks/archive`, so the server
 * checks an Agent's import exactly as it checks a person's upload, and the server writes the copy:
 * nothing here writes under `benchmarks/`. A taken id is refused unless `--overwrite`, which
 * replaces the Benchmark whole, its evaluation records and run results with it; the server refuses
 * that too while an evaluation of the Benchmark is still running. The three `--origin-*` options,
 * given together, record the repository folder the package was fetched from — the link as given,
 * the 40-character commit it resolved to and the folder — as the copy's git origin; without them
 * the origin is `zip`.
 *
 * Like `penguin run`, the command calls with the server's local API token (`PENGUIN_API_TOKEN`
 * inside a Session), which is the admin's, and imports into `--project-id`, else
 * `PENGUIN_PROJECT_ID` (a Session's own Project), else `default_project`.
 * Docs: /docs/cli § "penguin benchmark".
 */
import type { Command } from "commander";
import type {
  BenchmarkArchiveImportRequest,
  BenchmarkArchiveImportResponse,
  ErrorBody,
} from "@prismshadow/penguin-server/api";
import {
  BenchmarkUploadError,
  readBenchmarkUpload,
  type BenchmarkUploadProblem,
} from "@prismshadow/penguin-server/benchmark-package";
import { ApiError, resolveConnection, resolveProjectId, ServerClient } from "../client.js";
import type { Messages } from "../i18n.js";

const MB = 1024 * 1024;

/** Why `source` cannot go up as a package, in the user's language. */
function problemText(t: Messages, source: string, problem: BenchmarkUploadProblem): string {
  switch (problem.kind) {
    case "missing":
      return t.benchmark.missing(source);
    case "unsupported":
      return t.benchmark.unsupported(source);
    case "tooManyFiles":
      return t.benchmark.tooManyFiles(source, problem.limit);
    case "fileTooLarge":
      return t.benchmark.fileTooLarge(problem.file, problem.limitBytes / MB);
    case "tooLarge":
      return t.benchmark.tooLarge(source, problem.limitBytes / MB);
    case "zipTooLarge":
      return t.benchmark.zipTooLarge(source, problem.limitBytes / MB);
  }
}

/** Writes one error line and fails the command. */
function fail(t: Messages, message: string): void {
  process.stderr.write(`${t.error(message)}\n`);
  process.exitCode = 1;
}

export function registerBenchmarkCommand(program: Command, t: Messages): void {
  const benchmark = program.command("benchmark").description(t.benchmark.desc);

  benchmark
    .command("import <path>")
    .description(t.benchmark.importDesc)
    .option("--overwrite", t.benchmark.overwrite)
    .option("--origin-url <link>", t.benchmark.originUrl)
    .option("--origin-ref <commit>", t.benchmark.originRef)
    .option("--origin-path <folder>", t.benchmark.originPath)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (source: string, opts) => {
      const originParts = [opts.originUrl, opts.originRef, opts.originPath] as Array<
        string | undefined
      >;
      const originGiven = originParts.filter((part) => part !== undefined).length;
      if (originGiven !== 0 && originGiven !== originParts.length) {
        fail(t, t.benchmark.originIncomplete());
        return;
      }

      let zip: Uint8Array;
      try {
        zip = await readBenchmarkUpload(source);
      } catch (err) {
        if (!(err instanceof BenchmarkUploadError)) throw err;
        fail(t, problemText(t, source, err.problem));
        return;
      }

      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const body: BenchmarkArchiveImportRequest = {
        dataBase64: Buffer.from(zip).toString("base64"),
        ...(opts.overwrite === true ? { overwrite: true } : {}),
        ...(originGiven > 0
          ? {
              origin: {
                kind: "git",
                url: String(opts.originUrl),
                ref: String(opts.originRef),
                path: String(opts.originPath),
              },
            }
          : {}),
      };
      let res: BenchmarkArchiveImportResponse;
      try {
        res = await client.request<BenchmarkArchiveImportResponse>(
          "POST",
          `/api/projects/${encodeURIComponent(projectId)}/benchmarks/archive`,
          body,
        );
      } catch (err) {
        // The one refusal with a next step: which Benchmark is there, and how to replace it.
        if (err instanceof ApiError && err.code === "benchmark_exists") {
          const id = (err.body as ErrorBody | undefined)?.error.details?.benchmarkId ?? "";
          fail(t, t.benchmark.exists(id, projectId));
          return;
        }
        throw err;
      }

      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
        return;
      }
      const imported = res.benchmark;
      process.stdout.write(
        `${t.benchmark.imported(imported.id, imported.version ?? "", imported.caseCount, projectId)}\n`,
      );
    });
}
