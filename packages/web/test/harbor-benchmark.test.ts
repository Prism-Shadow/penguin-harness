/**
 * A Harbor Benchmark in the Evaluation Center: one whose cases run as Harbor tasks in Docker,
 * from task folders in a public repository, which the list marks and the pages link.
 *
 * - Given a Harbor Benchmark, its card carries the Harbor tag after the title; a plain
 *   Benchmark's card carries no tag.
 * - Its page links the task files: the repository's tree at the ref on GitHub, the repository
 *   itself anywhere else, always in a new tab.
 * - A run recorded as a Harbor trial shows its id with a button that copies the trial's name; a
 *   Session id shows alone.
 * - The Evaluate tab says what a Harbor run needs; for a plain Benchmark it adds nothing.
 *
 * vitest runs node-only here, so the pieces are rendered to static markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BenchmarkSummary } from "@prismshadow/penguin-server/api";
import { BenchmarkCard } from "../src/features/benchmark/benchmark-page";
import {
  HarborEvaluateNote,
  HarborRepoLink,
  RunSessionId,
  harborTrialName,
} from "../src/features/benchmark/harbor";
import { S } from "../src/lib/strings";

const noop = () => {};

const plain: BenchmarkSummary = {
  id: "report-writing-v1",
  title: "Report writing",
  status: "published",
  caseCount: 3,
  evaluations: [],
  agentIds: [],
};

const harbor: BenchmarkSummary = {
  ...plain,
  id: "terminal-bench",
  title: "Terminal-Bench 4.0 (CPU subset)",
  kind: "harbor",
  harbor: {
    repo: "https://github.com/Prism-Shadow/penguin-harness-benchmark",
    ref: "0123abc",
    path: "benchmarks/terminal-bench/tasks",
  },
};

const card = (benchmark: BenchmarkSummary) =>
  renderToStaticMarkup(
    createElement(BenchmarkCard, {
      benchmark,
      locale: "en",
      nameOf: (agentId: string) => agentId,
      machineName: null,
      canDelete: false,
      onOpen: noop,
      onUse: noop,
      onDelete: noop,
    }),
  );

describe("a Harbor Benchmark in the Evaluation Center", () => {
  it("is tagged on its card after the title; a plain one is not", () => {
    const tag = `>${S.benchmark.harborTag}</span>`;
    const tagged = card(harbor);
    expect(tagged).toContain(tag);
    expect(tagged.indexOf(tag)).toBeGreaterThan(tagged.indexOf(harbor.title));
    expect(card(plain)).not.toContain(tag);
  });

  it("links its task files in a new tab: the tree at the ref on GitHub, the repository elsewhere", () => {
    const github = renderToStaticMarkup(createElement(HarborRepoLink, { harbor: harbor.harbor! }));
    expect(github).toContain(
      'href="https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/0123abc"',
    );
    expect(github).toContain('target="_blank"');
    expect(github).toContain("Prism-Shadow/penguin-harness-benchmark@0123abc");

    const elsewhere = renderToStaticMarkup(
      createElement(HarborRepoLink, {
        harbor: { repo: "https://git.example.com/bench/tasks/", ref: "v1", path: "tasks" },
      }),
    );
    expect(elsewhere).toContain('href="https://git.example.com/bench/tasks"');
  });

  it("offers a Harbor trial's name to copy, while a Session id stands alone", () => {
    const trial = renderToStaticMarkup(
      createElement(RunSessionId, { sessionId: "harbor:music-harmony__AbC1234" }),
    );
    expect(trial).toContain("harbor:music-harmony__AbC1234");
    expect(trial).toContain(`aria-label="${S.benchmark.copyTrialName}"`);
    expect(harborTrialName("harbor:music-harmony__AbC1234")).toBe("music-harmony__AbC1234");

    const session = renderToStaticMarkup(
      createElement(RunSessionId, { sessionId: "session-2026-10-02-10-00-00-1a2b3c4d" }),
    );
    expect(session).not.toContain("<button");
    expect(harborTrialName("session-2026-10-02-10-00-00-1a2b3c4d")).toBeNull();
  });

  it("says on the Evaluate tab what a Harbor run needs, and nothing for a plain Benchmark", () => {
    expect(
      renderToStaticMarkup(createElement(HarborEvaluateNote, { benchmark: harbor })),
    ).toContain(S.benchmark.harborEvaluateHint);
    expect(renderToStaticMarkup(createElement(HarborEvaluateNote, { benchmark: plain }))).toBe("");
  });
});
