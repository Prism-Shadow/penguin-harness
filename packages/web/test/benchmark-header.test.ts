/**
 * What a Benchmark's own page says under its title (BenchmarkHeaderFacts in
 * src/features/benchmark/benchmark-detail-page.tsx).
 *
 * - It names the directory the files live in, and the version the manifest is at.
 * - A copy an Agent imported from a repository folder links that folder; a copy from anywhere
 *   else links nothing.
 * - A link that is not http(s) is never rendered as one, whatever the manifest says.
 * - A Benchmark with no version — its manifest was written before versions or could not be read,
 *   or a machine running an older server answered for it — names its directory alone.
 *
 * vitest runs node-only here, so the header is rendered to static markup.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BenchmarkSummary } from "@prismshadow/penguin-server/api";
import { BenchmarkHeaderFacts } from "../src/features/benchmark/benchmark-detail-page";

const FOLDER =
  "https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/c12d65bc20beb5130ed57b3b7983c62d497b7d2f/packages/penguinharness-benchmark-sec-a";

const render = (benchmark: Pick<BenchmarkSummary, "id" | "version" | "origin">) =>
  renderToStaticMarkup(createElement(BenchmarkHeaderFacts, { benchmark }));

/** Every link's target in `html`. */
const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);

describe("the facts under a Benchmark page's title", () => {
  it("names the directory and the version the manifest is at", () => {
    const html = render({
      id: "report-writing-v1",
      version: "2026.10.09.2",
      origin: { kind: "manual" },
    });

    expect(html).toContain("benchmarks/report-writing-v1");
    expect(html).toContain("v2026.10.09.2");
  });

  it("links the repository folder an Agent imported the Benchmark from", () => {
    const html = render({
      id: "penguinharness-benchmark-sec-a",
      version: "2026.10.09.1",
      origin: { kind: "git", url: FOLDER, ref: "c12d65bc20beb5130ed57b3b7983c62d497b7d2f" },
    });

    expect(links(html)).toEqual([FOLDER]);
  });

  it.each([
    ["seeded", { kind: "builtin" }],
    ["made by hand", { kind: "manual" }],
    ["uploaded", { kind: "zip", importedAt: "2026-10-09T08:00:00.000Z" }],
  ] as const)("links nothing for a copy %s", (_how, origin) => {
    expect(links(render({ id: "report-writing-v1", version: "2026.10.09.1", origin }))).toEqual([]);
  });

  it("never renders a source that is not an http(s) link as one", () => {
    const html = render({
      id: "report-writing-v1",
      version: "2026.10.09.1",
      origin: { kind: "git", url: "javascript:alert(1)" },
    });

    expect(links(html)).toEqual([]);
    expect(html).not.toContain("javascript:");
  });

  it("names the directory alone when there is no version to show", () => {
    const html = render({ id: "report-writing-v1" });

    expect(html).toContain("benchmarks/report-writing-v1");
    expect(html).not.toMatch(/v\d{4}\./);
    expect(links(html)).toEqual([]);
  });
});
