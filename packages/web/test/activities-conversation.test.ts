import { describe, expect, it } from "vitest";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import {
  conversationThreads,
  focusFor,
  focusLabel,
  followUpText,
  latestConversation,
  sameFocus,
  splitStudioBrief,
  threadTime,
} from "../src/features/activities/conversation";
import { runTitle } from "../src/features/activities/sessions-panel";
import { STUDIO_PANELS, readSidePanel } from "../src/features/activities/workspace-model";

const run = (
  runId: string,
  kind: ActivityRunSummary["kind"],
  createdAt: string,
  sessionId: string | null,
) => ({ runId, kind, createdAt, sessionId, status: "succeeded" }) as ActivityRunSummary;

describe("conversation panel", () => {
  it("resumes the newest conversation that has a session, and nothing else", () => {
    expect(latestConversation([])).toBeNull();
    const runs = [
      run("spec", "spec", "2026-09-23T10:00:00Z", "s-spec"),
      run("old", "assist", "2026-09-20T10:00:00Z", "s-old"),
      run("new", "assist", "2026-09-22T10:00:00Z", "s-new"),
      run("unstarted", "assist", "2026-09-23T11:00:00Z", null),
    ];
    expect(latestConversation(runs)!.runId).toBe("new");
  });

  it("lists every conversation with a session, newest first, as threads", () => {
    const runs = [
      run("spec", "spec", "2026-09-23T10:00:00Z", "s-spec"),
      run("old", "assist", "2026-09-20T10:00:00Z", "s-old"),
      run("new", "assist", "2026-09-22T10:00:00Z", "s-new"),
      run("unstarted", "assist", "2026-09-23T11:00:00Z", null),
    ];
    expect(conversationThreads(runs).map((thread) => thread.runId)).toEqual(["new", "old"]);
    expect(conversationThreads([])).toEqual([]);
  });

  it("focuses an asset only while the scenes section shows it", () => {
    const selection = { sceneId: "intro", key: "cat" };
    expect(focusFor("scenes", selection, "en-US")).toEqual({
      section: "scenes",
      sceneId: "intro",
      assetKey: "cat",
      language: "en-US",
    });
    expect(focusFor("description", selection, "en-US")).toEqual({ section: "description" });
    expect(focusFor("scenes", null, "en-US")).toEqual({ section: "scenes" });
    // An asset in no scene has no scene to name.
    expect(focusFor("scenes", { sceneId: "", key: "lost" }, "en-US")).toEqual({
      section: "scenes",
      assetKey: "lost",
      language: "en-US",
    });
  });

  it("names the focus the way the tree does", () => {
    expect(focusLabel(null)).toBe("the whole activity");
    expect(focusLabel({ section: "scenes", sceneId: "intro", assetKey: "cat" })).toBe(
      "cat in intro",
    );
    expect(focusLabel({ section: "scenes", assetKey: "lost" })).toBe("lost");
    expect(focusLabel({ section: "specification" })).toBe("Activity Spec");
  });

  it("repeats where the author is only after they have moved", () => {
    const cat = { section: "scenes" as const, sceneId: "intro", assetKey: "cat" };
    expect(sameFocus(cat, { ...cat })).toBe(true);
    expect(followUpText("Shorter?", cat, { ...cat })).toBe("Shorter?");
    expect(followUpText("And this?", { section: "description" }, cat)).toBe(
      "And this?\n\n(I am now looking at Activity Script.)",
    );
    // A resumed conversation has no remembered focus, so the first follow-up says it.
    expect(followUpText("Hi", cat, null)).toContain("cat in intro");
  });

  it("titles a conversation run and remembers the panel", () => {
    expect(runTitle("assist")).toBe("Conversation");
    expect(runTitle("assessment")).toBe("Assessment");
    expect(STUDIO_PANELS).toContain("conversation");
    expect(readSidePanel({ getItem: () => "conversation" })).toBe("conversation");
  });
});

describe("the studio brief", () => {
  it("folds the context the server appends to the first message", () => {
    const text = [
      "What is this activity about?",
      "",
      "---",
      "Context from the activity studio: the author is looking at the activity script.",
      "Read them.",
    ].join("\n");
    expect(splitStudioBrief(text)).toEqual({
      body: "What is this activity about?",
      context:
        "Context from the activity studio: the author is looking at the activity script.\nRead them.",
    });
  });

  it("leaves a rule the author typed alone", () => {
    expect(splitStudioBrief("Part one\n\n---\nPart two")).toBeNull();
    expect(splitStudioBrief("Just a question")).toBeNull();
  });
});

describe("thread times", () => {
  const now = new Date(2026, 9, 9, 18, 0);

  it("says Today for a conversation started today, to the minute", () => {
    const label = threadTime(new Date(2026, 9, 9, 9, 12, 45).toISOString(), now);
    expect(label.startsWith("Today ")).toBe(true);
    expect(label).not.toMatch(/45/);
  });

  it("gives the date for an older conversation", () => {
    expect(threadTime(new Date(2026, 9, 8, 23, 58).toISOString(), now).startsWith("Today")).toBe(
      false,
    );
  });
});
