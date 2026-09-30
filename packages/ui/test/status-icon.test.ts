/**
 * StatusIcon: the one spinner while a run is live, a registry glyph once it waits or settles, on
 * the spinner's three rungs, in token inks, named only when the caller names it.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { StatusIcon } from "../src/components/icons/status-icon/status-icon";
import type { RunState } from "../src/components/icons/status-icon/status-icon";
import { classTokens, renderStatic } from "../src/testing";

const render = (props: Parameters<typeof StatusIcon>[0]) =>
  renderStatic(createElement(StatusIcon, props));

describe("StatusIcon", () => {
  it("renders the Spinner while running, in the busy ink, never a hand-drawn ring", () => {
    const html = render({ state: "running", label: "Running" });
    expect(html).toContain('data-live="spinner"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Running"');
    expect(html).toContain('data-tooltip="Running"');
    expect(classTokens(html)).toContain("text-tone-success-fg");
    expect(html).not.toContain("border-t-transparent");
  });

  it("hides an unnamed spinner with its wrapper", () => {
    const html = render({ state: "running" });
    expect(html).toMatch(/^<span aria-hidden="true"/);
    expect(html).not.toContain("data-tooltip");
  });

  it("draws each settled state from the registry", () => {
    const glyphs: Record<Exclude<RunState, "running">, string> = {
      waiting: ICONS.hourglass,
      done: ICONS.checkCircle,
      failed: ICONS.xCircle,
      stopped: ICONS.stopCircle,
    };
    for (const [state, d] of Object.entries(glyphs)) {
      expect(render({ state: state as RunState })).toContain(`d="${d}"`);
    }
  });

  it("inks a wait as attention and a failure as danger, and lets done and stopped recede", () => {
    expect(classTokens(render({ state: "waiting" }))).toContain("text-tone-attention-fg");
    expect(classTokens(render({ state: "failed" }))).toContain("text-tone-danger-fg");
    for (const state of ["done", "stopped"] as const) {
      const tokens = classTokens(render({ state }));
      expect(tokens).toContain("text-fg-subtle");
      expect(tokens.some((t) => t.startsWith("text-tone-"))).toBe(false);
    }
  });

  it("takes the spinner's rungs, md by default, so a row keeps its box as the run settles", () => {
    expect(render({ state: "done" })).toContain('width="14"');
    expect(render({ state: "done", size: "sm" })).toContain('width="12"');
    expect(render({ state: "done", size: "xs" })).toContain('width="10"');
    expect(render({ state: "running", size: "xs" })).toContain('width="10"');
  });

  it("names a settled glyph as an image only when labelled", () => {
    const named = render({ state: "failed", label: "Failed" });
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Failed"');
    expect(named).toContain('data-tooltip="Failed"');
    const quiet = render({ state: "failed" });
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain("role=");
  });
});
