// @vitest-environment jsdom
/**
 * The recovery panel (rescue/rescue-panel.tsx) a crashed page body or app root falls back to,
 * mounted the way the app mounts it: the rescue error boundary around a tree that throws.
 *
 * - Given a page that crashes while rendering, the panel stands in its place with the error and
 *   「[报告问题]」; pressing it opens the report in the panel's own dialog, holding the error and
 *   its stack with the home directory's account name taken out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { ErrorBoundary } from "../src/rescue/error-boundary";
import { RescuePanel } from "../src/rescue/rescue-panel";
import { click, mount, unmountAll } from "./helpers/dom";

afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

function crash(): Error {
  const error = new TypeError("Cannot read properties of undefined (reading 'title')");
  error.stack = [
    "TypeError: Cannot read properties of undefined (reading 'title')",
    "    at SessionTitle (/home/alice/penguin-harness/packages/web/src/features/chat/title.tsx:42:18)",
  ].join("\n");
  return error;
}

function Broken(): never {
  throw crash();
}

describe("the recovery panel", () => {
  it("offers Report for a page that crashed, and its report holds the error without the account name", async () => {
    // React reports the caught render error on the console; the panel is what this is about.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mount(
      h(ErrorBoundary, {
        fallback: (error: unknown) => h(RescuePanel, { error }),
        children: h(Broken),
      }),
    );
    const panel = document.querySelector("[role=alert]");
    expect(panel?.textContent).toContain("Cannot read properties of undefined (reading 'title')");
    const press = panel?.querySelector("[data-report-issue]");
    expect(press).not.toBeNull();
    expect(press?.classList.contains("text-tone-danger-fg")).toBe(true);
    await click(press!);
    const report = document.querySelector("[data-report]")?.textContent ?? "";
    expect(report).toContain("- What happened: the page crashed while rendering");
    expect(report).toContain("TypeError: Cannot read properties of undefined (reading 'title')");
    expect(report).toContain(
      "/home/<user>/penguin-harness/packages/web/src/features/chat/title.tsx",
    );
    expect(report).not.toContain("alice");
  });
});
