/**
 * `penguin chat` — interactive REPL over the server.
 *
 *   penguin chat [--project-id <id>] [--agent-id <id>] [--workspace <path>]
 *                [--model-id <id> --provider <group>] [--approve <mode>]
 *                [--thinking <level>] [--resume [sessionId]] [--verbose] [--server <url>]
 *
 * The REPL machinery (persistent readline, bracketed paste, the Ctrl-C state machine)
 * is unchanged; the transport is the server: each turn POSTs a task and consumes the
 * Session's SSE stream (subscribe first, POST second) through the shared watcher.
 * `/goal[:<budget>] <objective>` runs goal mode; `/compact` POSTs a compaction and
 * renders its progress; `/clear` creates a fresh server Session in place; `/thinking`
 * shows or re-pins the Session's thinking level; `/verbose` toggles tool-output
 * collapsing (display only); `/exit` or `/quit` exits. Typing while a turn runs POSTs
 * a steering message (delivered between turns); Ctrl-C during a run POSTs /abort.
 *
 * `--resume` reuses an existing Session (full id or unique fragment; omitted = the
 * agent's most recent Session) and first renders its history from GET /messages.
 * Ctrl-C behavior (state-dependent): buffer has content -> clear it; awaiting approval
 * -> deny; running -> abort the current turn; empty buffer -> y/N exit confirmation.
 * Docs: /docs/cli § "penguin chat".
 */
import { createInterface, type Interface } from "node:readline";
import type { Command } from "commander";
import { VERSION } from "@prismshadow/penguin-core";
import type { ApprovalDecision, OmniMessage, ToolCallPayload } from "@prismshadow/penguin-core";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { StreamRenderer, dim, renderHistory } from "../render.js";
import { parseGoalCommand } from "../goal-command.js";
import { parseThinkingCommand, resolveThinkingLevel } from "../thinking-command.js";
import { parseApprovalAnswer, resolveApprovalMode } from "../approval.js";
import { LineComposer, PasteFilter } from "../input.js";
import {
  ApiError,
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  resolveSessionRef,
  ServerClient,
} from "../client.js";
import {
  callerSessionContext,
  createServerSession,
  getSessionInfo,
  getSessionMessages,
  listAgentSessions,
  pinThinkingLevel,
  resolveWorkspace,
} from "../server-session.js";
import { SessionStream, watchTask } from "../server-task.js";
import type { Messages } from "../i18n.js";

export type ChatState = "idle" | "running" | "approving" | "confirming-exit";

export type SigintAction = "deny" | "abort" | "clear" | "confirm-exit" | "exit";

/** Pure decision: current state + whether the input buffer is non-empty -> the action Ctrl-C should perform. */
export function decideSigint(state: ChatState, hasBufferedInput: boolean): SigintAction {
  if (state === "approving") return "deny";
  if (state === "running") return "abort";
  if (state === "confirming-exit") return "exit";
  return hasBufferedInput ? "clear" : "confirm-exit";
}

interface RlInternals {
  line: string;
  cursor: number;
  _refreshLine?: () => void;
}

const MAIN_PROMPT = "> ";
const CONT_PROMPT = "… ";

export function registerChatCommand(program: Command, t: Messages): void {
  program
    .command("chat")
    .description(t.chat.desc)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--workspace <path>", t.common.workspace)
    .option("--model-id <id>", t.common.modelId)
    .option("--provider <group>", t.common.provider)
    .option("--approve <mode>", t.common.approve)
    .option("--thinking <level>", t.common.thinking)
    .option("--resume [sessionId]", t.chat.resume)
    .option("--verbose", t.chat.verbose)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      // The model reference is a pair; both-or-neither (skipped under --resume, which
      // rejects both outright below). Usage errors go to stderr, REPL info to stdout.
      if (opts.resume === undefined && Boolean(opts.modelId) !== Boolean(opts.provider)) {
        process.stderr.write(`${t.error(t.modelRefIncomplete())}\n`);
        process.exitCode = 1;
        return;
      }
      // --resume excludes --workspace and the model pair (neither can change once the
      // Session exists); checked before any connection is made.
      if (opts.resume !== undefined && (opts.workspace || opts.modelId || opts.provider)) {
        process.stdout.write(`${t.error(t.resumeNoOverride())}\n`);
        process.exitCode = 1;
        return;
      }
      const mode = resolveApprovalMode(opts.approve, t);
      const flagThinking = resolveThinkingLevel(opts.thinking, t);
      // Tool-output collapsing (display only; the Trace keeps everything): on by default,
      // `--verbose` starts with full output, `/verbose` toggles it mid-chat.
      let verbose = opts.verbose === true;
      const out = process.stdout;

      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agentId = resolveAgentId(opts.agentId);

      // --resume reuses an existing Session (workspace/model fixed at creation); a new
      // chat creates one on this cwd. `session` is reassigned by /clear after the
      // closures below capture it, so it stays a let.
      let session: SessionInfo;
      let resumedMessages: OmniMessage[] | null = null;
      if (opts.resume !== undefined) {
        let sessionId: string | undefined;
        if (typeof opts.resume === "string") {
          sessionId = await resolveSessionRef(client, projectId, opts.resume, t);
        } else {
          // Most recent Session of the agent (the list is newest-first).
          sessionId = (await listAgentSessions(client, projectId, agentId))[0]?.sessionId;
        }
        if (!sessionId) {
          out.write(`${t.error(t.resumeNoSession())}\n`);
          process.exitCode = 1;
          return;
        }
        session = await getSessionInfo(client, sessionId);
        resumedMessages = await getSessionMessages(client, sessionId);
        if (opts.approve !== undefined) {
          await client.request("PATCH", `/api/sessions/${session.sessionId}`, {
            approvalMode: mode,
          });
        }
      } else {
        // Inside a harness agent, unspecified fields default to the CALLING session's
        // values — the run_subagent inheritance, applied to the CLI surface. Per field:
        // explicit flag > caller value > the plain fallback.
        const caller = await callerSessionContext(client, t);
        session = await createServerSession(client, {
          projectId,
          agentId,
          workspace: resolveWorkspace(opts.workspace, caller?.workspace),
          ...(opts.modelId
            ? { modelId: opts.modelId, provider: opts.provider }
            : caller
              ? { modelId: caller.modelId, provider: caller.provider }
              : {}),
          ...(opts.approve !== undefined
            ? { approvalMode: mode }
            : caller
              ? { approvalMode: caller.approvalMode }
              : {}),
        });
        // `--thinking` on a new chat pins the Session (sticky server-side: it rides every
        // later request of this Session; a subagent it spawns inherits the level its
        // parent's context opened with, not the pin — run_subagent's own argument sets a
        // child's level); with no flag, the caller's level pins the same way.
        const pin = flagThinking ?? caller?.thinkingLevel;
        if (pin) {
          await pinThinkingLevel(client, session.sessionId, pin);
          session = { ...session, thinkingLevel: pin };
        }
      }

      // The thinking level is pinned on the Session (PATCH) and core applies it from the
      // next LLM request — the soft-limited parameter: a mid-context change is allowed,
      // and the /thinking reply advises compacting first since it costs the provider's
      // cached context. `--thinking` under `--resume` pins the existing Session the same
      // way; `/thinking <level>` re-pins.
      if (opts.resume !== undefined && flagThinking) {
        await pinThinkingLevel(client, session.sessionId, flagThinking);
        session = { ...session, thinkingLevel: flagThinking };
      }
      const sessionThinkingLevel = (): string =>
        session.thinkingLevel ?? t.chatThinkingConfigured();

      let renderer = new StreamRenderer(out, t, { collapseToolOutput: !verbose });

      out.write(
        `${t.header("chat", VERSION, session.agentId, session.workspace, session.modelId)}\n` +
          `${t.chatHints()}\n`,
      );
      // On resume, first render the history messages of the current context (full
      // messages, same endpoint the Web history uses), then proceed to regular input.
      if (resumedMessages !== null) {
        out.write(`${t.resumedBanner(session.sessionId, resumedMessages.length)}\n`);
        renderHistory(resumedMessages, out, t, { collapseToolOutput: !verbose });
      }

      // TTY: raw mode + bracketed paste + PasteFilter; non-TTY (pipe/test): read stdin directly.
      const isTTY = Boolean(process.stdin.isTTY);
      let pasteFilter: PasteFilter | null = null;
      let inputStream: NodeJS.ReadableStream = process.stdin;
      if (isTTY) {
        process.stdin.setRawMode(true);
        out.write("\x1b[?2004h");
        pasteFilter = new PasteFilter();
        process.stdin.pipe(pasteFilter);
        inputStream = pasteFilter;
      }

      const rl = createInterface({
        input: inputStream,
        output: out,
        terminal: isTTY,
      });
      const rli = rl as unknown as RlInternals;
      const composer = new LineComposer();

      // Typing lock: while the user is composing a line mid-run, streamed output must not
      // scribble over it — the renderer holds output while the input buffer is non-empty
      // and flushes once the line is submitted or cleared. TTY only.
      const syncInputHold = (): void => {
        renderer.setInputHold(state === "running" && rli.line.length > 0);
      };
      if (isTTY) {
        inputStream.on("data", () => setImmediate(syncInputHold));
      }

      let state: ChatState = "idle";
      let closed = false;
      /** Set while a turn runs; SIGINT posts /abort through it exactly once per turn. */
      let abortTurn: (() => void) | null = null;
      let pendingLine: ((line: string | null) => void) | null = null;
      let pendingApproval: ((decision: ApprovalDecision) => void) | null = null;
      /** A line typed in the running->idle race window (steer refused): becomes the next prompt instead of being dropped. */
      let queuedPrompt: string | null = null;

      const cleanup = () => {
        if (!isTTY) return;
        try {
          out.write("\x1b[?2004l");
        } catch {
          /* ignore */
        }
        try {
          process.stdin.setRawMode(false);
        } catch {
          /* ignore */
        }
        try {
          if (pasteFilter) process.stdin.unpipe(pasteFilter);
        } catch {
          /* ignore */
        }
        try {
          process.stdin.pause();
        } catch {
          /* ignore */
        }
      };
      process.once("exit", cleanup);

      if (pasteFilter) {
        pasteFilter.on("paste", (text: string) => {
          if (state !== "idle") return; // ignore paste while running
          const { lineCount, normalized } = composer.pushPaste(text);
          if (lineCount === 0) return;
          out.write(`${normalized}\n`);
          rl.setPrompt(CONT_PROMPT);
          rl.prompt();
        });
      }

      // Mid-run steering over the API: POST /steer; a 409 (the task just finished — the
      // running->idle race) must not drop the line, so it becomes the next prompt — fed
      // straight to a waiting askLine, else stashed for the next one.
      const steer = (text: string): void => {
        void client
          .request("POST", `/api/sessions/${session.sessionId}/steer`, { text })
          .then(() => {
            renderer.printLine(dim(t.steerQueued(text)));
          })
          .catch(() => {
            if (pendingLine) {
              const resolve = pendingLine;
              pendingLine = null;
              resolve(text);
            } else {
              queuedPrompt = text;
            }
          });
      };

      rl.on("line", (line) => {
        if (state === "confirming-exit") {
          if (parseApprovalAnswer(line) === "allow") {
            rl.close();
          } else {
            state = "idle";
            composer.reset();
            out.write("\n");
            rl.setPrompt(MAIN_PROMPT);
            rl.prompt();
          }
          return;
        }
        if (state === "idle" && pendingLine) {
          const { message } = composer.pushTypedLine(line);
          if (message === undefined) {
            // Continuation: show the continuation prompt and keep waiting.
            rl.setPrompt(CONT_PROMPT);
            rl.prompt();
          } else {
            const resolve = pendingLine;
            pendingLine = null;
            resolve(message);
          }
          return;
        }
        if (state === "approving" && pendingApproval) {
          const resolve = pendingApproval;
          pendingApproval = null;
          // Tool approval defaults to allow: pressing Enter (empty input) is treated as allow.
          resolve(parseApprovalAnswer(line, "allow"));
          return;
        }
        // running: a non-empty line becomes a steering message for the running Task.
        if (state === "running") {
          const text = line.trim();
          if (text.length === 0) return;
          steer(text);
        }
      });

      rl.on("SIGINT", () => {
        const hasBuffer = rli.line.length > 0 || composer.hasPending();
        const action = decideSigint(state, hasBuffer);
        if (action === "deny") {
          if (pendingApproval) {
            const resolve = pendingApproval;
            pendingApproval = null;
            out.write("\n");
            resolve("deny");
          }
        } else if (action === "abort") {
          if (abortTurn) {
            out.write(`\n${t.taskInterrupted()}\n`);
            abortTurn();
            abortTurn = null;
          }
        } else if (action === "clear") {
          composer.reset();
          rl.setPrompt(MAIN_PROMPT);
          clearCurrentLine(rl, rli, out);
        } else if (action === "confirm-exit") {
          state = "confirming-exit";
          rli.line = "";
          rli.cursor = 0;
          out.write("\n");
          rl.setPrompt(t.confirmExit());
          rl.prompt();
        } else {
          out.write("\n");
          rl.close();
        }
      });

      rl.on("close", () => {
        closed = true;
        if (pendingLine) {
          const resolve = pendingLine;
          pendingLine = null;
          resolve(null);
        }
      });

      const askLine = (): Promise<string | null> =>
        new Promise((resolve) => {
          if (closed) {
            resolve(null);
            return;
          }
          // A line typed in the running->idle race window (steer refused): submit it as this
          // prompt immediately — the text is already echoed on screen, no re-prompt needed.
          if (queuedPrompt !== null) {
            const line = queuedPrompt;
            queuedPrompt = null;
            state = "idle";
            resolve(line);
            return;
          }
          state = "idle";
          pendingLine = resolve;
          composer.reset();
          rli.line = "";
          rli.cursor = 0;
          out.write("\n");
          rl.setPrompt(MAIN_PROMPT);
          rl.prompt();
        });

      // Interactive approval prompt: reuses the persistent readline; the tool call is
      // already rendered above via streaming, so it is not re-rendered here.
      const interactivePrompt = (_tc: OmniMessage<ToolCallPayload>): Promise<ApprovalDecision> =>
        new Promise((resolve) => {
          state = "approving";
          pendingApproval = (decision) => {
            state = "running";
            resolve(decision);
          };
          rl.setPrompt(t.approvePrompt());
          rl.prompt();
        });

      /**
       * One server-driven turn: subscribe, POST via `post`, watch to idle. Returns once
       * the turn (or compaction/goal) has fully settled. Wires this turn's Ctrl-C to
       * POST /abort exactly once.
       */
      const runTurn = async (
        post: () => Promise<unknown>,
        watch: { goal?: boolean } = {},
      ): Promise<void> => {
        const stream = new SessionStream(client, session.sessionId, t);
        let aborted = false;
        abortTurn = () => {
          if (aborted) return;
          aborted = true;
          void client
            .request("POST", `/api/sessions/${session.sessionId}/abort`)
            .catch(() => undefined);
        };
        try {
          await stream.waitReady();
          await post();
          await watchTask(stream, {
            client,
            sessionId: session.sessionId,
            t,
            renderer,
            approvalPrompt: interactivePrompt,
            ...(watch.goal ? { goal: { out } } : {}),
          });
        } finally {
          abortTurn = null;
          stream.close();
        }
      };

      // Whether this Session already has (or gained) history worth a resume hint.
      let resumable = opts.resume !== undefined;

      // The copy-pastable resume command for one Session: includes this run's Project /
      // Agent options so it works as-is.
      const resumeCommand = (sessionId: string): string =>
        `penguin chat --resume ${sessionId}` +
        (opts.projectId ? ` --project-id ${opts.projectId}` : "") +
        (opts.agentId ? ` --agent-id ${opts.agentId}` : "");

      try {
        for (;;) {
          const line = await askLine();
          if (line === null) break;
          const text = line.trim();
          if (text === "/exit" || text === "/quit") break;
          if (text.length === 0) continue;

          // Instant local commands (no Task runs, state stays idle). Typed mid-run they
          // are steering text.
          if (text === "/thinking" || text.startsWith("/thinking ")) {
            const parsed = parseThinkingCommand(text);
            if (!parsed.ok) {
              out.write(`${t.error(t.thinkingInvalid(parsed.value))}\n`);
            } else if (parsed.level === null) {
              out.write(`${t.thinkingCurrent(sessionThinkingLevel())}\n`);
            } else {
              try {
                await pinThinkingLevel(client, session.sessionId, parsed.level);
                session = { ...session, thinkingLevel: parsed.level };
                out.write(`${t.thinkingSet(parsed.level)}\n`);
              } catch (err) {
                out.write(`${t.error(err instanceof Error ? err.message : String(err))}\n`);
              }
            }
            continue;
          }
          if (text === "/verbose") {
            verbose = !verbose;
            renderer.setCollapseToolOutput(!verbose);
            out.write(`${verbose ? t.verboseOn() : t.verboseOff()}\n`);
            continue;
          }

          state = "running";
          try {
            if (text === "/compact") {
              // Proactive context compaction: POST /compact and render its paired events
              // from the stream; a 409 (nothing to compact / just compacted) prints one
              // line of feedback. endCompact settles the renderer's counters afterwards.
              const startedAt = Date.now();
              try {
                await runTurn(() =>
                  client.request("POST", `/api/sessions/${session.sessionId}/compact`),
                );
                resumable = true;
              } catch (err) {
                if (err instanceof ApiError && err.status === 409) {
                  out.write(`${t.compactNothing()}\n`);
                } else {
                  throw err;
                }
              } finally {
                renderer.endCompact(Date.now() - startedAt);
              }
            } else if (text === "/clear") {
              // Start over with a brand-new blank Session on the same Workspace and model.
              // The old Session stays on the server (resumable), so its resume command is
              // printed first. The new Session is created before the old one is dropped: a
              // failure keeps the current conversation intact.
              const next = await createServerSession(client, {
                projectId,
                agentId,
                workspace: session.workspace,
                modelId: session.modelId,
                provider: session.provider,
                approvalMode: session.approvalMode,
              });
              // Carry the current session's pinned thinking level over (whether it came
              // from --thinking or from the calling session's context).
              const pin = session.thinkingLevel;
              if (pin) await pinThinkingLevel(client, next.sessionId, pin);
              if (resumable) out.write(`${dim(t.resumeHint(resumeCommand(session.sessionId)))}\n`);
              session = pin ? { ...next, thinkingLevel: pin } : next;
              renderer = new StreamRenderer(out, t, { collapseToolOutput: !verbose });
              resumable = false;
              out.write(`${t.clearDone()}\n`);
            } else if (text === "/goal" || text.startsWith("/goal:") || text.startsWith("/goal ")) {
              // Goal mode: one POST drives the whole loop server-side; Ctrl-C aborts the
              // entire goal.
              const parsed = parseGoalCommand(text);
              if (!parsed.ok) {
                const message =
                  parsed.reason === "budget" ? t.goalBudgetInvalid(parsed.value) : t.goalUsage();
                out.write(`${t.error(message)}\n`);
              } else {
                resumable = true;
                await runTurn(
                  () =>
                    client.request("POST", `/api/sessions/${session.sessionId}/tasks`, {
                      input: [{ type: "text", text: parsed.objective }],
                      goal: { budget: parsed.budget },
                    }),
                  { goal: true },
                );
              }
            } else {
              resumable = true;
              await runTurn(() =>
                client.request("POST", `/api/sessions/${session.sessionId}/tasks`, {
                  input: [{ type: "text", text }],
                }),
              );
            }
          } catch (err) {
            out.write(`\n${t.error(err instanceof Error ? err.message : String(err))}\n`);
          } finally {
            state = "idle";
          }
        }
      } finally {
        rl.close();
        cleanup();
        process.removeListener("exit", cleanup);
        // On exit, print a dimmed resume command example; skipped when the Session has
        // no history yet (nothing to resume). The Session itself lives on the server.
        if (resumable) {
          out.write(`${dim(t.resumeHint(resumeCommand(session.sessionId)))}\n`);
        }
      }
    });
}

/** Clear the current input line and redraw the prompt (Ctrl-C clears the buffer when it has content). */
function clearCurrentLine(rl: Interface, rli: RlInternals, out: NodeJS.WritableStream): void {
  rli.line = "";
  rli.cursor = 0;
  if (typeof rli._refreshLine === "function") {
    rli._refreshLine();
  } else {
    out.write("\r\x1b[K");
    rl.prompt(true);
  }
}
