/**
 * Every place the CLI cuts text to a length keeps an emoji whole. A character outside the BMP is
 * two UTF-16 units, and a cut between them leaves a lone half, which a terminal shows as `�`.
 * Each case below puts an emoji across the cut: a renamed Session's title in `session ls`, an
 * Agent's description in `agent ls`, a tool call's preview and its approval payload, and the
 * browser's tab titles, exec return value and `cdp` result.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { getMessages } from "@prismshadow/penguin-server/cli";
import { cli } from "../src/index.js";
import {
  RETURN_LIMIT,
  SAVED_PREVIEW,
  renderCdpResult,
  renderExec,
  renderTabs,
} from "../src/browser-output.js";
import { renderFileToolApprovalPayload, renderPartialToolCall } from "../src/tool-render.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");
const ROCKET = "\u{1F680}";
/** A UTF-16 half with no partner beside it. */
const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** `before` code units, then an emoji whose first half is the last unit a cut at `before + 1` keeps. */
const across = (before: number): string => `${"x".repeat(before)}${ROCKET} and more`;

/** Fails with the units around the first lone half, not the whole (possibly 8000-unit) output. */
function expectNoLoneHalf(out: string): void {
  const at = out.search(LONE_HALF);
  expect(at === -1 ? "" : JSON.stringify(out.slice(Math.max(0, at - 8), at + 8))).toBe("");
}

/** How many x's run up to `marker`: the length a long cut kept, without printing the cut. */
const xsBefore = (out: string, marker: string): number | undefined =>
  /x*$/.exec(out.slice(0, out.indexOf(marker)))?.[0].length;

describe("cuts in the listing commands", () => {
  let server: FakeServer;
  let uninstall: () => void;
  let stdout: string[];
  let outSpy: { mockRestore(): void };

  beforeEach(() => {
    server = new FakeServer();
    uninstall = server.install();
    stdout = [];
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    outSpy.mockRestore();
    uninstall();
  });

  it("session ls cuts a renamed title before an emoji that straddles 40 characters", async () => {
    server.addSession({ sessionId: "session-2026-08-25-10-00-00-e3010001", title: across(39) });
    expect(await cli(["session", "ls"])).toBe(0);
    const out = stdout.join("");
    expectNoLoneHalf(out);
    expect(out).toContain(`${"x".repeat(39)}  `);
  });

  it("agent ls cuts a description before an emoji that straddles 60 characters", async () => {
    server.agents[0]!.description = across(59);
    expect(await cli(["agent", "ls"])).toBe(0);
    const out = stdout.join("");
    expectNoLoneHalf(out);
    expect(out).toContain(`${"x".repeat(59)}\n`);
  });
});

describe("cuts in tool-call rendering", () => {
  it("a payload preview stops before an emoji that straddles its limit", () => {
    const preview = renderPartialToolCall(
      "input_subagent",
      JSON.stringify({ subagent_id: "subagent-9f8e7d6c", prompt: across(119) }),
    );
    expect(preview).toBe(`input_subagent <- subagent-9f8e7d6c << ${"x".repeat(119)}…`);
  });

  it("an approval payload line stops before an emoji that straddles its limit", () => {
    // "content: " is 9 units, so the emoji's first half is unit 200 of the line.
    const payload = renderFileToolApprovalPayload(
      "write_file",
      JSON.stringify({ file_path: "notes.md", content: across(190) }),
    );
    expect(payload).toBe(["file_path: notes.md", `content: ${"x".repeat(190)}…`].join("\n"));
  });
});

describe("cuts in the browser's output", () => {
  const tab = (title: string): BuiltinBrowserTab => ({
    id: 12,
    title,
    url: "https://example.com/",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });

  it("the tabs table cuts a title before an emoji that straddles 60 characters", () => {
    // The cut keeps 59 units and adds "…".
    const out = renderTabs({ tabs: [tab(across(58))], activeTabId: 12 }, t);
    expectNoLoneHalf(out);
    expect(out).toContain(`${"x".repeat(58)}…`);
  });

  it("an exec return value keeps the emoji out of a cut preview or a cut value", () => {
    const saved = renderExec(
      { status: "success", tabId: 12, value: across(SAVED_PREVIEW - 1) },
      t,
      { alwaysReturn: true, savedTo: "/tmp/out.txt" },
    );
    expectNoLoneHalf(saved);
    expect(saved).toContain(`${"x".repeat(SAVED_PREVIEW - 1)}…`);

    const cut = renderExec({ status: "success", tabId: 12, value: across(RETURN_LIMIT - 1) }, t, {
      alwaysReturn: true,
    });
    expectNoLoneHalf(cut);
    expect(xsBefore(cut, ` ${t.browser.truncatedSave()}`)).toBe(RETURN_LIMIT - 1);
  });

  it("a cdp result cut at its limit keeps the emoji out", () => {
    // `{"value":"` is 10 units, so the emoji's first half is unit 8000 of the JSON.
    const out = renderCdpResult({ value: across(RETURN_LIMIT - 11) }, t);
    expectNoLoneHalf(out);
    expect(xsBefore(out, ` ${t.browser.truncatedJson()}`)).toBe(RETURN_LIMIT - 11);
  });
});
