/**
 * `penguin chat` — interactive REPL.
 *
 *   penguin chat [--model-id <id> --provider <group>] [--project-id <id>] [--agent-id <id>]
 *                [--workspace <path>] [--approve <allow-all|deny-all|read-only|always-ask>]
 *                [--thinking <low|medium|high|xhigh>] [--verbose]
 *
 * Each line of input starts one conversation turn; `/goal[:<budget>] <objective>` runs
 * goal mode (looping until the goal reaches a terminal state);
 * `/compact` proactively compacts the context (reason=manual); `/clear` starts a fresh
 * blank Session in place (the old Session's Trace stays on disk, resumable);
 * `/thinking [<level>]` shows or overrides the thinking level for subsequent turns
 * (see thinking-command.ts for the flag/command semantics); `/verbose` toggles
 * tool-output collapsing (long outputs render head/tail + an elision marker by default —
 * display only, the Trace keeps the full text; see output-collapse.ts); `/exit` or
 * `/quit` exits.
 * Uses the current directory when no Workspace is specified. A model reference is always an
 * explicit `(provider, model_id)` pair, so `--model-id` and `--provider` must be given
 * together; giving neither uses the Project's default model.
 *
 * Multi-line input: trailing `\` continues the line; when the terminal supports bracketed
 * paste, a multi-line paste is treated as a single message (sent on Enter).
 *
 * Ctrl-C behavior (state-dependent): buffer has content -> clear it;
 * awaiting approval -> deny; running -> abort the current turn and return to input;
 * empty buffer -> show a y/N exit confirmation.
 *
 * Implementation notes: on a TTY, stdin is put into raw mode with bracketed paste enabled;
 * stdin is piped through PasteFilter into a readline created with `terminal: true` — Ctrl-C
 * is captured in-process by readline as 'SIGINT' (it never escapes as an OS signal killing
 * the process group), and pasted content is held whole by PasteFilter (not split into
 * multiple submits by embedded newlines).
 * Docs: /docs/cli § "penguin chat".
 */
import { createInterface, type Interface } from "node:readline";
import type { Command } from "commander";
import { createAgent, userText, VERSION } from "@prismshadow/penguin-core";
import type {
  ApprovalDecision,
  DefaultChatThinkingLevel,
  OmniMessage,
  Session,
  ToolCallPayload,
} from "@prismshadow/penguin-core";
import { StreamRenderer, dim, renderHistory } from "../render.js";
import { runTask } from "../task-loop.js";
import { parseGoalCommand } from "../goal-command.js";
import {
  configuredThinkingLevel,
  parseThinkingCommand,
  resolveThinkingLevel,
} from "../thinking-command.js";
import { parseApprovalAnswer, resolveApprovalMode } from "../approval.js";
import { LineComposer, PasteFilter } from "../input.js";
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
    .option("--model-id <id>", t.common.modelId)
    .option("--provider <group>", t.common.provider)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--workspace <path>", t.common.workspace)
    .option("--approve <mode>", t.common.approve)
    .option("--thinking <level>", t.common.thinking)
    .option("--verbose", t.chat.verbose)
    .option("--resume [sessionId]", t.chat.resume)
    .action(async (opts) => {
      // The model reference is a pair: commander can only require each option on its own,
      // so the "both or neither" rule is enforced here. Giving neither is the normal case
      // and falls back to the Project's default model. Skipped under --resume, which
      // rejects both options outright further down with a more specific message.
      // Usage errors go to stderr (as in `run` and `config model add`), unlike this file's
      // informational messages, which the REPL writes to stdout.
      if (opts.resume === undefined && Boolean(opts.modelId) !== Boolean(opts.provider)) {
        process.stderr.write(`${t.error(t.modelRefIncomplete())}\n`);
        process.exitCode = 1;
        return;
      }
      const mode = resolveApprovalMode(opts.approve, t);
      const flagThinking = resolveThinkingLevel(opts.thinking, t);
      // Tool-output collapsing (display only; the Trace keeps everything): on by default,
      // `--verbose` starts with full output, `/verbose` toggles it mid-chat.
      let verbose = opts.verbose === true;
      const out = process.stdout;

      const agent = await createAgent({
        ...(opts.agentId ? { agentId: opts.agentId } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      });

      // --resume: resumes an existing Session. Workspace and
      // Model follow the original Session and cannot be overridden; when omitted, resumes
      // the current Agent's most recent Session. Annotated (not inferred) because /clear
      // reassigns it mid-REPL, after the closures below have captured it.
      let session: Session;
      if (opts.resume !== undefined) {
        if (opts.workspace || opts.modelId || opts.provider) {
          out.write(`${t.error(t.resumeNoOverride())}\n`);
          process.exitCode = 1;
          return;
        }
        const sessionId =
          typeof opts.resume === "string" ? opts.resume : await agent.latestSessionId();
        if (!sessionId) {
          out.write(`${t.error(t.resumeNoSession())}\n`);
          process.exitCode = 1;
          return;
        }
        session = await agent.resumeSession({ sessionId });
      } else {
        session = await agent.createSession({
          workspaceDir: opts.workspace ?? process.cwd(),
          ...(opts.modelId ? { modelId: opts.modelId } : {}),
          ...(opts.provider ? { provider: opts.provider } : {}),
          ...(flagThinking ? { thinkingLevel: flagThinking } : {}),
        });
      }

      // Thinking level shown/changed by `/thinking` (a per-turn run parameter, so it CAN
      // change mid-session — unlike workspace/model):
      // - `--thinking` on a new chat pins the Session default at creation (above), so
      //   subagent sessions follow it; under `--resume` the Session already exists and the
      //   flag becomes the initial per-turn override instead.
      // - `/thinking <level>` sets the override; unset turns omit the parameter so core's
      //   construction-time default applies (`sessionThinkingDefault` mirrors it for display).
      let thinkingOverride: DefaultChatThinkingLevel | undefined =
        opts.resume !== undefined ? flagThinking : undefined;
      const sessionThinkingDefault = (): string =>
        opts.resume === undefined && flagThinking ? flagThinking : configuredThinkingLevel(agent);

      let renderer = new StreamRenderer(out, t, { collapseToolOutput: !verbose });
      // Tool schemas (each tool's call-line preview path) arrive on the stream as the
      // first run's tool_list_ready event — the toolset isn't known before then (MCP
      // servers connect lazily); the renderer registers them as they flow by.

      out.write(
        `${t.header("chat", VERSION, agent.state.agentId, session.workspaceDir, session.modelId)}\n` +
          `${t.chatHints()}\n`,
      );
      // On resume, first render the history messages of the current context per Trace
      // (full messages, including interrupted turns and their markers), then proceed to
      // regular input.
      if (session.resumedHistory) {
        out.write(`${t.resumedBanner(session.sessionId, session.resumedHistory.length)}\n`);
        renderHistory(session.resumedHistory, out, t, { collapseToolOutput: !verbose });
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

      // Typing lock (owner directive): while the user is composing a line mid-run, streamed
      // output must not scribble over it — the renderer holds (queues) output while the input
      // buffer is non-empty and flushes once the line is submitted or cleared. Synced after
      // readline has processed each chunk (setImmediate: listener order is not guaranteed);
      // TTY only — non-TTY input (pipe/tests) has no echoed line to protect. The approval
      // prompt has its own lock (beginUserPrompt), so the hold applies to "running" only.
      const syncInputHold = (): void => {
        renderer.setInputHold(state === "running" && rli.line.length > 0);
      };
      if (isTTY) {
        inputStream.on("data", () => setImmediate(syncInputHold));
      }

      let state: ChatState = "idle";
      let closed = false;
      let taskAbort: AbortController | null = null;
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
        // running: a non-empty line becomes a steering message for the running Task — core
        // delivers it between turns as a standalone [user_steering] user message, so the
        // model sees it without the loop being interrupted. Empty lines are still ignored.
        // steer() returning false (race: the task just finished) must not drop the line:
        // it is stashed and becomes the next normal prompt as soon as the loop asks again.
        if (state === "running") {
          const text = line.trim();
          if (text.length === 0) return;
          if (session.steer([userText(text)])) {
            // Printed via the renderer while the typing hold is still engaged, so the ack
            // lands before the held stream output flushes underneath it.
            renderer.printLine(dim(t.steerQueued(text)));
          } else {
            queuedPrompt = text;
          }
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
          if (taskAbort && !taskAbort.signal.aborted) {
            out.write(`\n${t.taskInterrupted()}\n`);
            taskAbort.abort();
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

      // Interactive approval prompt: reuses the persistent readline, prompt text is
      // localized; the tool call is already rendered above via streaming, so it is not
      // re-rendered here.
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

      // Whether this Session already has a resumable Trace record: a resumed Session
      // naturally has one; a new Session gets one starting from its first Task / compact
      // (session_meta is written along with it). This decides whether to print the resume
      // command example on exit.
      let resumable = opts.resume !== undefined;

      // The copy-pastable resume command for one Session: includes this run's Project /
      // Agent options so it works as-is. Printed on exit, and by /clear for the Session
      // it retires.
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

          // Instant local commands (no Task runs, state stays idle). Like every slash
          // command they are recognized at the prompt only — typed mid-run they are
          // steering text.
          if (text === "/thinking" || text.startsWith("/thinking ")) {
            const parsed = parseThinkingCommand(text);
            if (!parsed.ok) {
              out.write(`${t.error(t.thinkingInvalid(parsed.value))}\n`);
            } else if (parsed.level === null) {
              out.write(`${t.thinkingCurrent(thinkingOverride ?? sessionThinkingDefault())}\n`);
            } else {
              thinkingOverride = parsed.level;
              out.write(`${t.thinkingSet(parsed.level)}\n`);
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
          taskAbort = new AbortController();
          try {
            if (text === "/compact") {
              // Proactive context compaction (Task boundary, reason=manual): the renderer
              // prints compaction progress; Ctrl-C aborts the compaction via signal
              // (preserving the original context). When there's nothing to compact (session
              // just started / two consecutive /compact calls), the engine silently returns
              // and we add one line of feedback here. Afterwards, settle the renderer's
              // counters (endCompact) — compaction usage is already shown on the completion
              // line and must not be counted again toward the next task's stats delta.
              const startedAt = Date.now();
              let sawMessage = false;
              try {
                for await (const msg of session.compact({
                  signal: taskAbort.signal,
                })) {
                  sawMessage = true;
                  resumable = true;
                  renderer.handle(msg);
                }
              } finally {
                renderer.endCompact(Date.now() - startedAt);
              }
              if (!sawMessage) out.write(`${t.compactNothing()}\n`);
            } else if (text === "/clear") {
              // Start over with a brand-new blank Session on the same Workspace and model
              // (pinned from the current Session, so a --resume'd chat clears to the same
              // settings). The old Session is only disposed — its persisted Trace stays on
              // disk and resumable — so its resume command is printed first (same shape as
              // the exit hint). The new Session is created before the old one is dropped:
              // a failure keeps the current conversation intact. A fresh renderer starts
              // the Session-cumulative stats from zero; the new Session has no Trace
              // record yet, so `resumable` resets until its first Task / compact.
              const next = await agent.createSession({
                workspaceDir: session.workspaceDir,
                modelId: session.modelId,
                provider: session.provider,
                ...(flagThinking ? { thinkingLevel: flagThinking } : {}),
              });
              if (resumable) out.write(`${dim(t.resumeHint(resumeCommand(session.sessionId)))}\n`);
              session.dispose();
              session = next;
              renderer = new StreamRenderer(out, t, { collapseToolOutput: !verbose });
              resumable = false;
              out.write(`${t.clearDone()}\n`);
            } else if (text === "/goal" || text.startsWith("/goal:") || text.startsWith("/goal ")) {
              // Goal mode: one command drives the whole loop; Ctrl-C aborts the entire
              // goal (a single signal spans every round), never just the current round.
              const parsed = parseGoalCommand(text);
              if (!parsed.ok) {
                const message =
                  parsed.reason === "budget" ? t.goalBudgetInvalid(parsed.value) : t.goalUsage();
                out.write(`${t.error(message)}\n`);
              } else {
                resumable = true;
                await runTask(session, [userText(parsed.objective)], {
                  mode,
                  signal: taskAbort.signal,
                  ...(thinkingOverride ? { thinkingLevel: thinkingOverride } : {}),
                  renderer,
                  interactivePrompt,
                  t,
                  goal: { budget: parsed.budget, out },
                });
              }
            } else {
              resumable = true;
              await runTask(session, [userText(text)], {
                mode,
                signal: taskAbort.signal,
                ...(thinkingOverride ? { thinkingLevel: thinkingOverride } : {}),
                renderer,
                interactivePrompt,
                t,
              });
            }
          } catch (err) {
            out.write(`\n${t.error(err instanceof Error ? err.message : String(err))}\n`);
          } finally {
            taskAbort = null;
            state = "idle";
          }
        }
      } finally {
        rl.close();
        cleanup();
        session.dispose(); // tear down managed long-running command sessions to avoid leaking background processes
        process.removeListener("exit", cleanup);
        // On exit, print a dimmed resume command example; skipped when the Session has
        // no Trace record yet (nothing to resume).
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
