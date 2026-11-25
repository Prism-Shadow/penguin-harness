/**
 * StagedProgress (src/components/feedback/staged-progress/staged-progress.tsx): one bar cut into a
 * segment per stage. Finished stages are full and later ones empty; the current one shows its
 * amount, a live mark when it reports none, nothing while it waits, and its fill in the attention
 * tone when it stopped. The bar reads as full only when every stage is finished.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  StagedProgress,
  stagedShare,
} from "../src/components/feedback/staged-progress/staged-progress";
import { renderStatic } from "../src/testing";

const STAGES = [{ key: "check" }, { key: "fetch", weight: 3 }, { key: "start" }];
const states = (html: string) =>
  [...html.matchAll(/data-stage="(\w+)" data-state="(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`);
const render = (props: Record<string, unknown>) =>
  renderStatic(
    createElement(StagedProgress, { stages: STAGES, label: "Install", ...props } as never),
  );

describe("StagedProgress", () => {
  it("fills the finished stages and moves the current one's amount on the layout motion", () => {
    const html = render({ current: 1, value: 0.5 });
    expect(states(html)).toEqual(["check:done", "fetch:running", "start:pending"]);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('data-layout-motion=""');
    expect(html).toContain("width:50%");
  });

  it("reports no amount for a stage that names none, and pulses through the live hook", () => {
    const html = render({ current: 1 });
    expect(html).not.toContain("aria-valuenow");
    expect(html).toContain('data-live="bar"');
  });

  it("keeps a waiting stage empty and still, and a stopped one in the attention tone", () => {
    const waiting = render({ current: 2, status: "waiting" });
    expect(states(waiting)).toEqual(["check:done", "fetch:done", "start:waiting"]);
    expect(waiting).not.toContain("data-live");
    const stopped = render({ current: 1, value: 0.6, status: "stopped" });
    expect(states(stopped)).toEqual(["check:done", "fetch:stopped", "start:pending"]);
    expect(stopped).toContain("bg-tone-attention-emphasis");
    expect(stopped).not.toContain("data-live");
  });

  it("is full only when every stage is finished", () => {
    expect(stagedShare(STAGES, 2, 1)).toBe(1);
    expect(stagedShare(STAGES, 2, 0.99)).toBeLessThan(1);
    expect(stagedShare(STAGES, 2)).toBe(0.8);
    expect(render({ current: 3 })).toContain('aria-valuenow="100"');
  });
});
