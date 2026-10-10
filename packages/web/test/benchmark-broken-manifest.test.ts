/**
 * A Benchmark whose benchmark_config.toml cannot be read, which the server lists as failed with
 * `manifestError`: its card on the Evaluation Center and its own page.
 *
 * - The card is masked like a failed Benchmark: Use and View are disabled, the notice says the
 *   manifest cannot be read (not that calibration failed), and the reason the server gave is the
 *   hover hint of an icon beside it.
 * - The owner is told to fix the file or delete the Benchmark; a member, who has no delete
 *   button, only to fix it.
 * - The Benchmark's own page shows the same notice in place of the detail, with the reason.
 *
 * vitest runs node-only here, so both are rendered to static markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BenchmarkSummary } from "@prismshadow/penguin-server/api";
import { UnpublishedNotice } from "../src/features/benchmark/benchmark-detail-page";
import { BenchmarkCard } from "../src/features/benchmark/benchmark-page";
import { S } from "../src/lib/strings";

const noop = () => {};

const REASON =
  'benchmark_config.toml: "id" is "report-writing-v1", but the directory is "copied-bench".';

const broken: BenchmarkSummary = {
  id: "copied-bench",
  title: "copied-bench",
  status: "failed",
  manifestError: { code: "benchmark_id_mismatch", message: REASON },
  caseCount: 2,
  evaluations: [],
  agentIds: [],
};

const card = (canDelete: boolean) =>
  renderToStaticMarkup(
    createElement(BenchmarkCard, {
      benchmark: broken,
      locale: "zh",
      nameOf: (agentId: string) => agentId,
      machineName: null,
      canDelete,
      onOpen: noop,
      onUse: noop,
      onDelete: noop,
    }),
  );

/** The opening tag of the button whose whole text is `label`. */
function buttonTag(html: string, label: string): string {
  const at = html.indexOf(`>${label}<`);
  expect(at, label).toBeGreaterThan(-1);
  const open = html.lastIndexOf("<button", at);
  return html.slice(open, html.indexOf(">", open) + 1);
}

/** Every hover hint in `html`, unescaped. */
const hints = (html: string) =>
  [...html.matchAll(/data-tooltip="([^"]*)"/g)].map((m) => m[1]!.replace(/&quot;/g, '"'));

describe("a Benchmark whose manifest cannot be read", () => {
  it("is masked like a failed one: Use and View are disabled, and the reason is behind an icon", () => {
    const html = card(true);

    expect(buttonTag(html, S.benchmark.use)).toContain("disabled");
    expect(buttonTag(html, S.benchmark.view)).toContain("disabled");
    expect(html).toContain(S.benchmark.manifestBroken);
    expect(html).not.toContain(S.benchmark.creationFailed);
    expect(hints(html)).toContain(REASON);
  });

  it("tells the owner to fix or delete it, and a member only to fix it", () => {
    expect(card(true)).toContain(S.benchmark.manifestBrokenHint);
    const member = card(false);
    expect(member).toContain(S.benchmark.manifestBrokenHintMember);
    expect(member).not.toContain(S.benchmark.manifestBrokenHint);
  });

  it("shows the same notice with the reason on its own page, in place of the detail", () => {
    const html = renderToStaticMarkup(
      createElement(UnpublishedNotice, {
        failed: true,
        isOwner: true,
        manifestError: broken.manifestError,
      }),
    ).replace(/&quot;/g, '"');

    expect(html).toContain(S.benchmark.manifestBroken);
    expect(html).toContain(REASON);
    expect(html).not.toContain(S.benchmark.creationFailed);
  });
});
