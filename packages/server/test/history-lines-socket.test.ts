/**
 * The machine leg over a real API socket with acknowledged flow, as a hub reads it: a listening
 * server, the runtime's upgrade, a WebSocket client that acks the data it handles.
 *
 * - Given a credit call for a Session's window and fill (several windows' worth), the
 *   stream's start frame echoes `x-flow: credit`, no event carries more than a frame of text,
 *   the stream goes on only as the client acks (unacknowledged, it would stop after the first
 *   window), and once `done` arrives the lines committed equal the file.
 */
import fs from "node:fs/promises";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve } from "@hono/node-server";
import { WebSocket } from "ws";
import {
  assistantText,
  requestBegin,
  requestEnd,
  sessionMeta,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import type { HistoryLinesFrame, HistoryPartFrame } from "../src/api/types.js";
import { FRAME_TEXT_BUDGET, LineCommitter } from "../src/socket/line-frames.js";
import { apiSocketPath } from "../src/socket/ref.js";
import { attachTerminalWebSocket } from "../src/terminal/ws.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { createTestApp, loginAdmin, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "default_project";
const AGENT = "default_agent";

let t: TestApp;
let port: number;
let server: ReturnType<typeof serve>;
let cookie: string;

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await loginAdmin(t.app)).cookie;
  await new Promise<void>((resolve) => {
    server = serve({ fetch: t.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      port = info.port;
      resolve();
    });
  });
  attachTerminalWebSocket(server as unknown as HttpServer, {
    hmr: t.deps.hmr,
    authService: t.deps.authService,
    log: () => undefined,
  });
});
afterAll(async () => {
  (server as unknown as HttpServer).closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await t.cleanup();
});

describe("history-lines over a credit socket", () => {
  it("echoes credit, keeps every event within a frame and the window, and delivers the files whole", async () => {
    const sid = uniqueSessionId();
    t.deps.sessionsRepo.insert(sessionRow(sid, { projectId: PROJECT, agentId: AGENT }));
    const path = await writeTraceFile(t.root, PROJECT, AGENT, "2026-09-01", sid, 1, [
      sessionMeta({
        session_id: sid,
        provider: "custom",
        model_id: "m1",
        model_context_window: 10_000,
        system_prompt: "sp",
        agent_state: "/tmp/a",
        workspace: "/tmp/w",
        source: "user",
      }),
      ...Array.from({ length: 4 }, (_, n) => [
        userText(`q${n}`),
        requestBegin(),
        toolCallOutput({ output: `${n}`.repeat(90_000), toolCallId: `t${n}`, status: "completed" }),
        assistantText(`a${n}`),
        requestEnd("completed"),
      ]).flat(),
    ]);
    const size = (await fs.stat(path)).size;

    const ws = new WebSocket(`ws://127.0.0.1:${port}${apiSocketPath()}`, {
      headers: { host: `localhost:${port}`, cookie },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const committer = new LineCommitter();
    const copy = Buffer.alloc(size);
    let received = 0;
    let acked = 0;
    let largestWindowEvent = 0;
    let largestLineText = 0;
    let start: Record<string, unknown> | null = null;
    const events: string[] = [];
    const done = new Promise<void>((resolve, reject) => {
      ws.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (frame.id !== 1) return; // the socket's own heartbeat
        if ("stream" in frame) start = frame;
        if ("status" in frame && !("stream" in frame))
          reject(new Error(`answered ${frame.status}`));
        if (!("event" in frame)) return;
        const event = frame.event as string;
        const data = frame.data as string;
        events.push(event);
        if (event === "ping") return;
        if (event === "window" || event === "window-part") {
          largestWindowEvent = Math.max(largestWindowEvent, data.length);
        }
        received += data.length;
        if (event === "lines" || event === "part") {
          const line = JSON.parse(data) as HistoryLinesFrame | HistoryPartFrame;
          const bytes = Buffer.byteLength(line.text, line.b64 ? "base64" : "utf8");
          largestLineText = Math.max(largestLineText, bytes);
          const run = committer.push(line);
          run?.bytes.copy(copy, run.off);
        }
        acked = received;
        ws.send(JSON.stringify({ id: 1, ack: acked }));
        if (event === "done") resolve();
      });
    });
    ws.send(
      JSON.stringify({
        id: 1,
        call: {
          method: "GET",
          path: `/api/sessions/${sid}/history-lines?tailLimit=2&fill=1`,
          headers: { accept: "text/event-stream", "x-flow": "credit" },
        },
      }),
    );
    await done;
    expect(start).toMatchObject({ status: 200, headers: { "x-flow": "credit" } });
    expect(events[0]).toBe("window");
    expect(largestWindowEvent).toBeLessThanOrEqual(FRAME_TEXT_BUDGET);
    expect(largestLineText).toBeLessThanOrEqual(FRAME_TEXT_BUDGET);
    expect(copy).toEqual(await fs.readFile(path));
    ws.close();
  });
});
