/**
 * A running Task's held inputs on the machine leg (services/history-lines.ts): the window's
 * envelope offers only the held inputs its records do not already hold, judged on the records
 * as the Trace has them — before a stub serves an image by reference, after which the hub could
 * no longer tell the stubbed image from its held inline copy and would show it twice.
 *
 * - Given a running Task whose prompt and large image are already in the Trace, and a third
 *   input not yet written, the window's envelope holds only the third; the image rides the
 *   window as a stub served by reference.
 *
 * The Session runtime is the boundary faked here (what a running Task holds); the Traces are
 * real files read by the real trace service.
 */
import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  assistantText,
  imageUrlMessage,
  requestBegin,
  requestEnd,
  sessionMeta,
  userText,
} from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { HistoryLinesWindow } from "../src/api/types.js";
import type { AppEnv } from "../src/auth/middleware.js";
import { historyLinesRoutes } from "../src/http/routes/history-lines.js";
import { sessionRow } from "./fixtures/session.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-h";
const A = "agent-h";
const S = "session-2026-07-22-10-00-00-aabb0201";

describe("a running Task's held inputs on the machine leg", () => {
  let root: string;
  let harness: ReturnType<typeof makeTraceHarness>;
  const prompt = userText("look at this");
  const image = imageUrlMessage(
    `data:image/png;base64,${Buffer.alloc(40_000, 7).toString("base64")}`,
  );
  const unwritten = userText("held, not yet in the Trace");

  beforeAll(async () => {
    root = await makeTempRoot();
    harness = makeTraceHarness(root);
    const records: AmspRecord[] = [
      sessionMeta({
        session_id: S,
        model_id: "m1",
        provider: "custom",
        model_context_window: 1000,
        system_prompt: "sp",
        agent_state: "/tmp/a",
        workspace: "/tmp/w",
        source: "user",
      }),
      userText("q1"),
      requestBegin(),
      assistantText("a1"),
      requestEnd("completed"),
      prompt,
      image,
      requestBegin(),
    ];
    await writeTraceFile(root, P, A, "2026-07-22", S, 1, records);
  });
  afterAll(async () => {
    harness.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("offers only the held inputs the window does not hold; the image rides as a stub", async () => {
    const row = sessionRow(S, { projectId: P, agentId: A });
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("user", { userId: "u" } as never);
      await next();
    });
    app.route(
      "/api/sessions",
      historyLinesRoutes({
        traces: harness.service,
        sessions: { findById: (id) => (id === S ? row : null) },
        access: { requireProjectAccess: () => ({}) as never },
        manager: {
          statusOf: () => "running",
          liveFragments: () => [],
          pendingInputs: () => [prompt, image, unwritten],
          pendingBootstrap: () => [],
        },
        channels: { get: () => ({ lastEventId: "e1-9" }) as never },
      }),
    );
    const res = await app.request(`/api/sessions/${S}/history-lines?tailLimit=20`);
    const events = (await res.text()).split("\n\n").map((block) => {
      const lines = block.split("\n");
      const field = (name: string) =>
        lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);
      return { event: field("event"), data: field("data") };
    });
    const window = JSON.parse(
      events.find((e) => e.event === "window")!.data!,
    ) as HistoryLinesWindow;
    expect(window.envelope.pendingInputs).toEqual([unwritten]);
    expect(window.stubs.map((s) => (s.record.payload as { image_url?: string }).image_url)).toEqual(
      [expect.stringContaining("/trace-image?")],
    );
  });
});
