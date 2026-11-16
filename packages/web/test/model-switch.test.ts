/**
 * In-conversation model switch (model-switch.ts): the picker's gate, what the switch will do to
 * the context (compact, continue, or — the current model unavailable — hand over by Trace path),
 * and the stale-row predicate that makes the Session row follow the running context's
 * `session_meta`. (The Web suite runs in a node environment and renders no React, so the pure
 * helpers are what get exercised.)
 */
import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@prismshadow/penguin-server/api";
import {
  sessionModelPickerDisabled,
  sessionRowStale,
  switchContextShape as shapeOf,
} from "../src/features/chat/model-switch";

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
  /** The configured models the picker offers: the current model A, with a key, and B. */
  const keyed = { credential: { apiKeyMasked: "sk-…" }, effective: { apiKeySource: "model" } };
  const listOf = (models: unknown[]) => ({ models: models as ModelInfo[], providers: {} });
  const configured = listOf([
    { ...A, ...keyed },
    { ...B, ...keyed },
  ]);
  const switchContextShape = (items: Parameters<typeof shapeOf>[0]) =>
    shapeOf(items, A, configured);
  const user = { kind: "user" };
  const done = { kind: "compaction", running: false, status: "completed" };
  const failed = { kind: "compaction", running: false, status: "fatal" };
  const running = { kind: "compaction", running: true };
  const marker = { kind: "model_change" };
  /** The connect row of a context whose opener had a server to connect again; its own `status` is not a compaction's. */
  const connect = { kind: "mcp_connect", running: false, status: "completed" };

  it("is empty for no items, and compacts when there is conversation since the last compaction", () => {
    expect(switchContextShape([])).toBe("empty");
    expect(switchContextShape([user])).toBe("compact");
    expect(switchContextShape([done, user])).toBe("compact");
  });

  it("continues from what the context opened with when the transcript ends in a completed compaction or a model switch — a failed retry after it changes nothing", () => {
    expect(switchContextShape([user, done])).toBe("compacted");
    expect(switchContextShape([user, done, failed])).toBe("compacted");
    expect(switchContextShape([user, done, marker])).toBe("compacted");
    expect(switchContextShape([done, marker])).toBe("compacted");
    // A switch away from a context that had not answered ran no compaction: the marker alone.
    expect(switchContextShape([user, marker])).toBe("compacted");
    expect(switchContextShape([user, marker, connect])).toBe("compacted");
    // Conversation since the switch is there to compact again.
    expect(switchContextShape([user, marker, user])).toBe("compact");
    // Neither does what the opened context connected behind the compaction…
    expect(switchContextShape([user, done, connect])).toBe("compacted");
    expect(switchContextShape([user, done, connect, marker])).toBe("compacted");
    // …which is no compaction of its own.
    expect(switchContextShape([user, connect])).toBe("compact");
  });

  it("still compacts when the trailing compaction did not complete: the old context is in effect", () => {
    expect(switchContextShape([user, failed])).toBe("compact");
    expect(switchContextShape([user, running])).toBe("compact");
  });

  it("hands over by Trace path when the current model is gone from the list or has no key, and only when there is something to compact", () => {
    const keyless = listOf([{ ...A, effective: { apiKeySource: "none" } }]);
    expect(shapeOf([user], A, listOf([{ ...B, ...keyed }]))).toBe("handover");
    expect(shapeOf([user], A, keyless)).toBe("handover");
    expect(shapeOf([], A, keyless)).toBe("empty");
    expect(shapeOf([user, done], A, keyless)).toBe("compacted");
    // While the list loads the server decides: the dialog promises the ordinary compaction.
    expect(shapeOf([user], A, undefined)).toBe("compact");
  });

  it("a model whose endpoint is called without a key is available though it has none: it compacts as usual", () => {
    const vllm = {
      provider: "vllm",
      modelId: "Qwen/Qwen3.8-27B",
      clientType: "openai-chat-vllm-adapter",
      credential: { baseUrl: "http://127.0.0.1:8000/v1" },
      effective: { apiKeySource: "none" },
    };
    expect(shapeOf([user], vllm, listOf([vllm]))).toBe("compact");
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
