/**
 * `penguin run` — send a single Task through the server and render its stream.
 *
 *   penguin run -m <msg> [--project-id <id>] [--agent-id <id>] [--workspace <path>]
 *               [--model-id <id> --provider <group>] [--approve <mode>]
 *               [--thinking <level>] [--session <session_id>] [--background]
 *               [--goal [budget]] [--json] [--server <url>]
 *
 * The CLI is a thin client: it creates a Session over the API (or reuses `--session`),
 * POSTs the task, subscribes to the SSE stream and renders OmniMessages until the task
 * ends, then prints the stats line. Exit 0 on completed; a goal run exits 0 only when
 * the goal outcome is `complete`.
 *
 * - Defaults: project/agent from PENGUIN_PROJECT_ID / PENGUIN_AGENT_ID (else
 *   default_project / default_agent); Workspace = the CLI's cwd (resolved locally —
 *   server and CLI share the machine in the default flow); model = the Project default;
 *   approval mode allow-all (the historical run default).
 * - `--session` accepts a full id or a unique fragment; it excludes `--workspace` and
 *   the model pair (neither can change after creation); `--approve` PATCHes the mode.
 * - `--background`: POST the task and exit immediately, printing the session id
 *   (`{"sessionId"}` under `--json`) — the task keeps running on the server.
 * - `--json` (non-background): suppress rendering; print `{sessionId, status, text}`
 *   where `text` joins the main session's assistant text messages of this task.
 * - Ctrl-C: during an approval prompt → deny that call; otherwise POST /abort and let
 *   the stream wind down (the abort event maps to exit code 1).
 * Docs: /docs/cli § "penguin run".
 */
import type { Command } from "commander";
import { UNLIMITED_BUDGET, VERSION } from "@prismshadow/penguin-core";
import { StreamRenderer } from "../render.js";
import { parseTokenBudget } from "../goal-command.js";
import { resolveThinkingLevel } from "../thinking-command.js";
import { denyActivePrompt, promptApproval, resolveApprovalMode } from "../approval.js";
import {
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  resolveSessionRef,
  ServerClient,
} from "../client.js";
import { createServerSession, getSessionInfo, resolveWorkspace } from "../server-session.js";
import { SessionStream, watchTask } from "../server-task.js";
import type { Messages } from "../i18n.js";

export function registerRunCommand(program: Command, t: Messages): void {
  program
    .command("run")
    .description(t.run.desc)
    .requiredOption("-m, --message <message>", t.run.message)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--workspace <path>", t.common.workspace)
    .option("--model-id <id>", t.common.modelId)
    .option("--provider <group>", t.common.provider)
    .option("--approve <mode>", t.common.approve)
    .option("--thinking <level>", t.common.thinking)
    .option("--session <sessionId>", t.run.session)
    .option("--background", t.run.background)
    .option("--goal [budget]", t.run.goal)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      // The model reference is a pair: commander can only require each option on its own,
      // so the "both or neither" rule is enforced here. Giving neither is the normal case
      // and falls back to the Project's default model.
      if (Boolean(opts.modelId) !== Boolean(opts.provider)) {
        process.stderr.write(`${t.error(t.modelRefIncomplete())}\n`);
        process.exitCode = 1;
        return;
      }
      // --goal's optional value is the token budget (`--goal 500k`); a bare --goal means no
      // budget. Validated before anything touches the server.
      let goalBudget: number | null = null;
      if (opts.goal !== undefined) {
        goalBudget = opts.goal === true ? UNLIMITED_BUDGET : parseTokenBudget(String(opts.goal));
        if (goalBudget === null) {
          process.stderr.write(`${t.error(t.goalBudgetInvalid(String(opts.goal)))}\n`);
          process.exitCode = 1;
          return;
        }
        if (String(opts.message).trim() === "") {
          process.stderr.write(`${t.error(t.goalObjectiveEmpty())}\n`);
          process.exitCode = 1;
          return;
        }
      }
      if (opts.session !== undefined && (opts.workspace || opts.modelId || opts.provider)) {
        // Workspace and model are fixed at creation; a reused Session keeps its own.
        process.stderr.write(`${t.error(t.run.sessionNoOverride())}\n`);
        process.exitCode = 1;
        return;
      }
      const mode = resolveApprovalMode(opts.approve, t);
      const thinking = resolveThinkingLevel(opts.thinking, t);
      const json = opts.json === true;

      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agentId = resolveAgentId(opts.agentId);

      let session;
      if (opts.session !== undefined) {
        const sessionId = await resolveSessionRef(client, projectId, String(opts.session), t);
        session = await getSessionInfo(client, sessionId);
        if (opts.approve !== undefined) {
          await client.request("PATCH", `/api/sessions/${session.sessionId}`, {
            approvalMode: mode,
          });
        }
      } else {
        session = await createServerSession(client, {
          projectId,
          agentId,
          workspace: resolveWorkspace(opts.workspace),
          ...(opts.modelId ? { modelId: opts.modelId, provider: opts.provider } : {}),
          // The historical run default is allow-all — also the server default; sent
          // explicitly only when the user picked a mode.
          ...(opts.approve !== undefined ? { approvalMode: mode } : {}),
        });
      }

      const taskBody = {
        input: [{ type: "text", text: String(opts.message) }],
        ...(thinking ? { thinkingLevel: thinking } : {}),
        ...(goalBudget !== null ? { goal: { budget: goalBudget } } : {}),
      };

      if (opts.background === true) {
        // POST and leave: the task runs on the server; the id is what `penguin input` /
        // `penguin logs` address later.
        await client.request("POST", `/api/sessions/${session.sessionId}/tasks`, taskBody);
        process.stdout.write(
          json ? `${JSON.stringify({ sessionId: session.sessionId })}\n` : `${session.sessionId}\n`,
        );
        return;
      }

      const out = process.stdout;
      if (!json) {
        out.write(
          `${t.header("run", VERSION, session.agentId, session.workspace, session.modelId)}\n`,
        );
      }

      // Subscribe BEFORE posting so no early frame is missed; the first task_state is
      // the authoritative snapshot.
      const stream = new SessionStream(client, session.sessionId, t);
      const renderer = json ? undefined : new StreamRenderer(out, t);
      const texts: string[] = [];
      let interrupted = false;
      const onSigint = () => {
        // Ctrl-C during approval collapses to "deny this tool" (see approval.ts); at all
        // other times it aborts the server-side task — the stream then winds down on its
        // own (abort event + idle flip).
        if (denyActivePrompt()) return;
        if (interrupted) return;
        interrupted = true;
        if (!json) out.write(`\n${t.taskInterrupted()}\n`);
        void client
          .request("POST", `/api/sessions/${session.sessionId}/abort`)
          .catch(() => undefined);
      };
      process.on("SIGINT", onSigint);
      try {
        await stream.waitReady();
        await client.request("POST", `/api/sessions/${session.sessionId}/tasks`, taskBody);
        const result = await watchTask(stream, {
          client,
          sessionId: session.sessionId,
          t,
          ...(renderer ? { renderer } : {}),
          approvalPrompt: () => promptApproval({ t }),
          ...(goalBudget !== null && !json ? { goal: { out } } : {}),
          ...(goalBudget !== null && json ? { goal: { out: new NullSink() } } : {}),
          onAssistantText: (text) => {
            texts.push(text);
          },
        });
        const status =
          goalBudget !== null
            ? (result.goal?.outcome ?? "aborted")
            : result.aborted
              ? "aborted"
              : "completed";
        if (json) {
          out.write(
            `${JSON.stringify({ sessionId: session.sessionId, status, text: texts.join("\n") })}\n`,
          );
        }
        if (goalBudget !== null) {
          if (result.goal?.outcome !== "complete") process.exitCode = 1;
        } else if (result.aborted) {
          process.exitCode = 1;
        }
      } finally {
        process.off("SIGINT", onSigint);
        stream.close();
      }
      if (!json) out.write("\n");
    });
}

/** Swallows goal round lines under --json (the outcome still reaches the JSON object). */
class NullSink {
  write(_chunk: string): boolean {
    return true;
  }
}
