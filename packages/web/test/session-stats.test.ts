/**
 * The chat details card's statistics (features/chat/session-stats.tsx), which follow the Trace
 * view's overview: each total carries its breakdown behind a "?" right of it. Rendered to static
 * markup and read back (test/helpers/markup.ts); a closed "?" draws only its trigger, so the
 * token breakdown it opens is rendered on its own.
 *
 * - Given a priced session that has run, Total Tokens, Cost and Elapsed each end with a "?" of
 *   their own, and nothing else in the list carries one.
 * - Total Tokens keeps the cache hit rate inline, in parentheses before its "?".
 * - Before a usage fetch has applied, Total Tokens is the bare total: no rate, no "?".
 * - Given a session that has not run (no API or tool time yet), Elapsed is the bare time.
 * - The token breakdown names cached input, uncached input and output, each with its Tokens and
 *   its share of the total they make up.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_UI_STRINGS } from "@prismshadow/penguin-ui";
import { TokenPartsRows } from "../src/components/ui/stat-hint";
import type { UsageParts } from "../src/components/ui/stat-hint";
import {
  SessionElapsed,
  SessionStatsList,
  sessionElapsedSplit,
} from "../src/features/chat/session-stats";
import { createTaskStatsTracker } from "../src/lib/amsp/task-stats";
import { S } from "../src/lib/strings";
import { elementsOf, readMarkup, seenText } from "./helpers/markup";
import type { MarkupElement } from "./helpers/markup";

/** 21.4M Tokens, 97% of the input read from the cache. */
const USAGE: UsageParts = { cacheRead: 20_700_000, cacheWrite: 600_000, output: 100_000 };

/** A settled session: 440m56s elapsed, with the model API and tool time measured inside it. */
function ranSession(api: { llmMs: number; toolMs: number }) {
  const stats = createTaskStatsTracker();
  stats.sessionElapsedMs = 26_456_000;
  stats.sessionLlmMs = api.llmMs;
  stats.sessionToolMs = api.toolMs;
  return { stats, taskOpen: false, taskStartLocalMs: 0 };
}

function list(opts: {
  usage: UsageParts | null;
  cost?: boolean;
  elapsed?: { llmMs: number; toolMs: number };
}): MarkupElement[] {
  const source = ranSession(opts.elapsed ?? { llmMs: 9_000_000, toolMs: 14_000_000 });
  const html = renderToStaticMarkup(
    createElement(SessionStatsList, {
      tokens: "21.4M",
      usage: opts.usage,
      cost:
        opts.cost === false
          ? null
          : {
              text: "$3.20",
              uncosted: false,
              parts: { cacheRead: 1.2, cacheWrite: 1.5, output: 0.5 },
            },
      currency: "USD",
      elapsed: createElement(SessionElapsed, source),
      elapsedSplit: sessionElapsedSplit(source),
    }),
  );
  return elementsOf(readMarkup(html)).filter((e) => e.tag === "li");
}

/** The accessible names of the "?" marks a bullet carries. */
const hintsIn = (li: MarkupElement): string[] =>
  elementsOf(li)
    .filter((e) => e.tag === "button")
    .map((e) => e.attrs["aria-label"] ?? "");

/** The last element in a bullet: the "?", when it has one, closes the line. */
const lastElementOf = (li: MarkupElement): MarkupElement | undefined =>
  li.children.filter((c): c is MarkupElement => typeof c !== "string").at(-1);

describe("the details card's statistics", () => {
  it('ends each total — Total Tokens, Cost, Elapsed — with a "?" of its own', () => {
    const [tokens, cost, elapsed] = list({ usage: USAGE });

    expect(hintsIn(tokens!)).toEqual([DEFAULT_UI_STRINGS.moreInfoAbout(S.chat.statTotalTokens)]);
    expect(hintsIn(cost!)).toEqual([DEFAULT_UI_STRINGS.moreInfoAbout(S.common.cost)]);
    expect(hintsIn(elapsed!)).toEqual([DEFAULT_UI_STRINGS.moreInfoAbout(S.chat.statElapsed)]);
    for (const li of [tokens!, cost!, elapsed!]) expect(lastElementOf(li)?.tag).toBe("button");
  });

  it('keeps the cache hit rate inline in the Total Tokens line, before its "?"', () => {
    const [tokens] = list({ usage: USAGE });

    expect(seenText(tokens!)).toBe(
      `${S.chat.statTotalTokens} 21.4M${S.chat.statParenOpen}${S.chat.statCacheHit("97%")}${S.chat.statParenClose}`,
    );
  });

  it("shows the bare token total before a usage fetch has applied", () => {
    const [tokens] = list({ usage: null });

    expect(seenText(tokens!)).toBe(`${S.chat.statTotalTokens} 21.4M`);
    expect(hintsIn(tokens!)).toEqual([]);
  });

  it("shows the bare elapsed time for a session with no API or tool time yet", () => {
    const [, elapsed] = list({ usage: null, cost: false, elapsed: { llmMs: 0, toolMs: 0 } });

    expect(seenText(elapsed!)).toBe(`${S.chat.statElapsed} 440m56s`);
    expect(hintsIn(elapsed!)).toEqual([]);
  });
});

describe("the token breakdown", () => {
  it("names the three parts with each one's Tokens and share of the total", () => {
    const html = renderToStaticMarkup(createElement(TokenPartsRows, { parts: USAGE }));
    const cells = elementsOf(readMarkup(html))
      .filter((e) => e.tag === "dt" || e.tag === "dd")
      .map(seenText);

    expect(cells).toEqual([
      S.chat.usagePartCacheRead,
      "20.7M",
      "(97%)",
      S.chat.usagePartCacheWrite,
      "600k",
      "(3%)",
      S.chat.usagePartOutput,
      "100k",
      "(0%)",
    ]);
  });
});
