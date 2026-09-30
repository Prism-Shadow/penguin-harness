/**
 * In-conversation model switch (model-switch.ts): the picker's gate, what the switch will do to
 * the context, the stale-row predicate that makes the Session row follow the running context's
 * `session_meta`, and the copy of the `/model` handoff, the confirm dialog and the model-change
 * marker in both locales. (The Web suite runs in a node environment and renders no React, so
 * the pure helpers are what get exercised.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  sessionModelPickerDisabled,
  sessionRowStale,
  switchContextShape,
} from "../src/features/chat/model-switch";

// S is a live binding shared across the suite: always hand it back the default.
afterEach(() => setActiveStrings(zh));

const A = { provider: "anthropic", modelId: "a-1" };
const B = { provider: "openai", modelId: "b-2" };

describe("sessionModelPickerDisabled", () => {
  it("disables the picker exactly while a compaction could not start", () => {
    expect(sessionModelPickerDisabled("running")).toBe(true);
    expect(sessionModelPickerDisabled("compacting")).toBe(true);
    expect(sessionModelPickerDisabled("idle")).toBe(false);
  });
});

describe("switchContextShape", () => {
  const user = { kind: "user" };
  const done = { kind: "compaction", running: false, status: "completed" };
  const failed = { kind: "compaction", running: false, status: "fatal" };
  const running = { kind: "compaction", running: true };
  const marker = { kind: "model_change" };

  it("is empty for no items, and compacts when there is conversation since the last compaction", () => {
    expect(switchContextShape([])).toBe("empty");
    expect(switchContextShape([user])).toBe("compact");
    expect(switchContextShape([done, user])).toBe("compact");
  });

  it("continues from the held summary when the transcript ends in a completed compaction — a failed retry or a model-change marker after it changes nothing", () => {
    expect(switchContextShape([user, done])).toBe("compacted");
    expect(switchContextShape([user, done, failed])).toBe("compacted");
    expect(switchContextShape([user, done, marker])).toBe("compacted");
    expect(switchContextShape([done, marker])).toBe("compacted");
  });

  it("still compacts when the trailing compaction did not complete: the old context is in effect", () => {
    expect(switchContextShape([user, failed])).toBe("compact");
    expect(switchContextShape([user, running])).toBe("compact");
  });
});

describe("sessionRowStale", () => {
  /** A Session row, or a running context's model as its session_meta names it: both are a model under a Session id. */
  const on = (model: { provider: string; modelId: string }, sessionId = "session-1") => ({
    sessionId,
    ...model,
  });

  it("is never stale before a session_meta was seen, or without a row", () => {
    expect(sessionRowStale(null, on(A))).toBe(false);
    expect(sessionRowStale(null, null)).toBe(false);
    expect(sessionRowStale(on(B), null)).toBe(false);
  });

  it("is not stale while the row names the running context's model", () => {
    expect(sessionRowStale(on(A), on(A))).toBe(false);
  });

  it("is stale when the running context's model differs from the row's, by either half", () => {
    expect(sessionRowStale(on(B), on(A))).toBe(true);
    expect(sessionRowStale(on({ provider: A.provider, modelId: "a-2" }), on(A))).toBe(true);
    expect(sessionRowStale(on({ provider: "other", modelId: A.modelId }), on(A))).toBe(true);
  });

  it("says nothing about another Session's row: the stream of the conversation the page just left", () => {
    expect(sessionRowStale(on(B, "session-1"), on(A, "session-2"))).toBe(false);
  });
});

describe("/model copy", () => {
  it("says in both locales that /model opens a new conversation", () => {
    expect(zh.chat.switchModel).toContain("新会话");
    expect(zh.chat.switchModel).toContain("本会话保持不变");
    expect(zh.chat.switchModelTitle).toContain("新会话");
    expect(zh.chat.modelSwitchTargetTitle("b-2")).toContain("新开");
    expect(en.chat.switchModel).toMatch(/new session/);
    expect(en.chat.switchModelTitle).toMatch(/New conversation/);
    expect(en.chat.modelSwitchTargetTitle("b-2")).toMatch(/new conversation on b-2/);
  });

  it("the confirm dialog uses the design's zh body and a two-choice label", () => {
    expect(zh.chat.modelSwitchInSessionBody("A", "B")).toBe(
      "将先用当前模型「A」压缩上下文，成功后以「B」继续本对话；压缩失败则保持「A」。",
    );
    expect(zh.chat.modelSwitchInSessionConfirm).toBe("压缩并切换");
    expect(zh.chat.modelSwitchInSessionDirectBody("B")).toContain("直接切换到「B」");
    expect(en.chat.modelSwitchInSessionBody("A", "B")).toContain('"B"');
  });

  it("right after a compaction, neither the dialog nor the toast promises a compaction", () => {
    // The server runs no compaction for a just-compacted Session (design: no second pair), so
    // the copy for that shape must not say "compact".
    expect(zh.chat.modelSwitchInSessionCompactedBody("B")).toContain("不会再次压缩");
    expect(zh.chat.modelSwitchInSessionCompactedBody("B")).toContain("「B」");
    expect(en.chat.modelSwitchInSessionCompactedBody("B")).toMatch(/nothing is compacted again/);
    expect(en.chat.modelSwitchInSessionCompactedBody("B")).toContain('"B"');
    expect(zh.chat.modelSwitchInSessionSwitching("B")).toBe("正在切换到「B」。");
    expect(en.chat.modelSwitchInSessionSwitching("B")).not.toMatch(/compact/i);
    expect(zh.chat.modelSwitchInSessionDirectConfirm).toBe("切换");
    expect(en.chat.modelSwitchInSessionDirectConfirm).toBe("Switch");
    // The compacting toast is the one that may say so.
    expect(en.chat.modelSwitchInSessionStarted("A", "B")).toMatch(/Compacting/);
  });

  it("the model-change marker names both model ids in both locales", () => {
    expect(zh.chat.modelChanged("a-1", "b-2")).toBe("模型已切换 · a-1 → b-2");
    expect(en.chat.modelChanged("a-1", "b-2")).toBe("Model switched · a-1 → b-2");
  });
});
