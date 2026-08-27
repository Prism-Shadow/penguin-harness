/**
 * The Trace panel's refresh rules (features/traces/trace-refresh.ts): the tab re-fetches when
 * it becomes visible and when a turn settles WHILE it is visible, never for a hidden tab, and
 * a re-fetch leaves the user's selected file where they put it — including the default they
 * never picked, and including a re-fetch that fails while they are reading.
 *
 * The panel's edges are decided by a pure tracker for the same reason the subagents panel's
 * auto-open is (panel-task-scope.test.ts): the Web suite runs in a node environment and renders
 * no React, so the rule is unit-testable only where it is separable from the effect that applies
 * it. The wiring that carries the decision into the two components is pinned at the bottom,
 * against their source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  activeTraceFile,
  advanceTraceRefresh,
  createTraceRefresh,
  sortTraceFiles,
} from "../src/features/traces/trace-refresh";

const obs = (active: boolean, signal: number) => ({ active, signal });

/**
 * Source of the two components the rules are wired into. The suite renders no React, so a rule
 * that lives inside an effect or a render guard is pinned against the text that implements it.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const chatPage = read("../src/features/chat/chat-page.tsx");
const panel = read("../src/features/traces/trace-panel.tsx");
const fileView = read("../src/features/traces/trace-file-view.tsx");

describe("advanceTraceRefresh (when the Trace panel re-fetches)", () => {
  it("treats the panel's own first render as no edge — the fetch effect already loads on mount", () => {
    const shown = createTraceRefresh(obs(true, 3));
    expect(advanceTraceRefresh(shown, obs(true, 3))).toBe(false);
    const hidden = createTraceRefresh(obs(false, 0));
    expect(advanceTraceRefresh(hidden, obs(false, 0))).toBe(false);
  });

  it("re-fetches on the hidden→visible edge, and not on the way back", () => {
    const s = createTraceRefresh(obs(false, 0));
    expect(advanceTraceRefresh(s, obs(true, 0))).toBe(true);
    // Still showing, nothing settled: renders alone must not fetch.
    expect(advanceTraceRefresh(s, obs(true, 0))).toBe(false);
    expect(advanceTraceRefresh(s, obs(false, 0))).toBe(false);
    expect(advanceTraceRefresh(s, obs(true, 0))).toBe(true);
  });

  it("re-fetches when a turn settles while the panel is showing", () => {
    const s = createTraceRefresh(obs(true, 0));
    expect(advanceTraceRefresh(s, obs(true, 1))).toBe(true);
    // One bump is one fetch: re-rendering at the same count does not fetch again.
    expect(advanceTraceRefresh(s, obs(true, 1))).toBe(false);
    expect(advanceTraceRefresh(s, obs(true, 2))).toBe(true);
  });

  it("fetches nothing for a hidden tab, and the re-show is what brings it current", () => {
    const s = createTraceRefresh(obs(false, 0));
    expect(advanceTraceRefresh(s, obs(false, 1))).toBe(false);
    expect(advanceTraceRefresh(s, obs(false, 2))).toBe(false);
    expect(advanceTraceRefresh(s, obs(false, 3))).toBe(false);
    // Three turns went by unread; showing the tab again re-fetches ONCE, not once per turn.
    expect(advanceTraceRefresh(s, obs(true, 3))).toBe(true);
    expect(advanceTraceRefresh(s, obs(true, 3))).toBe(false);
  });

  it("counts a turn settling in the same observation as the re-show as one fetch", () => {
    const s = createTraceRefresh(obs(false, 4));
    expect(advanceTraceRefresh(s, obs(true, 5))).toBe(true);
    expect(advanceTraceRefresh(s, obs(true, 5))).toBe(false);
  });

  it("reads any change of the counter as a bump, so a reset source cannot go unnoticed", () => {
    const s = createTraceRefresh(obs(true, 7));
    expect(advanceTraceRefresh(s, obs(true, 0))).toBe(true);
  });
});

describe("the Trace file list across a re-fetch", () => {
  const file = (index: number, sizeBytes = 100) => ({ index, date: "2026-08-26", sizeBytes });

  it("orders the pill row newest first, without sorting the response in place", () => {
    const res = [file(1), file(3), file(2)];
    expect(sortTraceFiles(res).map((f) => f.index)).toEqual([3, 2, 1]);
    expect(res.map((f) => f.index)).toEqual([1, 3, 2]);
  });

  it("keeps the selected file when a re-fetch returns it grown, or with newer files beside it", () => {
    const before = sortTraceFiles([file(1, 200), file(2, 900)]);
    expect(activeTraceFile(before, 1)?.index).toBe(1);
    // The ordinary refresh: the SAME file, larger. The pick survives and reports the new size.
    const grown = sortTraceFiles([file(1, 4200), file(2, 900)]);
    expect(activeTraceFile(grown, 1)).toMatchObject({ index: 1, sizeBytes: 4200 });
    // A compaction shard appearing must not yank the user onto it.
    const withNew = sortTraceFiles([file(1, 4200), file(2, 900), file(3, 10)]);
    expect(activeTraceFile(withNew, 1)?.index).toBe(1);
    // Held as null it WOULD yank: the fallback is re-resolved on every re-list, so the shard
    // that just appeared becomes the selection and the view below remounts onto it. That is
    // the whole reason the panel pins a real index the first time a listing arrives — a reader
    // who never clicked a pill is otherwise the one reader a refresh is allowed to disturb.
    expect(activeTraceFile(withNew, null)?.index).toBe(3);
  });

  it("falls back to the newest file when the selection vanished, and to nothing when the Session has no Trace", () => {
    const files = sortTraceFiles([file(4), file(5)]);
    expect(activeTraceFile(files, 9)?.index).toBe(5);
    // Null reaches here only before the first listing has been shown; the panel pins the
    // default from that listing, so this fallback is what it pins TO.
    expect(activeTraceFile(files, null)?.index).toBe(5);
    expect(activeTraceFile([], null)).toBeNull();
    expect(activeTraceFile([], 2)).toBeNull();
  });
});

/**
 * The decision has to reach both halves of the panel: the listing AND the file it is showing.
 * A Trace file is appended to while the Session runs, so re-listing alone would refresh the
 * sizes on the pills while the timeline below them stayed as it was read minutes ago.
 */
describe("the settled-turn signal's wiring", () => {
  /** The identifier a mounted component is handed as its reloadSignal, or null. */
  const signalOf = (tag: string) =>
    new RegExp(`<${tag}[^>]*reloadSignal=\\{(\\w+)\\}`).exec(chatPage)?.[1] ?? null;

  it("hands the Trace panel the very counter the Files panel refreshes on", () => {
    expect(signalOf("WorkspaceBrowser")).not.toBeNull();
    expect(signalOf("TracePanel")).toBe(signalOf("WorkspaceBrowser"));
  });

  it("carries it one level further, into the view that reads the selected file", () => {
    expect(panel).toMatch(/<TraceFileView[^>]*reloadSignal=\{listTick\}/);
    expect(panel).toMatch(
      /advanceTraceRefresh\(refresh\.current, \{ active, signal: reloadSignal \}\)/,
    );
  });

  it("re-runs the file's load on that signal, and clears no view state doing it", () => {
    const load = fileView.slice(
      fileView.indexOf("useEffect(() => {", fileView.indexOf("const fileKey")),
    );
    const body = load.slice(0, load.indexOf("\n  }, ["));
    const deps = /\n {2}\}, \[([^\]]*)\]/.exec(load)?.[1] ?? "";
    expect(deps).toContain("reloadSignal");
    // The collapsed rounds and the pinned row are cleared where a DIFFERENT file is adopted,
    // never on a refresh of the one on screen.
    expect(body).not.toContain("setCollapsed");
    expect(body).not.toContain("setPinnedRow");
    expect(fileView).toMatch(/renderedFileKey !== fileKey[\s\S]{0,320}setCollapsed\(new Set\(\)\)/);
  });
});

/**
 * What a refresh is allowed to move, now that one fires on every settled turn rather than only
 * when the user brings the tab up. Both rules below are about the same reader: someone part-way
 * through a Trace while the Session keeps working, who did nothing to ask for any of this.
 */
describe("what a settled-turn refresh must leave alone", () => {
  /** The panel's listing effect, and the failure branch inside it. */
  const listing = panel.slice(
    panel.indexOf("getSessionTraces"),
    panel.indexOf("}, [active, listTick"),
  );
  const listingFailure = listing.slice(listing.indexOf(".catch("));

  it("pins the default selection to the first listing instead of re-resolving it each time", () => {
    // activeTraceFile resolves a null pick to the newest file EVERY time it is called, so the
    // panel has to commit to an index once rather than leave the default to that fallback.
    expect(listing).toMatch(/setFileIndex\(\(cur\) => cur \?\?/);
    // And the pin is one-way: the only other write is the user's own pill click.
    expect(panel.match(/setFileIndex\(/g)).toHaveLength(2);
    expect(panel).toMatch(/onClick=\{\(\) => setFileIndex\(f\.index\)\}/);
  });

  it("keeps the listing on screen when a re-list fails, reporting it beside the pills", () => {
    // Emptying the list here would unmount the pills, the header, the download link and the
    // whole file view below them — collapsed rounds, pinned row and scroll position included.
    expect(listingFailure).not.toContain("setFiles");
    expect(listingFailure).toContain("setError(");
    expect(panel).toMatch(/\{error !== null && \([\s\S]{0,200}toneStrip\.danger/);
  });

  it("gives the panel over to the failure only when there is nothing to keep", () => {
    // The two whole-panel failure states: no listing yet, and a listing with no file in it.
    expect(panel).toMatch(
      /if \(files === null\) \{\s*if \(error !== null\) return <EmptyState title=\{S\.tracePanel\.loadFailed\}/,
    );
    expect(panel).toMatch(
      /if \(activeFile === null\) \{\s*if \(error !== null\) return <EmptyState title=\{S\.tracePanel\.loadFailed\}/,
    );
  });

  it("keeps the file on screen when its re-read fails, reporting it above the summary", () => {
    expect(fileView).toMatch(/if \(error !== null && analysis === null\)/);
    expect(fileView).toMatch(/\{error !== null && <p /);
  });

  it("leaves the project's model catalog out of the refresh, on an effect of its own", () => {
    const load = fileView.slice(
      fileView.indexOf("useEffect(() => {", fileView.indexOf("const fileKey")),
    );
    // Pricing is a project-level catalog no turn produces: refetching it per settled turn was
    // waste, and the `?? prev` guard that kept a failed refetch from dropping the cost column
    // went with it.
    expect(load.slice(0, load.indexOf("\n  }, ["))).not.toContain("getModels");
    expect(fileView).not.toContain("setModels((prev)");
    const pricing = fileView.slice(fileView.indexOf("getModels(projectId)"));
    expect(/\n {2}\}, \[([^\]]*)\]/.exec(pricing)?.[1]).toBe("projectId");
  });
});
