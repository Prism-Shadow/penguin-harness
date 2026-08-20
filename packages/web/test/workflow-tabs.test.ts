import { describe, expect, it } from "vitest";
import { retainedTab, workflowTabsFromResponse, workflowUiUrl } from "../src/lib/workflow-tabs";

const tab = {
  id: "agent/with-ui",
  projectId: "proj",
  agentId: "agent",
  workflowId: "with-ui",
  name: "Dashboard",
  uiRev: "abc123",
};

describe("workflow tabs", () => {
  it("includes only workflows with UI summaries while Chat remains independent", () => {
    expect(
      workflowTabsFromResponse({
        workflows: [tab, { id: "script-only", name: "Worker", uiRev: null }],
      }),
    ).toEqual([tab]);
    expect(retainedTab("chat", [])).toBe("chat");
  });

  it("drops a row missing any field the tab strip needs", () => {
    for (const field of ["id", "projectId", "agentId", "workflowId", "name", "uiRev"] as const) {
      const { [field]: _dropped, ...rest } = tab;
      expect(workflowTabsFromResponse({ workflows: [rest] })).toEqual([]);
    }
    expect(workflowTabsFromResponse({ workflows: [{ ...tab, uiRev: "" }] })).toEqual([]);
    expect(workflowTabsFromResponse({})).toEqual([]);
    expect(workflowTabsFromResponse(null)).toEqual([]);
  });

  it("falls back to Chat when the active workflow disappears", () => {
    const workflows = [{ ...tab, id: "remaining", workflowId: "remaining" }];
    expect(retainedTab("removed", workflows)).toBe("chat");
    expect(retainedTab("remaining", workflows)).toBe("remaining");
  });

  it("builds the UI url the server serves the workflow's own files from", () => {
    expect(workflowUiUrl(tab)).toBe("/api/workflows/proj/agent/with-ui/ui/");
    expect(workflowUiUrl(tab, "index.html")).toBe(
      "/api/workflows/proj/agent/with-ui/ui/index.html",
    );
    expect(workflowUiUrl({ ...tab, workflowId: "a b" }, "x.js")).toBe(
      "/api/workflows/proj/agent/a%20b/ui/x.js",
    );
  });
});
