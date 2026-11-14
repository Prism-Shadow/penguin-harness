/**
 * A title finishing during an unmetered main/child request must
 * remain separately billed and must not suppress the request's later failure row.
 * Uses real title policy, usage recorder and SQLite; only the model result is gated.
 */
import { expect, it } from "vitest";
import { requestBegin, requestEnd, withOrigin } from "@prismshadow/penguin-core";
import type { SessionTitleResult } from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import { openDatabase } from "../src/db/database.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import { UsageRepo } from "../src/db/repos/usage.js";
import { ChannelHub } from "../src/runtime/channel.js";
import { TitleGenerator } from "../src/runtime/title-generator.js";
import { UsageRecorder } from "../src/runtime/usage-recorder.js";

it.each(["main", "child"])(
  "keeps the failed %s request when its title finishes first",
  async (kind) => {
    const db = openDatabase(":memory:");
    const channels = new ChannelHub();
    const ctx = {
      projectId: "p",
      agentId: "a",
      sessionId: "main",
      provider: "custom",
      modelId: "model",
    };
    const titleCtx = { ...ctx, sessionId: kind === "child" ? "child" : "main" };
    const sessions = wire(SessionsRepo, { db });
    sessions.insert({
      ...titleCtx,
      workspace: "/tmp/workspace",
      approvalMode: "always-ask",
      title: null,
      createdAt: "2026-10-26T00:00:00Z",
      lastActiveAt: "2026-10-26T00:00:00Z",
    });
    const usage = wire(UsageRepo, { db });
    const recorder = wire(UsageRecorder, { usage, clock: { now: () => new Date() } });
    let finishModel!: (result: SessionTitleResult) => void;
    const model = new Promise<SessionTitleResult>((resolve) => (finishModel = resolve));
    let titleFinished!: () => void;
    const finished = new Promise<void>((resolve) => (titleFinished = resolve));
    channels.get(titleCtx.sessionId).subscribe((event) => {
      if (event.event === "server_event" && JSON.parse(event.data).title === "Generated title")
        titleFinished();
    });
    const titles = new TitleGenerator({ sessions, channels, recorder });
    const origin = (msg: ReturnType<typeof requestBegin> | ReturnType<typeof requestEnd>) =>
      kind === "child" ? withOrigin(msg, "child") : msg;
    try {
      titles.maybeGenerate(
        titleCtx,
        { generateTitle: () => model },
        { fallbackText: "Explain this function" },
      );
      await recorder.record(ctx, origin(requestBegin()));
      finishModel({
        title: "Generated title",
        usage: { cache_read: 0, cache_write: 0, output: 6, total: 6 },
      });
      await finished;
      await recorder.record(ctx, origin(requestEnd("retryable", { errorCode: "network" })));
      expect(db.prepare("SELECT status, total FROM usage_records ORDER BY rowid").all()).toEqual([
        { status: "completed", total: 6 },
        { status: "retryable", total: 0 },
      ]);
    } finally {
      channels.dispose();
      db.close();
    }
  },
);
