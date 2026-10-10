/**
 * The Evaluation Center's import and a Benchmark page's export, as far as node reaches them:
 * vitest runs without a DOM here, so the entry points are rendered to static markup, and the zip
 * upload is driven through the real endpoint wrapper against the package's fetch fake.
 *
 * - A member is offered Import benchmark beside Create with AI: importing is open to every member
 *   of the Project, while creating by hand stays the owner's.
 * - An upload whose id is taken comes back as the overwrite question, about the id the answer's
 *   details name (the picked file's name when they name none); confirming sends the same zip
 *   again with `overwrite`, and the Benchmark comes back as imported. An overwrite refused while
 *   the Benchmark is being evaluated, and any zip the server refuses, comes back with its reason.
 * - A published Benchmark's header offers Export beside the path's copy button; a draft, a failed
 *   one and one whose manifest cannot be read have no package and offer none.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BenchmarkSummary } from "@prismshadow/penguin-server/api";
import { BenchmarkHeaderFacts } from "../src/features/benchmark/benchmark-detail-page";
import { uploadBenchmarkArchive } from "../src/features/benchmark/benchmark-import-modal";
import { BenchmarkCreateButtons } from "../src/features/benchmark/benchmark-page";
import { S } from "../src/lib/strings";
import { apiError, json, stubFetch } from "./helpers/fetch";

const noop = () => {};

const IMPORTED: BenchmarkSummary = {
  id: "report-writing-v1",
  title: "Report writing under conflicting sources",
  status: "published",
  runs: 2,
  version: "2026.10.08.3",
  origin: { kind: "zip", importedAt: "2026-10-09T08:00:00.000Z" },
  caseCount: 2,
  evaluations: [],
  agentIds: [],
};

describe("the Evaluation Center's import entry", () => {
  it("is offered to a member beside Create with AI, without the owner's Create manually", () => {
    const html = renderToStaticMarkup(
      createElement(BenchmarkCreateButtons, {
        isOwner: false,
        onAi: noop,
        onManual: noop,
        onImport: noop,
      }),
    );

    expect(html).toContain(S.benchmark.importBenchmark);
    expect(html).toContain(S.aiCreate.withAi);
    expect(html).not.toContain(S.aiCreate.manual);
  });
});

describe("a zip upload", () => {
  const ZIP = Buffer.from("PK zip bytes").toString("base64");

  it("whose id is taken asks about the id the answer's details name, and the confirmed overwrite resends the same zip", async () => {
    const fetch = stubFetch(() =>
      json(
        {
          error: {
            code: "benchmark_exists",
            message: "A Benchmark of this id is already in the Project.",
            details: { benchmarkId: "report-writing-v1" },
          },
        },
        409,
      ),
    );

    const first = await uploadBenchmarkArchive("proj_1", ZIP, {
      overwrite: false,
      fallbackId: "picked-file",
    });

    expect(first).toEqual({ kind: "exists", benchmarkId: "report-writing-v1" });
    expect(fetch.requests[0]).toMatchObject({
      method: "POST",
      path: "/api/projects/proj_1/benchmarks/archive",
      body: { dataBase64: ZIP },
    });

    fetch.answer(() => json({ benchmark: IMPORTED }, 201));
    const confirmed = await uploadBenchmarkArchive("proj_1", ZIP, {
      overwrite: true,
      fallbackId: "picked-file",
    });

    expect(fetch.requests[1]!.body).toEqual({ dataBase64: ZIP, overwrite: true });
    expect(confirmed).toEqual({ kind: "imported", benchmark: IMPORTED });
  });

  it("whose id is taken, by an answer that names none, asks about the picked file's own name", async () => {
    stubFetch(() => apiError(409, "benchmark_exists", "Benchmark already exists"));

    const result = await uploadBenchmarkArchive("proj_1", ZIP, {
      overwrite: false,
      fallbackId: "picked-file",
    });

    expect(result).toEqual({ kind: "exists", benchmarkId: "picked-file" });
  });

  it("whose overwrite is refused while the Benchmark is being evaluated comes back with that reason, not the question again", async () => {
    stubFetch(() =>
      apiError(409, "benchmark_busy", "Benchmark report-writing-v1 is being evaluated."),
    );

    const result = await uploadBenchmarkArchive("proj_1", ZIP, {
      overwrite: true,
      fallbackId: "picked-file",
    });

    expect(result).toEqual({ kind: "refused", message: S.errors.byCode.benchmark_busy });
  });

  it("that the server refuses comes back with its reason", async () => {
    stubFetch(() =>
      apiError(400, "benchmark_case_invalid", "CASE-002-format has no rubric/README.md."),
    );

    const result = await uploadBenchmarkArchive("proj_1", ZIP, {
      overwrite: false,
      fallbackId: "picked-file",
    });

    expect(result).toEqual({
      kind: "refused",
      message: "CASE-002-format has no rubric/README.md.",
    });
  });
});

describe("a Benchmark page's export", () => {
  const header = (status: BenchmarkSummary["status"]) =>
    renderToStaticMarkup(
      createElement(BenchmarkHeaderFacts, {
        benchmark: { id: "report-writing-v1", version: "2026.10.08.3", status },
        onExport: noop,
      }),
    );

  it("is offered beside the path's copy button for a published Benchmark", () => {
    const html = header("published");

    expect(html).toContain(`aria-label="${S.benchmark.copyPath}"`);
    expect(html).toContain(`aria-label="${S.benchmark.exportBenchmark}"`);
  });

  it.each(["draft", "failed"] as const)("is not offered for a %s Benchmark", (status) => {
    expect(header(status)).not.toContain(`aria-label="${S.benchmark.exportBenchmark}"`);
  });
});
