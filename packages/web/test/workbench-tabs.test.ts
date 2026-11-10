/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import {
  appPageTab,
  settleActiveTab,
  workbenchAppPath,
  workbenchNoticesOf,
  workbenchTabsOf,
  workbenchUiUrl,
} from "../src/lib/workbench-tabs";
import { WorkbenchSessionTab } from "../src/features/workbenches/session-tab";
import { LocaleProvider } from "../src/state/locale";
import { ThemeProvider } from "../src/state/theme";
import { click, mount, run, settle, unmountAll } from "./helpers/dom";
import { json, stubFetch } from "./helpers/fetch";
import { S } from "../src/lib/strings";

const UI = "/api/projects/p/agents/a/workbenches/demo/ui";
const tab = (key: string, file: string) => ({
  id: `demo.${key}`,
  key,
  title: key,
  renderer: { iframe: { src: `${UI}/${file}` } },
});

const info = (over: Partial<WorkbenchInfo>): WorkbenchInfo => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: "0123456789ab",
  tabs: [tab("board", "index.html")],
  loadedAt: "2026-08-30T00:00:00Z",
  error: null,
  hints: [],
  ...over,
});

describe("workbench tabs", () => {
  it("shows one tab per contribution, keeping the workbench's load error", () => {
    const tabs = workbenchTabsOf([
      info({
        tabs: [tab("board", "index.html"), { ...tab("stats", "stats.html"), titleZh: "统计" }],
      }),
      info({ id: "headless", tabs: [] }),
      info({ id: "broken", error: "module tree rejected" }),
      info({
        id: "other",
        tabs: [{ id: "other.x", key: "x", title: "X", renderer: { builtin: "nope" } }],
      }),
    ]);
    expect(tabs.map((t) => t.tabId)).toEqual(["demo/board", "demo/stats", "broken/board"]);
    expect(tabs[1]).toMatchObject({ key: "stats", titleZh: "统计", src: `${UI}/stats.html` });
    expect(tabs[2]!.error).toBe("module tree rejected");
  });

  it("serves the page of a machine's workbench through that machine, and says which", () => {
    // A Session on a machine runs a copy of the Agent there, and the workbenches it built live in
    // that copy: the page is fetched through the machine's connection, and every later call
    // about the tab (reload, history, remove) has to go the same way.
    const [local] = workbenchTabsOf([info({})]);
    expect(local).toMatchObject({ machineId: null, src: `${UI}/index.html` });
    const [remote] = workbenchTabsOf([info({})], "m-1");
    expect(remote).toMatchObject({ machineId: "m-1", src: `/server/m-1${UI}/index.html` });
    expect(workbenchAppPath("p", "a", "demo", "board", "m-1")).toBe(
      "/app/p/a/demo/board?machine=m-1",
    );
  });

  it("falls back to Chat when the active tab is gone", () => {
    const tabs = workbenchTabsOf([info({})]);
    expect(settleActiveTab("demo/board", tabs)).toBe("demo/board");
    expect(settleActiveTab("demo/gone", tabs)).toBeNull();
    expect(settleActiveTab(null, tabs)).toBeNull();
  });

  it("keys the page URL on the UI revision so a changed UI reloads", () => {
    expect(workbenchUiUrl({ src: `${UI}/index.html`, uiRev: "0123456789ab" })).toBe(
      `${UI}/index.html?rev=0123456789ab`,
    );
  });

  it("names a full page by workbench and, optionally, tab", () => {
    expect(workbenchAppPath("p 1", "a", "demo")).toBe("/app/p%201/a/demo");
    expect(workbenchAppPath("p 1", "a", "demo", "stats")).toBe("/app/p%201/a/demo/stats");
    const tabs = workbenchTabsOf([
      info({ tabs: [tab("board", "index.html"), tab("stats", "stats.html")] }),
    ]);
    expect(appPageTab(tabs, "demo", undefined)?.key).toBe("board");
    expect(appPageTab(tabs, "demo", "stats")?.key).toBe("stats");
    expect(appPageTab(tabs, "demo", "nope")).toBeNull();
    expect(appPageTab(tabs, "gone", undefined)).toBeNull();
  });
});

describe("workbenches with nothing to show", () => {
  it("surfaces a workbench that contributes no tab but has an error or a hint", () => {
    // A workbench whose FIRST load fails has no tabs at all, so without this the reader sees
    // nothing anywhere in the app — no tab, no mark, no message.
    const broken = info({ id: "broken", tabs: [], error: "index.ts(3,1): TS1005" });
    const hinted = info({ id: "hinted", tabs: [], hints: ["ui/index.html is shown by no tab"] });
    expect(workbenchNoticesOf([broken, hinted, info({})])).toEqual([
      { workbenchId: "broken", error: "index.ts(3,1): TS1005", hints: [] },
      { workbenchId: "hinted", error: null, hints: ["ui/index.html is shown by no tab"] },
    ]);
  });

  it("says nothing about a workbench that is fine, or one whose tabs can carry its error", () => {
    expect(workbenchNoticesOf([info({})])).toEqual([]);
    expect(workbenchNoticesOf([info({ error: "broken" })])).toEqual([]);
    expect(workbenchNoticesOf([info({ tabs: [] })])).toEqual([]);
  });
});

describe("the chat page under a workbench tab", () => {
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  /** jsdom's matchMedia: no query ever matches (the stub the mounted suites share). */
  const unmatchedQuery = {
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;

  it("shows its window beside Chat, and hands the page the way back to Chat", async () => {
    stubFetch((request) =>
      request.path === "/api/projects/p/agents/a/workbenches"
        ? json({ workbenches: [info({})] })
        : json({}),
    );
    vi.stubGlobal("matchMedia", () => unmatchedQuery);
    /** The page's area under the strips, where a tab's window mounts beside Chat. */
    const windows = document.createElement("div");
    document.body.appendChild(windows);
    /** Whether the tab reported its window shown, in order, and the last way back to Chat. */
    const shown: boolean[] = [];
    let showChat = null as (() => void) | null;
    const page = await mount(
      h(
        MemoryRouter,
        { initialEntries: ["/chat"] },
        h(
          LocaleProvider,
          null,
          h(
            ThemeProvider,
            null,
            h(WorkbenchSessionTab, {
              projectId: "p",
              agentId: "a",
              machineId: null,
              windows,
              onWindowShown: (back: (() => void) | null) => {
                shown.push(back !== null);
                showChat = back;
              },
            }),
          ),
        ),
      ),
    );
    await settle();
    // Chat is the window on screen while the tab strip is all the tab draws.
    expect(shown).toEqual([false]);
    expect(windows.childElementCount).toBe(0);

    // Select the workbench: its window, holding the page's frame, mounts in the window area
    // while the strip stays above it. (On a transition the leaving effect reports its null
    // before the entering one reports — the page reads the last report.)
    const tabs = () => [...page.container.querySelectorAll('button[role="tab"]')];
    const selected = () => tabs().find((b) => b.getAttribute("aria-selected") === "true");
    const board = tabs().find((b) => b.textContent === "board");
    expect(board).toBeDefined();
    await click(board!);
    expect(shown.at(-1)).toBe(true);
    expect(windows.querySelector('[data-window][data-shown="true"] iframe')).not.toBeNull();
    expect(page.container.querySelector("iframe")).toBeNull();

    // The way back the page was handed — what a dock shortcut calls first: Chat is selected
    // and the workbench window leaves.
    await run(() => showChat!());
    expect(shown.at(-1)).toBe(false);
    expect(selected()?.textContent).toBe(S.workbenches.chatTab);
    expect(windows.childElementCount).toBe(0);

    // Leaving the page takes the window with it, whatever was shown.
    await click(board!);
    expect(shown.at(-1)).toBe(true);
    await page.unmount();
    expect(shown.at(-1)).toBe(false);
    expect(windows.childElementCount).toBe(0);
    windows.remove();
  });
});
