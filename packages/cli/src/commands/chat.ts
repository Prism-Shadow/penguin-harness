/**
 * `penguin chat` — interactive REPL.
 *
 *   penguin chat [--model-id <id> --provider <group>] [--project-id <id>] [--agent-id <id>]
 *                [--workspace <path>] [--approve <allow-all|deny-all|read-only|always-ask>]
 *
 * Each line of input starts one conversation turn; `/compact` proactively compacts the
 * context (reason=manual); `/exit` or `/quit` exits.
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
import { createAgent, userText } from "@prismshadow/penguin-core";
import type { ApprovalDecision, OmniMessage, ToolCallPayload } from "@prismshadow/penguin-core";
import { StreamRenderer, dim, renderHistory } from "../render.js";
import { runTask } from "../task-loop.js";
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
      const out = process.stdout;

      const agent = await createAgent({
        ...(opts.agentId ? { agentId: opts.agentId } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      });

      // --resume: resumes an existing Session. Workspace and
      // Model follow the original Session and cannot be overridden; when omitted, resumes
      // the current Agent's most recent Session.
      let session;
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
        });
      }

      const renderer = new StreamRenderer(out, t);

      out.write(
        `${t.header("chat", agent.state.agentId, session.workspaceDir, session.modelId)}\n` +
          `${t.chatHints()}\n`,
      );
      // On resume, first render the history messages of the current context per Trace
      // (full messages, including interrupted turns and their markers), then proceed to
      // regular input.
      if (session.resumedHistory) {
        out.write(`${t.resumedBanner(session.sessionId, session.resumedHistory.length)}\n`);
        renderHistory(session.resumedHistory, out);
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

      let state: ChatState = "idle";
      let closed = false;
      let taskAbort: AbortController | null = null;
      let pendingLine: ((line: string | null) => void) | null = null;
      let pendingApproval: ((decision: ApprovalDecision) => void) | null = null;

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
        }
        // running: ignore any line typed at this moment.
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

      try {
        for (;;) {
          const line = await askLine();
          if (line === null) break;
          const text = line.trim();
          if (text === "/exit" || text === "/quit") break;
          if (text.length === 0) continue;

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
            } else {
              resumable = true;
              await runTask(session, [userText(text)], {
                mode,
                signal: taskAbort.signal,
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
        // On exit, print a dimmed resume command example: includes this
        // session's Project / Agent options so the command can be copy-pasted directly;
        // skipped when the Session has no Trace record yet (nothing to resume).
        if (resumable) {
          const command =
            `penguin chat --resume ${session.sessionId}` +
            (opts.projectId ? ` --project-id ${opts.projectId}` : "") +
            (opts.agentId ? ` --agent-id ${opts.agentId}` : "");
          out.write(`${dim(t.resumeHint(command))}\n`);
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
