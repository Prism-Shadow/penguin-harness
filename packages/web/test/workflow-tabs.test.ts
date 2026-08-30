import { describe, expect, it } from "vitest";
import type { WorkflowInfo } from "@prismshadow/penguin-server/api";
import { settleActiveTab, workflowTabsOf, workflowUiUrl } from "../src/lib/workflow-tabs";

const info = (over: Partial<WorkflowInfo>): WorkflowInfo => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: "0123456789ab",
  loadedAt: "2026-08-30T00:00:00Z",
  error: null,
  ...over,
});

describe("workflow tabs", () => {
  it("shows only workflows that ship a UI, keeping their load error", () => {
    const tabs = workflowTabsOf([
      info({}),
      info({ id: "headless", uiRev: null }),
      info({ id: "broken", error: "module tree rejected" }),
    ]);
    expect(tabs.map((t) => t.workflowId)).toEqual(["demo", "broken"]);
    expect(tabs[1]!.error).toBe("module tree rejected");
  });

  it("falls back to Chat when the active workflow is gone", () => {
    const tabs = workflowTabsOf([info({})]);
    expect(settleActiveTab("demo", tabs)).toBe("demo");
    expect(settleActiveTab("gone", tabs)).toBeNull();
    expect(settleActiveTab(null, tabs)).toBeNull();
  });

  it("keys the page URL on the UI revision so a changed UI reloads", () => {
    expect(workflowUiUrl("p 1", "a", { workflowId: "demo", uiRev: "0123456789ab" })).toBe(
      "/api/projects/p%201/agents/a/workflows/demo/ui/?rev=0123456789ab",
    );
  });
});
