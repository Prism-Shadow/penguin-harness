import { describe, expect, it } from "vitest";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import {
  appPageTab,
  settleActiveTab,
  workbenchAppPath,
  workbenchNoticesOf,
  workbenchTabsOf,
  workbenchUiUrl,
} from "../src/lib/workbench-tabs";

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
