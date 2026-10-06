/**
 * features/proposals/proposal-roadmaps.tsx, via react-dom/server static markup inside a memory
 * router: each roadmap a proposal belongs to is a line linking to that roadmap's page, naming
 * the item, with a link to the queue narrowed to it; no roadmaps, no list; a write's answer
 * keeps the roadmaps the detail had.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import type { ProposalDetail, ProposalRoadmapRef } from "@prismshadow/penguin-server/api";
import {
  RoadmapLines,
  keepRoadmaps,
  roadmapQueuePath,
} from "../src/features/proposals/proposal-roadmaps";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const render = (roadmaps: ProposalRoadmapRef[] | undefined) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(RoadmapLines, { projectId: "p1", orgId: "acme", roadmaps }),
    ),
  );

afterEach(() => setActiveStrings(zh));

describe("a proposal's roadmap lines", () => {
  it("link each roadmap and its queue filter, naming the item", () => {
    setActiveStrings(en);
    const html = render([{ number: 3, name: "Queue", itemKey: "ledger" }]);
    expect(html).toContain("Roadmap #3 «Queue»");
    expect(html).toContain('<code class="font-mono">ledger</code>');
    expect(html).toMatch(/href="[^"]*\/roadmaps\/3"/);
    const queue = roadmapQueuePath("p1", "acme", 3);
    expect(queue).toMatch(/\/proposals\?q=roadmap%3A3$/);
    expect(html).toContain(`href="${queue}"`);
  });

  it("render nothing without roadmaps", () => {
    expect(render([])).toBe("");
    expect(render(undefined)).toBe("");
  });

  it("survive a write's answer, which carries none", () => {
    const refs = [{ number: 3, name: "Queue", itemKey: "ledger" }];
    const prev = { number: 5, roadmaps: refs } as unknown as ProposalDetail;
    const next = { number: 5 } as unknown as ProposalDetail;
    expect(keepRoadmaps(prev, next).roadmaps).toEqual(refs);
    const read = { number: 5, roadmaps: [] } as unknown as ProposalDetail;
    expect(keepRoadmaps(prev, read).roadmaps).toEqual([]);
    expect(keepRoadmaps(null, next)).toBe(next);
  });
});
