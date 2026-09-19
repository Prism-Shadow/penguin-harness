import { describe, expect, it } from "vitest";
import type { WorkflowInfo } from "@prismshadow/penguin-server/api";
import {
  appPageTab,
  settleActiveTab,
  workflowAppPath,
  workflowNoticesOf,
  workflowTabsOf,
  workflowUiUrl,
} from "../src/lib/workflow-tabs";

const UI = "/api/projects/p/agents/a/workflows/demo/ui";
const tab = (key: string, file: string) => ({
  id: `demo.${key}`,
  key,
  title: key,
  renderer: { iframe: { src: `${UI}/${file}` } },
});

const info = (over: Partial<WorkflowInfo>): WorkflowInfo => ({
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

describe("workflow tabs", () => {
  it("shows one tab per contribution, keeping the workflow's load error", () => {
    const tabs = workflowTabsOf([
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

  it("serves the page of a machine's workflow through that machine, and says which", () => {
    // A Session on a machine runs a copy of the Agent there, and the workflows it built live in
    // that copy: the page is fetched through the machine's connection, and every later call
    // about the tab (reload, history, remove) has to go the same way.
    const [local] = workflowTabsOf([info({})]);
    expect(local).toMatchObject({ machineId: null, src: `${UI}/index.html` });
    const [remote] = workflowTabsOf([info({})], "m-1");
    expect(remote).toMatchObject({ machineId: "m-1", src: `/server/m-1${UI}/index.html` });
    expect(workflowAppPath("p", "a", "demo", "board", "m-1")).toBe(
      "/app/p/a/demo/board?machine=m-1",
    );
  });

  it("falls back to Chat when the active tab is gone", () => {
    const tabs = workflowTabsOf([info({})]);
    expect(settleActiveTab("demo/board", tabs)).toBe("demo/board");
    expect(settleActiveTab("demo/gone", tabs)).toBeNull();
    expect(settleActiveTab(null, tabs)).toBeNull();
  });

  it("keys the page URL on the UI revision so a changed UI reloads", () => {
    expect(workflowUiUrl({ src: `${UI}/index.html`, uiRev: "0123456789ab" })).toBe(
      `${UI}/index.html?rev=0123456789ab`,
    );
  });

  it("names a full page by workflow and, optionally, tab", () => {
    expect(workflowAppPath("p 1", "a", "demo")).toBe("/app/p%201/a/demo");
    expect(workflowAppPath("p 1", "a", "demo", "stats")).toBe("/app/p%201/a/demo/stats");
    const tabs = workflowTabsOf([
      info({ tabs: [tab("board", "index.html"), tab("stats", "stats.html")] }),
    ]);
    expect(appPageTab(tabs, "demo", undefined)?.key).toBe("board");
    expect(appPageTab(tabs, "demo", "stats")?.key).toBe("stats");
    expect(appPageTab(tabs, "demo", "nope")).toBeNull();
    expect(appPageTab(tabs, "gone", undefined)).toBeNull();
  });
});

describe("workflows with nothing to show", () => {
  it("surfaces a workflow that contributes no tab but has an error or a hint", () => {
    // A workflow whose FIRST load fails has no tabs at all, so without this the reader sees
    // nothing anywhere in the app — no tab, no mark, no message.
    const broken = info({ id: "broken", tabs: [], error: "index.ts(3,1): TS1005" });
    const hinted = info({ id: "hinted", tabs: [], hints: ["ui/index.html is shown by no tab"] });
    expect(workflowNoticesOf([broken, hinted, info({})])).toEqual([
      { workflowId: "broken", error: "index.ts(3,1): TS1005", hints: [] },
      { workflowId: "hinted", error: null, hints: ["ui/index.html is shown by no tab"] },
    ]);
  });

  it("says nothing about a workflow that is fine, or one whose tabs can carry its error", () => {
    expect(workflowNoticesOf([info({})])).toEqual([]);
    expect(workflowNoticesOf([info({ error: "broken" })])).toEqual([]);
    expect(workflowNoticesOf([info({ tabs: [] })])).toEqual([]);
  });
});
