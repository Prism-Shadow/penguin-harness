/**
 * Draft cache parsing/validation and storage access (the auto-cache
 * foundation for draft-view):
 * - parseDraft validates field by field — localStorage may be corrupted by
 *   external code, so bad JSON / non-object / invalid fields are always
 *   discarded instead of crashing the page;
 * - load/save/clear are isolated by "user x Project/Session" (#68: switching
 *   accounts in the same browser must not leak drafts across users); storage
 *   errors (quota/private mode) are swallowed silently.
 */
import { describe, expect, it } from "vitest";
import {
  clearDraft,
  draftKey,
  loadDraft,
  parseDraft,
  saveDraft,
  sessionDraftKey,
} from "../src/features/chat/draft-cache";
import type { DraftStorage } from "../src/features/chat/draft-cache";

/** In-memory storage (vitest runs in a Node environment, no localStorage). */
function memStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("parseDraft（逐字段校验）", () => {
  it("null / 空串 / 坏 JSON / 非对象一律给空草稿", () => {
    expect(parseDraft(null)).toEqual({});
    expect(parseDraft("")).toEqual({});
    expect(parseDraft("{not json")).toEqual({});
    expect(parseDraft("42")).toEqual({});
    expect(parseDraft('"str"')).toEqual({});
    expect(parseDraft("null")).toEqual({});
    expect(parseDraft("[1,2]")).toEqual({});
  });

  it("合法字段逐项透传（模型为成对引用）", () => {
    const raw = JSON.stringify({
      text: "帮我写个脚本",
      agentId: "default_agent",
      workspace: "/srv/repo",
      approvalMode: "read-only",
      modelRef: { provider: "anthropic", modelId: "claude-opus-4-8" },
      handoffAgentId: "agent_helper",
      skills: ["agent-creation", "penguin-sdk"],
    });
    expect(parseDraft(raw)).toEqual({
      text: "帮我写个脚本",
      agentId: "default_agent",
      workspace: "/srv/repo",
      approvalMode: "read-only",
      modelRef: { provider: "anthropic", modelId: "claude-opus-4-8" },
      handoffAgentId: "agent_helper",
      skills: ["agent-creation", "penguin-sdk"],
    });
  });

  it("类型不对的字段丢弃，其余保留", () => {
    const raw = JSON.stringify({
      text: 123,
      agentId: null,
      workspace: { path: "/x" },
      approvalMode: "read-only",
      modelRef: ["m"],
      handoffAgentId: 7,
    });
    expect(parseDraft(raw)).toEqual({ approvalMode: "read-only" });
  });

  it("旧格式的字符串 modelId 与半个引用一律丢弃（未发布，不做迁移）", () => {
    expect(parseDraft(JSON.stringify({ modelId: "claude-opus-4-8" }))).toEqual({});
    expect(parseDraft(JSON.stringify({ modelRef: { modelId: "claude-opus-4-8" } }))).toEqual({});
    expect(parseDraft(JSON.stringify({ modelRef: { provider: "anthropic" } }))).toEqual({});
  });

  it("approvalMode 只收四个合法值", () => {
    expect(parseDraft(JSON.stringify({ approvalMode: "yolo" }))).toEqual({});
    for (const m of ["always-ask", "read-only", "allow-all", "deny-all"]) {
      expect(parseDraft(JSON.stringify({ approvalMode: m }))).toEqual({ approvalMode: m });
    }
  });

  it("未知字段不透传", () => {
    const out = parseDraft(JSON.stringify({ text: "hi", evil: "x" }));
    expect(out).toEqual({ text: "hi" });
  });

  it("skills：非数组丢弃，数组内非字符串元素过滤，过滤后为空整个字段丢弃", () => {
    // Non-arrays are always discarded
    expect(parseDraft(JSON.stringify({ skills: "agent-creation" }))).toEqual({});
    expect(parseDraft(JSON.stringify({ skills: { 0: "x" } }))).toEqual({});
    expect(parseDraft(JSON.stringify({ skills: 42 }))).toEqual({});
    // Validate each element individually: strings are kept, everything else is filtered out
    expect(parseDraft(JSON.stringify({ skills: ["a", 1, null, {}, "b", false] }))).toEqual({
      skills: ["a", "b"],
    });
    // Empty array / empty after filtering -> the whole field is dropped
    expect(parseDraft(JSON.stringify({ skills: [] }))).toEqual({});
    expect(parseDraft(JSON.stringify({ skills: [7, null] }))).toEqual({});
  });
});

describe("load / save / clear（按键隔离，异常静默）", () => {
  it("保存后可等值读回；Project 草稿与 Session 草稿互不影响", () => {
    const s = memStorage();
    saveDraft(
      draftKey("user-a1", "project-a"),
      {
        text: "草稿 A",
        modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        skills: ["agent-creation"],
      },
      s,
    );
    saveDraft(sessionDraftKey("user-a1", "session-1"), { text: "会话草稿" }, s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({
      text: "草稿 A",
      modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      skills: ["agent-creation"],
    });
    expect(loadDraft(sessionDraftKey("user-a1", "session-1"), s)).toEqual({ text: "会话草稿" });
    // Lock down the key format (e2e accesses it as a literal; ids are all
    // <prefix>-<hex> with no ".", so the key space never collides).
    expect(draftKey("user-a1", "project-a")).toBe("penguin.chatDraft.user-a1.project-a");
    expect(sessionDraftKey("user-a1", "session-1")).toBe(
      "penguin.chatDraft.session.user-a1.session-1",
    );
    expect(s.map.size).toBe(2);
  });

  it("同一 Project/Session 的草稿按用户隔离：互相读不到、写不覆盖（#68）", () => {
    const s = memStorage();
    saveDraft(draftKey("user-a1", "project-a"), { text: "A 的机密草稿" }, s);
    saveDraft(sessionDraftKey("user-a1", "session-1"), { text: "A 的会话草稿" }, s);
    // Switch accounts (same browser): B reading the same Project/Session only gets an empty draft.
    expect(loadDraft(draftKey("user-b2", "project-a"), s)).toEqual({});
    expect(loadDraft(sessionDraftKey("user-b2", "session-1"), s)).toEqual({});
    // B saves its own draft: coexists with A's, neither overwrites the other.
    saveDraft(draftKey("user-b2", "project-a"), { text: "B 的草稿" }, s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({ text: "A 的机密草稿" });
    expect(loadDraft(draftKey("user-b2", "project-a"), s)).toEqual({ text: "B 的草稿" });
  });

  it("clear 后读回空草稿", () => {
    const s = memStorage();
    saveDraft(draftKey("user-a1", "project-a"), { text: "要清掉" }, s);
    clearDraft(draftKey("user-a1", "project-a"), s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({});
    expect(s.map.size).toBe(0);
  });

  it("storage 抛异常（配额/隐私模式）：save 不抛、load 给空草稿", () => {
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => saveDraft(draftKey("u", "p"), { text: "x" }, broken)).not.toThrow();
    expect(() => clearDraft(draftKey("u", "p"), broken)).not.toThrow();
    expect(loadDraft(draftKey("u", "p"), broken)).toEqual({});
  });
});
