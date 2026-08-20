/**
 * Unit tests for the Session title policy layer (the generation logic lives in
 * core `session.generateTitle`; a fake implementation is injected here):
 * the immediate user-input fallback (persisted synchronously, before the LLM
 * resolves), the LLM replacement, manual renames winning over both, retry while
 * the fallback is still standing, usage accounted as token usage, and silent
 * failure.
 * The Chinese conversation/title fixtures are intentional: a Session title must
 * follow the conversation language (zh chat → zh title), including the fallback
 * path that derives the title from the user input itself.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { OmniMessage, SessionTitleResult } from "@prismshadow/penguin-core";
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { TitleGenerator, fallbackTitle } from "../src/runtime/title-generator.js";
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
  lastActiveAt: "2026-07-07T00:00:00.000Z",
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

/** Fake session whose generateTitle blocks until release() — for asserting what happens while the LLM is still in flight. */
function gatedSession(result: SessionTitleResult, calls: { count: number; args: unknown[] }) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return {
    session: {
      generateTitle: async (args: unknown) => {
        calls.count += 1;
        calls.args.push(args);
        await gate;
        return result;
      },
    },
    release,
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

  it("persists the user-input fallback synchronously, then the LLM result replaces it; both push session_title; usage recorded", async () => {
    const events = captureChannel();
    const calls = { count: 0, args: [] as unknown[] };
    const { session, release } = gatedSession(
      {
        title: "Tailwind theme setup",
        usage: { cache_read: 1, cache_write: 2, output: 3, total: 6 },
      },
      calls,
    );
    const gen = makeGenerator();
    gen.maybeGenerate(CTX, session, { fallbackText: "explain @theme" });

    // The fallback is in place before the LLM has resolved — nothing waits on model output.
    expect(sessions.findById(ROW.sessionId)?.title).toBe("explain @theme");
    expect(
      serverEvents(events).some((e) => e.type === "session_title" && e.title === "explain @theme"),
    ).toBe(true);

    release();
    await waitFor(() => sessions.findById(ROW.sessionId)?.title === "Tailwind theme setup");
    // No material override passed: generateTitle is called with no argument, and the core Session gathers its own material.
    expect(calls.args[0]).toBeUndefined();
    expect(
      serverEvents(events).some(
        (e) => e.type === "session_title" && e.title === "Tailwind theme setup",
      ),
    ).toBe(true);
    // usage is converted into token_usage and handed to the recorder (metered normally, same as a real call).
    const usageMsg = recorded.find((m) => (m.payload as { type?: string }).type === "token_usage");
    expect((usageMsg?.payload as { request?: { total: number } }).request?.total).toBe(6);
  });

  it("material override is passed to generateTitle verbatim", async () => {
    const calls = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    const material = { userText: "sub-session prompt", assistantText: "" };
    gen.maybeGenerate(CTX, fakeSession({ title: "Sub title", usage: null }, calls), {
      fallbackText: "sub-session prompt",
      material,
    });
    await waitFor(() => sessions.findById(ROW.sessionId)?.title === "Sub title");
    expect(calls.args[0]).toEqual({ material });
  });

  it("an existing title from outside the generator is never touched (no one-shot request issued)", async () => {
    sessions.updateTitle(ROW.sessionId, "existing title");
    const calls = { count: 0, args: [] as unknown[] };
    makeGenerator().maybeGenerate(CTX, fakeSession({ title: "new title", usage: null }, calls), {
      fallbackText: "u",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.count).toBe(0);
    expect(sessions.findById(ROW.sessionId)?.title).toBe("existing title");
  });

  it("a manual rename during generation wins: the LLM result does not overwrite it", async () => {
    const calls = { count: 0, args: [] as unknown[] };
    const { session, release } = gatedSession(
      { title: "LLM title", usage: { cache_read: 0, cache_write: 0, output: 1, total: 1 } },
      calls,
    );
    const gen = makeGenerator();
    gen.maybeGenerate(CTX, session, { fallbackText: "first question" });
    expect(sessions.findById(ROW.sessionId)?.title).toBe("first question");
    // The user renames while the LLM request is still in flight.
    sessions.updateTitle(ROW.sessionId, "my custom name");
    release();
    // Usage recording happens before the title decision, so it marks the request as settled.
    await waitFor(() => recorded.length > 0);
    await new Promise((r) => setTimeout(r, 20));
    expect(sessions.findById(ROW.sessionId)?.title).toBe("my custom name");
  });

  it("while the fallback is still standing, the next trigger retries the LLM and replaces it", async () => {
    const failing = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    gen.maybeGenerate(CTX, fakeSession({ title: null, usage: null }, failing), {
      fallbackText: "Configure the Tailwind theme",
    });
    await waitFor(() => failing.count === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(sessions.findById(ROW.sessionId)?.title).toBe("Configure the Tailwind theme");

    // Second Task start: the stored title still equals the fallback, so the LLM runs again.
    const succeeding = { count: 0, args: [] as unknown[] };
    gen.maybeGenerate(CTX, fakeSession({ title: "Theme setup", usage: null }, succeeding), {
      fallbackText: "Configure the Tailwind theme",
    });
    await waitFor(() => sessions.findById(ROW.sessionId)?.title === "Theme setup");
    expect(succeeding.count).toBe(1);

    // After the LLM title lands, further triggers are no-ops.
    const after = { count: 0, args: [] as unknown[] };
    gen.maybeGenerate(CTX, fakeSession({ title: "unused", usage: null }, after), {
      fallbackText: "Configure the Tailwind theme",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(after.count).toBe(0);
    expect(sessions.findById(ROW.sessionId)?.title).toBe("Theme setup");
  });

  it("when the LLM returns null (failed request / empty result), the fallback stands; usage still recorded", async () => {
    const calls = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    gen.maybeGenerate(
      CTX,
      fakeSession(
        { title: null, usage: { cache_read: 0, cache_write: 0, output: 1, total: 1 } },
        calls,
      ),
      { fallbackText: "Configure the Tailwind theme\nsecond line" },
    );
    // Fallback = the input's first non-empty line, truncated and sanitized — written up front.
    expect(sessions.findById(ROW.sessionId)?.title).toBe("Configure the Tailwind theme");
    // The one-off request's usage is still recorded normally.
    await waitFor(() => recorded.length > 0);
    expect(sessions.findById(ROW.sessionId)?.title).toBe("Configure the Tailwind theme");
  });

  it("fallback strips a leading [use_skills] block so the marker never becomes the title", () => {
    const calls = { count: 0, args: [] as unknown[] };
    makeGenerator().maybeGenerate(CTX, fakeSession({ title: null, usage: null }, calls), {
      fallbackText: "[use_skills]\nskills: web-design\n[/use_skills]\nBuild a landing page",
    });
    // Not "[use_skills]" — the marker block is removed before the first line is taken.
    expect(sessions.findById(ROW.sessionId)?.title).toBe("Build a landing page");
  });

  it("fallback also strips the legacy angle-bracket <use_skills> block (material from old Traces)", () => {
    const calls = { count: 0, args: [] as unknown[] };
    makeGenerator().maybeGenerate(CTX, fakeSession({ title: null, usage: null }, calls), {
      fallbackText: "<use_skills>\nskills: web-design\n</use_skills>\nBuild a landing page",
    });
    expect(sessions.findById(ROW.sessionId)?.title).toBe("Build a landing page");
  });

  it("LLM returns null and the fallback material is blank → the title stays NULL (retryable next time)", async () => {
    const calls = { count: 0, args: [] as unknown[] };
    const gen = makeGenerator();
    gen.maybeGenerate(CTX, fakeSession({ title: null, usage: null }, calls), {
      fallbackText: "   ",
    });
    await waitFor(() => calls.count >= 1);
    expect(sessions.findById(ROW.sessionId)?.title).toBeNull();
  });

  it("fallback material is pure punctuation → falls back to the truncated original text (never NULL)", () => {
    const calls = { count: 0, args: [] as unknown[] };
    // sanitizeTitle strips "？？？" down to empty — the fallback must revert to the truncated original text so a title is still produced.
    makeGenerator().maybeGenerate(CTX, fakeSession({ title: null, usage: null }, calls), {
      fallbackText: "？？？",
    });
    expect(sessions.findById(ROW.sessionId)?.title).toBe("？？？");
  });

  describe("fallbackTitle truncation", () => {
    it("keeps short input as-is", () => {
      expect(fallbackTitle("fix bug")).toBe("fix bug");
    });

    it("cuts long English input at a word boundary", () => {
      expect(fallbackTitle("Please fix the database connection timeout problem")).toBe(
        "Please fix the database",
      );
    });

    it("cuts long CJK input at the character cap (every character is a word)", () => {
      const long = "帮我修复数据库连接超时的问题然后写一个测试用例覆盖它再检查一下配置文件";
      expect(fallbackTitle(long)).toBe(long.slice(0, 30));
    });

    it("hard-cuts a single overlong word (no space to back up to)", () => {
      expect(fallbackTitle("a".repeat(40))).toBe("a".repeat(30));
    });

    it("spends the length budget on words, not leading punctuation", () => {
      expect(fallbackTitle("！！！Please fix the database connection timeout")).toBe(
        "Please fix the database",
      );
    });
  });
});
