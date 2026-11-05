/**
 * Owner-only writes are offered to the Project's owner alone. The server refuses three of them to
 * anyone else with 403 (`requireProjectOwner`): creating a Benchmark by hand
 * (`POST /api/projects/:projectId/benchmarks`), deleting one
 * (`DELETE /api/projects/:projectId/benchmarks/:benchmarkId`) and importing a Trace
 * (`POST /api/projects/:projectId/agents/:agentId/traces/import`). A member offered one could
 * only fill in the form, or pick the file, for a refusal at the end, and copy that names one of
 * these steps sends a member to a button they do not have.
 *
 * vitest runs node-only here, so the Evaluation Center's buttons and a failed Benchmark's notices
 * are rendered to static markup, and the Trace import row is checked through the function its
 * Project picker is derived from — the row draws nothing when that function offers no Project.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BenchmarkSummary, ProjectSummary } from "@prismshadow/penguin-server/api";
import { UnpublishedNotice } from "../src/features/benchmark/benchmark-detail-page";
import { BenchmarkCard, BenchmarkCreateButtons } from "../src/features/benchmark/benchmark-page";
import { traceImportTargets } from "../src/features/settings/trace-import-row";
import { S, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const noop = () => {};

describe("the Evaluation Center's create entry points", () => {
  const render = (isOwner: boolean) =>
    renderToStaticMarkup(
      createElement(BenchmarkCreateButtons, { isOwner, onAi: noop, onManual: noop }),
    );

  it("offer the owner both ways to create a Benchmark", () => {
    const html = render(true);
    expect(html).toContain(S.aiCreate.withAi);
    expect(html).toContain(S.aiCreate.manual);
    expect(html.match(/<button/g)).toHaveLength(2);
  });

  it("offer a member Create with AI alone: the conversation is theirs to start, the write is not", () => {
    const html = render(false);
    expect(html).toContain(S.aiCreate.withAi);
    expect(html).not.toContain(S.aiCreate.manual);
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

describe("a failed Benchmark's notices", () => {
  const failed: BenchmarkSummary = {
    id: "report-writing-v1",
    title: "Report writing under conflicting sources",
    status: "failed",
    caseCount: 3,
    evaluations: [],
    agentIds: [],
  };
  /** The card on the Evaluation Center, whose delete button is the owner's alone. */
  const card = (canDelete: boolean) =>
    renderToStaticMarkup(
      createElement(BenchmarkCard, {
        benchmark: failed,
        locale: "zh",
        nameOf: (agentId: string) => agentId,
        machineName: null,
        canDelete,
        onOpen: noop,
        onUse: noop,
        onDelete: noop,
      }),
    );
  /** The notice on the Benchmark's own page, which stands in place of its detail. */
  const page = (isOwner: boolean) =>
    renderToStaticMarkup(createElement(UnpublishedNotice, { failed: true, isOwner }));

  it("tell the owner to delete it and create it again, beside the delete button", () => {
    const html = card(true);
    expect(html).toContain(S.benchmark.creationFailedHint);
    expect(html).toContain(`aria-label="${S.benchmark.deleteBenchmark}"`);
    expect(page(true)).toContain(S.benchmark.creationFailedDetail);
  });

  it("tell a member what happened without the delete step, since the member has no delete button", () => {
    const html = card(false);
    expect(html).toContain(S.benchmark.creationFailedHintMember);
    expect(html).not.toContain(S.benchmark.creationFailedHint);
    expect(html).not.toContain(S.benchmark.deleteBenchmark);
    const detail = page(false);
    expect(detail).toContain(S.benchmark.creationFailedDetailMember);
    expect(detail).not.toContain(S.benchmark.creationFailedDetail);
    // Neither dictionary words a member's line with the step.
    for (const line of [
      zh.benchmark.creationFailedHintMember,
      zh.benchmark.creationFailedDetailMember,
    ]) {
      expect(line).not.toContain("删除");
    }
    for (const line of [
      en.benchmark.creationFailedHintMember,
      en.benchmark.creationFailedDetailMember,
    ]) {
      expect(line).not.toMatch(/delete/i);
    }
  });
});

describe("traceImportTargets (the Trace import row's Projects)", () => {
  const project = (projectId: string, role: ProjectSummary["role"]): ProjectSummary => ({
    projectId,
    role,
    ownerUserId: role === "owner" ? "bob" : "alice",
    createdAt: "2026-09-17T00:00:00.000Z",
  });
  /** Alice's Project, shared with Bob as a member. */
  const shared = project("alice-default_project", "member");
  const own = project("bob-default_project", "owner");
  const lab = project("bob-lab", "owner");

  it("offers only the Projects the viewer owns, in the list's order", () => {
    expect(traceImportTargets([shared, own, lab], null, "").projects).toEqual([own, lab]);
  });

  it("starts on the open Project when the viewer owns it, else on the first Project they own", () => {
    expect(traceImportTargets([shared, own, lab], "bob-lab", "").projectId).toBe("bob-lab");
    // Bob is looking at Alice's Project: the row starts on his own rather than on a refusal.
    expect(traceImportTargets([shared, own, lab], "alice-default_project", "").projectId).toBe(
      "bob-default_project",
    );
  });

  it("keeps a pick among the owned Projects, and falls back from one the viewer does not own", () => {
    expect(traceImportTargets([shared, own, lab], "bob-default_project", "bob-lab").projectId).toBe(
      "bob-lab",
    );
    // A pick that is no longer owned (the list reloaded under it) is not kept.
    expect(
      traceImportTargets([shared, own], "bob-default_project", "alice-default_project").projectId,
    ).toBe("bob-default_project");
  });

  it("gives a viewer who owns no Project nothing to import into, which leaves the row undrawn", () => {
    expect(traceImportTargets([shared], "alice-default_project", "")).toEqual({
      projects: [],
      projectId: "",
    });
    expect(traceImportTargets([], null, "")).toEqual({ projects: [], projectId: "" });
  });
});
