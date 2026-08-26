/**
 * `penguin logs` — render a session's history (and optionally follow it live).
 *
 *   penguin logs <session_id> [--tail <n>] [-f|--follow] [--json] [--server <url>]
 *
 * History comes from GET /messages and renders through the same history renderer the
 * REPL's `--resume` uses; `--tail n` keeps the last n entries. `-f` keeps the command
 * attached: after the history it subscribes to the session's SSE stream and renders new
 * messages as they arrive (read-only — Ctrl-C detaches without touching the session).
 * Docs: /docs/cli § "penguin logs".
 */
import type { Command } from "commander";
import { StreamRenderer, dim, renderHistory } from "../render.js";
import { parseDurationMs } from "../duration.js";
import {
  resolveConnection,
  resolveProjectId,
  resolveSessionRef,
  ServerClient,
  shortSessionId,
} from "../client.js";
import { getSessionMessages } from "../server-session.js";
import { SessionStream, nextFrameOrDeadline } from "../server-task.js";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { Messages } from "../i18n.js";

export function registerLogsCommand(program: Command, t: Messages): void {
  program
    .command("logs <sessionId>")
    .description(t.logs.desc)
    .option("--tail <n>", t.logs.tail)
    .option("-f, --follow", t.logs.follow)
    .option("--timeout <duration>", t.common.timeout)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (sessionRef: string, opts) => {
      let tail: number | undefined;
      if (opts.tail !== undefined) {
        tail = Number(opts.tail);
        if (!Number.isInteger(tail) || tail <= 0) {
          process.stderr.write(`${t.error(t.logs.tailInvalid(String(opts.tail)))}\n`);
          process.exitCode = 1;
          return;
        }
      }
      // --timeout bounds the follow (soft yield): only meaningful with -f.
      let timeoutMs: number | undefined;
      if (opts.timeout !== undefined) {
        if (opts.follow !== true) {
          process.stderr.write(`${t.error(t.logs.timeoutNeedsFollow())}\n`);
          process.exitCode = 1;
          return;
        }
        const parsed = parseDurationMs(String(opts.timeout));
        if (parsed === null) {
          process.stderr.write(`${t.error(t.client.timeoutInvalid(String(opts.timeout)))}\n`);
          process.exitCode = 1;
          return;
        }
        timeoutMs = parsed;
      }
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const sessionId = await resolveSessionRef(client, projectId, sessionRef, t);

      let messages = await getSessionMessages(client, sessionId);
      if (tail !== undefined) messages = messages.slice(-tail);

      const out = process.stdout;
      if (opts.json === true) {
        out.write(`${JSON.stringify(messages)}\n`);
        if (opts.follow !== true) return;
      } else {
        renderHistory(messages, out, t);
      }

      if (opts.follow !== true) return;
      // Live continuation: a fresh subscription carries only new events (no buffer
      // replay without Last-Event-ID); an in-flight message's early chunks may be
      // missing, and the complete message that follows converges the transcript —
      // the same orphan-delta rule every stream client applies.
      const stream = new SessionStream(client, sessionId, t);
      const renderer = new StreamRenderer(out, t);
      const deadlineMs = timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
      const onSigint = () => {
        stream.close();
      };
      process.on("SIGINT", onSigint);
      try {
        for (;;) {
          const frame = await nextFrameOrDeadline(stream, deadlineMs);
          if (frame === "timeout") {
            // Soft yield: stop following, exit 0 — the session is untouched.
            if (opts.json !== true) {
              out.write(`${dim(t.client.stillRunning(shortSessionId(sessionId)))}\n`);
            }
            break;
          }
          if (frame === null) break;
          if (frame.event !== undefined) continue; // server events: not transcript content
          const msg = JSON.parse(frame.data) as OmniMessage;
          if (opts.json === true) out.write(`${JSON.stringify(msg)}\n`);
          else renderer.handle(msg);
        }
      } finally {
        process.off("SIGINT", onSigint);
        stream.close();
        out.write("\n");
      }
    });
}
