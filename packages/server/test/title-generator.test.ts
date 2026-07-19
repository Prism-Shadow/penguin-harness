/**
 * Unit tests for the Session title policy layer (the generation logic lives in
 * core `session.generateTitle`; a fake implementation is injected here):
 * persisting + event push + usage accounted as token usage, idempotency (no
 * regeneration when a title already exists / generation is in flight), and
 * silent failure.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { OmniMessage, SessionTitleResult } from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { TitleGenerator } from "../src/runtime/title-generator.js";
import type { UsageContext } from "../src/runtime/usage-recorder.js";
import { waitFor } from "./helpers.js";

const ROW: SessionRow = {
  sessionId: "session-t1",
  projectId: "p1",
  agentId: "a1",
  modelId: "m1",
  provider: "custom",
  workspace: "/tmp/w",
  approvalMode: "always-ask",
  title: null,
  createdAt: "2026-07-07T00:00:00.000Z",
};

const CTX: UsageContext = {
  projectId: "p1",
  agentId: "a1",
  sessionId: "session-t1",
  modelId: "m1",
  provider: "custom",
};

/** Fake session: generateTitle returns the given result and records the call count/arguments. */
function fakeSession(result: SessionTitleResult, calls: { count: number; args: unknown[] }) {
  return {
    generateTitle: async (args: unknown) => {
      calls.count += 1;
      calls.args.push(args);
      return result;
    },
  };
}

describe("title-generator", () => {
  let db: DatabaseSync;
  let sessions: SessionsRepo;
  let channels: ChannelHub;
  let recorded: OmniMessage[];

  const makeGenerator = (): TitleGenerator =>
    new TitleGenerator({
      sessions,
      channels,
      recorder: {
        record: async (_ctx, msg) => {
          recorded.push(msg);
        },
      },
      log: () => {},
    });

  const captureChannel = (): ChannelEvent[] => {
    const events: ChannelEvent[] = [];
    channels.get(ROW.sessionId).subscribe((e) => events.push(e));
    return events;
  };

  const serverEvents = (events: ChannelEvent[]): { type: string; [k: string]: unknown }[] =>
    events
      .filter((e) => e.event === "server_event")
      .map((e) => JSON.parse(e.data) as { type: string });

  beforeEach(() => {
    db = openDatabase(":memory:");
    sessions = new SessionsRepo(db);
    sessions.insert(ROW);
    channels = new ChannelHub();
    recorded = [];
  });
  afterEach(() => {
    channels.dispose();
    db.close();
  });

  it("生成标题：落库 + 推送 session_title + 用量折算入账；素材缺省由 Session 自采", async () => {
    const events = captureChannel();
    const calls = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    gen.maybeGenerate(
      CTX,
      fakeSession(
        {
          title: "Tailwind 主题配置",
          usage: { cache_read: 1, cache_write: 2, output: 3, total: 6 },
        },
        calls,
      ),
      { fallbackText: "解释一下 @theme" },
    );
    await waitFor(() => sessions.findById(ROW.sessionId)?.title !== null);

    expect(sessions.findById(ROW.sessionId)?.title).toBe("Tailwind 主题配置");
    // No material override passed: generateTitle is called with no argument, and the core Session gathers its own material.
    expect(calls.args[0]).toBeUndefined();
    expect(
      serverEvents(events).some(
        (e) => e.type === "session_title" && e.title === "Tailwind 主题配置",
      ),
    ).toBe(true);
    // usage is converted into token_usage and handed to the recorder (metered normally, same as a real call).
    const usageMsg = recorded.find((m) => (m.payload as { type?: string }).type === "token_usage");
    expect((usageMsg?.payload as { request?: { total: number } }).request?.total).toBe(6);
  });

  it("素材覆盖（子会话场景）原样传给 generateTitle", async () => {
    const calls = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    const material = { userText: "子会话 prompt", assistantText: "子会话回答" };
    gen.maybeGenerate(CTX, fakeSession({ title: "子标题", usage: null }, calls), {
      fallbackText: "子会话 prompt",
      material,
    });
    await waitFor(() => sessions.findById(ROW.sessionId)?.title !== null);
    expect(calls.args[0]).toEqual({ material });
    expect(sessions.findById(ROW.sessionId)?.title).toBe("子标题");
  });

  it("已有标题不再生成（不发起单发请求）", async () => {
    sessions.updateTitle(ROW.sessionId, "已有标题");
    const calls = { count: 0, args: [] as unknown[] };
    makeGenerator().maybeGenerate(CTX, fakeSession({ title: "新标题", usage: null }, calls), {
      fallbackText: "u",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.count).toBe(0);
    expect(sessions.findById(ROW.sessionId)?.title).toBe("已有标题");
  });

  it("LLM 返回 null（请求失败/空结果）时用兜底素材首行落库；usage 仍入账", async () => {
    const calls = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    gen.maybeGenerate(
      CTX,
      fakeSession(
        { title: null, usage: { cache_read: 0, cache_write: 0, output: 1, total: 1 } },
        calls,
      ),
      { fallbackText: "配置 Tailwind 主题\n第二行" },
    );
    // Fallback = the material's first non-empty line, sanitized and truncated, guaranteeing a title is always produced.
    await waitFor(() => sessions.findById(ROW.sessionId)?.title !== null);
    expect(sessions.findById(ROW.sessionId)?.title).toBe("配置 Tailwind 主题");
    // The one-off request's usage is still recorded normally.
    await waitFor(() => recorded.length > 0);
  });

  it("LLM 返回 null 且兜底素材为空 → 标题保持 NULL（下次可重试）", async () => {
    const calls = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    gen.maybeGenerate(CTX, fakeSession({ title: null, usage: null }, calls), {
      fallbackText: "   ",
    });
    await waitFor(() => calls.count >= 1);
    expect(sessions.findById(ROW.sessionId)?.title).toBeNull();
  });

  it("LLM 返回 null 且兜底素材为纯标点 → 兜底退回截断原文（不落 NULL）", async () => {
    const calls = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    // sanitizeTitle strips "？？？" down to empty — the fallback must revert to the truncated original text so a title is still produced.
    gen.maybeGenerate(CTX, fakeSession({ title: null, usage: null }, calls), {
      fallbackText: "？？？",
    });
    await waitFor(() => sessions.findById(ROW.sessionId)?.title !== null);
    expect(sessions.findById(ROW.sessionId)?.title).toBe("？？？");
  });
});
