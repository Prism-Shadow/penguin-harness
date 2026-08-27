/**
 * `penguin input` — send a message into an existing session, or poll its last answer.
 *
 *   penguin input [session_id] [-m <text>] [--timeout <duration>]
 *                 [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *
 * `[session_id]` accepts a full id or a unique fragment (e.g. the 8-hex tail `penguin
 * ls` prints); omitted, it is the agent's most recent session (announced as a dim
 * `[latest]` line on stderr — see resolveSessionTarget), which makes bare `penguin
 * input` the answer to "what did my agent last say".
 *
 * With `-m`: a running session gets the text as steering (POST /steer, delivered between
 * turns); an idle one gets a new task (POST /tasks). The default waits and renders the
 * stream until the turn completes; `--timeout` bounds the wait with soft-yield
 * semantics — on expiry the command detaches (exit 0, the task keeps running
 * server-side) instead of erroring. `--timeout 0` is the degenerate window: return
 * immediately after delivery — the one timeout knob covers "don't wait" too.
 *
 * Without `-m`: **poll** — print the session's most recent complete assistant text
 * (an idempotent last-answer snapshot from the messages tail; thinking and tool output
 * are skipped), mirroring `input_subagent`'s empty-prompt semantics. Nothing is queued
 * or steered. A running session is waited on (silently, no rendering) up to the window
 * before the snapshot is taken; still running at expiry prints the current latest text
 * plus the still-running note, exit 0 (`--timeout 0` snapshots immediately).
 *
 * The fragment search scopes to the project (PENGUIN_PROJECT_ID / default_project);
 * a full session id needs no scope.
 * Docs: /docs/cli § "penguin input".
 */
import type { Command } from "commander";
import { isModelMessage, type OmniMessage } from "@prismshadow/penguin-core";
import { StreamRenderer, dim } from "../render.js";
import { parseDurationMs } from "../duration.js";
import { promptApproval } from "../approval.js";
import {
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  ServerClient,
  shortSessionId,
} from "../client.js";
import { getSessionInfo, getSessionMessages, resolveSessionTarget } from "../server-session.js";
import { SessionStream, watchTask } from "../server-task.js";
import type { Messages } from "../i18n.js";

/** The most recent complete assistant text of the main session (poll's snapshot); null when none exists yet. */
export function latestAssistantText(messages: OmniMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if ((msg.origin?.length ?? 0) > 0 || !isModelMessage(msg)) continue;
    const p = msg.payload as { type?: string; role?: string; text?: string };
    if (p.type === "text" && p.role !== "user" && typeof p.text === "string") return p.text;
  }
  return null;
}

export function registerInputCommand(program: Command, t: Messages): void {
  program
    .command("input [sessionId]")
    .description(t.input.desc)
    .option("-m, --message <text>", t.input.message)
    .option("--timeout <duration>", t.common.timeout)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.latestAgentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (sessionRef: string | undefined, opts) => {
      const json = opts.json === true;
      let timeoutMs: number | undefined;
      if (opts.timeout !== undefined) {
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
      const sessionId = await resolveSessionTarget(
        client,
        { ref: sessionRef, projectId, agentId: resolveAgentId(opts.agentId) },
        t,
      );
      if (sessionId === null) return; // no session to act on; the hint is already printed
      const out = process.stdout;

      // —— Poll form (no -m): print the last answer, waiting out a running turn first ——
      if (opts.message === undefined) {
        const info = await getSessionInfo(client, sessionId);
        let status: "idle" | "running" = info.status === "idle" ? "idle" : "running";
        if (status === "running" && timeoutMs !== 0) {
          // Wait (silently — the snapshot is the output, not the stream) for the turn to
          // end, bounded by --timeout when given; unbounded like every waiting command
          // otherwise. A zero window skips the wait entirely: snapshot right away.
          const stream = new SessionStream(client, sessionId, t);
          try {
            const state = await stream.waitReady();
            if (state !== "idle") {
              const result = await watchTask(stream, {
                client,
                sessionId,
                t,
                ...(timeoutMs !== undefined ? { deadlineMs: Date.now() + timeoutMs } : {}),
              });
              status = result.timedOut ? "running" : "idle";
            } else {
              status = "idle";
            }
          } finally {
            stream.close();
          }
        }
        const text = latestAssistantText(await getSessionMessages(client, sessionId));
        if (json) {
          out.write(`${JSON.stringify({ sessionId, status, text: text ?? "" })}\n`);
        } else {
          if (text !== null) out.write(`${text}\n`);
          else out.write(`${dim(t.input.noReplyYet())}\n`);
          if (status === "running") {
            out.write(`${dim(t.client.stillRunning(shortSessionId(sessionId)))}\n`);
          }
        }
        return;
      }

      const text = String(opts.message);
      // Running -> steer; idle -> task. The status read races the run ending, so the
      // steer path falls back to a task on 409 (the same fallback the Web applies).
      const post = async (running: boolean): Promise<void> => {
        if (running) {
          try {
            await client.request("POST", `/api/sessions/${sessionId}/steer`, { text });
            return;
          } catch {
            // 409 not_running (the task just ended): fall through to a normal task.
          }
        }
        await client.request("POST", `/api/sessions/${sessionId}/tasks`, {
          input: [{ type: "text", text }],
        });
      };

      if (timeoutMs === 0) {
        // The zero window: deliver and return — no subscription, no rendering. The
        // still-running note carries the id for the later poll/follow.
        const info = await getSessionInfo(client, sessionId);
        await post(info.status !== "idle");
        if (json) out.write(`${JSON.stringify({ sessionId, status: "running" })}\n`);
        else out.write(`${dim(t.client.stillRunning(shortSessionId(sessionId)))}\n`);
        return;
      }

      const stream = new SessionStream(client, sessionId, t);
      const renderer = json ? undefined : new StreamRenderer(out, t);
      const texts: string[] = [];
      let interrupted = false;
      const onSigint = () => {
        if (interrupted) return;
        interrupted = true;
        if (!json) out.write(`\n${t.taskInterrupted()}\n`);
        void client.request("POST", `/api/sessions/${sessionId}/abort`).catch(() => undefined);
      };
      process.on("SIGINT", onSigint);
      try {
        const state = await stream.waitReady();
        await post(state !== "idle");
        // The soft-yield clock starts once the message is delivered.
        const result = await watchTask(stream, {
          client,
          sessionId,
          t,
          ...(renderer ? { renderer } : {}),
          approvalPrompt: () => promptApproval({ t }),
          onAssistantText: (chunk) => {
            texts.push(chunk);
          },
          ...(timeoutMs !== undefined ? { deadlineMs: Date.now() + timeoutMs } : {}),
        });
        if (result.timedOut) {
          // Soft yield: detach, task keeps running server-side, exit 0.
          if (json) {
            out.write(
              `${JSON.stringify({ sessionId, status: "running", text: texts.join("\n") })}\n`,
            );
          } else {
            out.write(`${dim(t.client.stillRunning(shortSessionId(sessionId)))}\n`);
          }
          return;
        }
        if (json) {
          out.write(
            `${JSON.stringify({
              sessionId,
              status: result.aborted ? "aborted" : "completed",
              text: texts.join("\n"),
            })}\n`,
          );
        }
        if (result.aborted) process.exitCode = 1;
      } finally {
        process.off("SIGINT", onSigint);
        stream.close();
      }
    });
}
