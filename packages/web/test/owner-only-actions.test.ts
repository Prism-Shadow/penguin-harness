/**
 * Owner-only writes are offered to the Project's owner alone. The server refuses two of them to
 * anyone else with 403 (`requireProjectOwner`): creating a Benchmark by hand
 * (`POST /api/projects/:projectId/benchmarks`) and importing a Trace
 * (`POST /api/projects/:projectId/agents/:agentId/traces/import`). A member offered either one
 * could only fill in the form, or pick the file, for a refusal at the end.
 *
 * vitest runs node-only here, so the Evaluation Center's buttons are rendered to static markup,
 * and the Trace import row is checked through the function its Project picker is derived from —
 * the row draws nothing when that function offers no Project.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@prismshadow/penguin-server/api";
import { BenchmarkCreateButtons } from "../src/features/benchmark/benchmark-page";
import { traceImportTargets } from "../src/features/settings/trace-import-row";
import { S } from "../src/lib/strings";

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
