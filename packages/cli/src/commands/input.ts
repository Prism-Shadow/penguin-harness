/**
 * `penguin input` — send a message into an existing session.
 *
 *   penguin input <session_id> -m <text> [--no-wait] [--json] [--server <url>]
 *
 * `<session_id>` accepts a full id or a unique fragment (e.g. the 8-hex tail `penguin
 * ls` prints). A running session gets the text as steering (POST /steer, delivered
 * between turns); an idle one gets a new task (POST /tasks). The default waits and
 * renders the stream until the turn completes; `--no-wait` returns right after the 202.
 * The fragment search scopes to the project (PENGUIN_PROJECT_ID / default_project);
 * a full session id needs no scope.
 * Docs: /docs/cli § "penguin input".
 */
import type { Command } from "commander";
import { StreamRenderer } from "../render.js";
import { promptApproval } from "../approval.js";
import { resolveConnection, resolveProjectId, resolveSessionRef, ServerClient } from "../client.js";
import { getSessionInfo } from "../server-session.js";
import { SessionStream, watchTask } from "../server-task.js";
import type { Messages } from "../i18n.js";

export function registerInputCommand(program: Command, t: Messages): void {
  program
    .command("input <sessionId>")
    .description(t.input.desc)
    .requiredOption("-m, --message <text>", t.input.message)
    .option("--no-wait", t.input.noWait)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (sessionRef: string, opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const sessionId = await resolveSessionRef(client, projectId, sessionRef, t);
      const json = opts.json === true;
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

      if (opts.wait === false) {
        const info = await getSessionInfo(client, sessionId);
        await post(info.status !== "idle");
        process.stdout.write(json ? `${JSON.stringify({ sessionId })}\n` : `${sessionId}\n`);
        return;
      }

      const out = process.stdout;
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
        const result = await watchTask(stream, {
          client,
          sessionId,
          t,
          ...(renderer ? { renderer } : {}),
          approvalPrompt: () => promptApproval({ t }),
          onAssistantText: (chunk) => {
            texts.push(chunk);
          },
        });
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
