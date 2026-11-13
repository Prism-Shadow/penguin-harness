/**
 * The chat toolbar's run indicator (features/chat/run-status.tsx).
 *
 * - Given a turn is running, then the toolbar shows the turning hourglass named in words, and the
 *   same words beside it, as the `ui-run` section's mark and label.
 * - Given the conversation is compacting, has settled, or never ran, then the toolbar shows
 *   nothing: a compaction is the stream banner's to tell, and the conversation on screen is read.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunStatus } from "../src/features/chat/run-status";
import { sessionActivityLabel } from "../src/lib/session-activity";
import { elementsOf, readMarkup } from "./helpers/markup";

const render = (activity: Parameters<typeof RunStatus>[0]["activity"]) =>
  renderToStaticMarkup(createElement(RunStatus, { activity }));

describe("RunStatus", () => {
  it("shows the turning hourglass and its words while a turn runs", () => {
    const label = sessionActivityLabel("running");
    const root = readMarkup(render("running"));
    expect(root.children[0]).toMatchObject({ attrs: { "data-state": "running" } });
    const parts = elementsOf(root);
    const mark = parts.find((e) => e.attrs["data-slot"] === "mark")!;
    expect(
      elementsOf(mark).some((e) => e.attrs.role === "status" && e.attrs["aria-label"] === label),
    ).toBe(true);
    const words = parts.find((e) => e.attrs["data-slot"] === "label")!;
    expect(words.children).toEqual([label]);
  });

  it("shows nothing while compacting, once settled, or for a conversation that never ran", () => {
    expect(render("compacting")).toBe("");
    expect(render("completedUnread")).toBe("");
    expect(render(null)).toBe("");
  });
});
