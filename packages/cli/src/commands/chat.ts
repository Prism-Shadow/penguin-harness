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
 * renders its progress; `/clear` starts over, the next message creating a fresh Session;
 * `/thinking` shows or re-pins the Session's thinking level; `/switch-model <provider>
 * <model_id>` switches the Session's model in place (compacting on the current model
 * first) and bare `/switch-model` shows the current one; `/verbose` toggles tool-output
 * collapsing (display only); `/exit` or `/quit` exits. Typing while a turn runs POSTs
 * a steering message (delivered between turns); Ctrl-C during a run POSTs /abort.
 *
 * A new chat creates its Session at the first message, never before: opening the chat and
 * leaving it writes nothing on the server (no Session row, no Trace, no sidebar entry). The
 * banner shows the agent, Workspace and model the Session will have; `/thinking` and
 * `/switch-model` typed before then change what it is created with, `/compact` and `/clear`
 * say there is no conversation yet. When creating it fails, the message is kept: the next
 * Enter sends it again. So it is when the server refuses that first message (a 4xx: no goal
 * plugin, no model credential), and the Session just created for it is deleted — it never ran,
 * and left behind it would be an empty conversation in every Web sidebar.
 *
 * `--resume` reuses an existing Session (full id or unique fragment; omitted = the
 * agent's most recent Session) and first renders its history from GET /messages; it
 * takes no model flags — `/switch-model` changes the model inside the chat.
 * Ctrl-C behavior (state-dependent): buffer has content -> clear it; awaiting approval
 * -> deny; running -> abort the current turn; empty buffer -> y/N exit confirmation.
 * Docs: /docs/cli § "penguin chat".
 */
import { createInterface, type Interface } from "node:readline";
import type { Command } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import type {
  ApprovalDecision,
  OmniMessage,
  ThinkingLevelName,
  ToolCallPayload,
} from "@prismshadow/penguin-core";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { StreamRenderer, dim, renderHistory } from "../render.js";
import { parseGoalCommand } from "../goal-command.js";
import { parseThinkingCommand, resolveThinkingLevel } from "../thinking-command.js";
import {
  formatModelLabel,
  parseSwitchModelCommand,
  switchModelRefusal,
  type ModelTarget,
} from "../switch-model-command.js";
import { parseApprovalAnswer, resolveApprovalMode } from "../approval.js";
import { LineComposer, PasteFilter } from "../input.js";
import {
  ApiError,
  connectionLabel,
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
  projectDefaultModel,
  resolveWorkspace,
} from "../server-session.js";
import { SessionStream, watchTask } from "../server-task.js";
import type { Messages } from "../i18n.js";

export type ChatState = "idle" | "running" | "approving" | "confirming-exit";

/**
 * What a new chat's Session is created with at the first message: the flags, the calling
 * Session's values inside an agent, and what `/thinking` and `/switch-model` changed since.
 * No model is the Project's default; no level, the agent's configured one.
 */
interface PendingSession {
  workspace: string;
  modelId?: string;
  provider?: string;
  approvalMode?: string;
  thinkingLevel?: ThinkingLevelName;
}

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

/**
 * Semantic prompt marks (OSC 133, the FinalTerm sequences shells emit for shell integration):
 * `A` where the main prompt starts, `B` where input starts after it, `C` when a submitted
 * prompt's turn starts, `D;<0|1>` when it ends (1 = it ended in an error). Terminals that know
 * them can jump between prompts and select a turn's output; a host embedding the chat can tell
 * that it is back at its prompt and takes input. Zero-width and ignored by terminals that do
 * not know them; written only when stdin and stdout are both a terminal and `TERM` is not
 * `dumb`. Advisory: model output reaches the terminal unfiltered and can carry them too.
 */
function promptMark(kind: "A" | "B" | "C" | "D", exitCode?: number): string {
  return `\x1b]133;${kind}${exitCode === undefined ? "" : `;${exitCode}`}\x07`;
}

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
      // --resume excludes --workspace and the model pair (the resumed Session keeps its
      // own; /switch-model changes the model inside the chat); checked before any
      // connection is made.
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

      // --resume reuses an existing Session (its own workspace and model). A new chat has
      // none until the first message (see the module doc): `pending` holds what it will be
      // created with, and `session` stays null. `session` is reassigned by /clear and
      // /switch-model after the closures below capture it, so it stays a let.
      let session: SessionInfo | null = null;
      let pending: PendingSession | null = null;
      /**
       * A level the Session created at the first message still has to be pinned to: kept when
       * that pin failed, for the next message to retry.
       */
      let pinAfterCreate: ThinkingLevelName | null = null;
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
        let resumed = await getSessionInfo(client, sessionId);
        resumedMessages = await getSessionMessages(client, sessionId);
        if (opts.approve !== undefined) {
          await client.request("PATCH", `/api/sessions/${resumed.sessionId}`, {
            approvalMode: mode,
          });
        }
        // The thinking level is pinned on the Session (PATCH) and core applies it from the
        // next LLM request — the soft-limited parameter: a mid-context change is allowed,
        // and the /thinking reply advises compacting first since it costs the provider's
        // cached context. `--thinking` under `--resume` pins the existing Session the same
        // way; `/thinking <level>` re-pins.
        if (flagThinking) {
          await pinThinkingLevel(client, resumed.sessionId, flagThinking);
          resumed = { ...resumed, thinkingLevel: flagThinking };
        }
        session = resumed;
      } else {
        // Inside a harness agent, unspecified fields default to the CALLING session's
        // values — the run_subagent inheritance, applied to the CLI surface. Per field:
        // explicit flag > caller value > the plain fallback. `--thinking` (with no flag, the
        // caller's level) pins the Session once created (sticky server-side: it rides every
        // later request of this Session; a subagent it spawns inherits the level its
        // parent's context opened with, not the pin — run_subagent's own argument sets a
        // child's level).
        const caller = await callerSessionContext(client, t);
        const thinking = flagThinking ?? caller?.thinkingLevel;
        pending = {
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
          ...(thinking ? { thinkingLevel: thinking } : {}),
        };
      }

      // A new chat that names no model gets the Project's default: read, not created, for the
      // banner and a bare /switch-model.
      const projectDefault =
        pending !== null && pending.modelId === undefined
          ? await projectDefaultModel(client, projectId)
          : null;
      /** The model the conversation is on, or will be created on, as /switch-model labels it. */
      const modelLabel = (): string => {
        if (session !== null) return formatModelLabel(session.provider, session.modelId);
        if (pending?.modelId !== undefined) {
          return formatModelLabel(pending.provider ?? "", pending.modelId);
        }
        return projectDefault
          ? formatModelLabel(projectDefault.provider, projectDefault.modelId)
          : t.chatProjectDefaultModel();
      };
      const sessionThinkingLevel = (): string =>
        (session !== null ? session.thinkingLevel : pending?.thinkingLevel) ??
        t.chatThinkingConfigured();

      let renderer = new StreamRenderer(out, t, { collapseToolOutput: !verbose });

      out.write(
        `${t.header(
          "chat",
          buildInfo().describe,
          session?.agentId ?? agentId,
          session?.workspace ?? pending?.workspace ?? "",
          session?.modelId ??
            pending?.modelId ??
            projectDefault?.modelId ??
            t.chatProjectDefaultModel(),
          connectionLabel(client.conn),
        )}\n` +
          (session === null ? `${dim(t.chatNewConversation())}\n` : "") +
          `${t.chatHints()}\n`,
      );
      // On resume, first render the history messages of the current context (full
      // messages, same endpoint the Web history uses), then proceed to regular input.
      if (resumedMessages !== null && session !== null) {
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
        renderer.setInputHold(
          state === "running" && (rli.line.length > 0 || composer.hasPending()),
        );
      };
      if (isTTY) {
        inputStream.on("data", () => setImmediate(syncInputHold));
      }

      let state: ChatState = "idle";
      let closed = false;
      // The marks are output: a TTY stdin is not enough when stdout is redirected to a file or
      // a pipe, or the terminal is a dumb one.
      const marksOn = isTTY && out.isTTY === true && process.env.TERM !== "dumb";
      const mark = (kind: "A" | "B" | "C" | "D", exitCode?: number): void => {
        if (marksOn) out.write(promptMark(kind, exitCode));
      };
      /** Set while a turn runs; SIGINT posts /abort through it exactly once per turn. */
      let abortTurn: (() => void) | null = null;
      let pendingLine: ((line: string | null) => void) | null = null;
      let pendingApproval: ((decision: ApprovalDecision) => void) | null = null;
      /** A line typed in the running->idle race window (steer refused): becomes the next prompt instead of being dropped. */
      let queuedPrompt: string | null = null;
      /**
       * A message that was not sent because its Session could not be created: offered again at
       * the next prompt — back in the input line on a terminal (a multi-line one waiting in the
       * composer, like a paste), else sent by the next empty line.
       */
      let kept: string | null = null;

      /** The conversation's Session, where one must exist: a turn, a steer, a switch. */
      const live = (): SessionInfo => {
        if (session === null) throw new Error("penguin chat: no Session yet");
        return session;
      };

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
        // A paste is message text whether or not a Task runs: it waits in the composer for
        // Enter, which sends it as the next prompt or, mid-run, as steering, the same as a
        // typed line. Only the y/N answers (approval, exit confirmation) take no paste.
        pasteFilter.on("paste", (text: string) => {
          if (state !== "idle" && state !== "running") return;
          const { lineCount, normalized } = composer.pushPaste(text);
          if (lineCount === 0) return;
          if (state === "running") {
            // Through the renderer, which finishes an open streamed line first; the hold then
            // keeps further output off the pasted text until it is sent.
            renderer.printLine(normalized);
            syncInputHold();
          } else {
            out.write(`${normalized}\n`);
          }
          rl.setPrompt(CONT_PROMPT);
          rl.prompt();
        });
      }

      // Mid-run steering over the API: POST /steer; a 409 (the task just finished — the
      // running->idle race) must not drop the line, so it becomes the next prompt — fed
      // straight to a waiting askLine, else stashed for the next one.
      const steer = (text: string): void => {
        void client
          .request("POST", `/api/sessions/${live().sessionId}/steer`, { text })
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
        // running: a non-empty message becomes a steering message for the running Task, a
        // paste waiting in the composer included (this Enter sends it whole).
        if (state === "running") {
          const { message } = composer.pushTypedLine(line);
          if (message === undefined) {
            rl.setPrompt(CONT_PROMPT);
            rl.prompt();
            return;
          }
          const text = message.trim();
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
          // A message whose Session could not be created comes back on a terminal: a multi-line
          // one waits in the composer like a paste (shown again, under the continuation prompt),
          // a one-line one goes back into the input line below.
          if (kept !== null && isTTY && kept.includes("\n")) {
            composer.pushPaste(kept);
            out.write(`\n${kept}`);
            kept = null;
          }
          // A paste made while the Task ran and not sent yet stays, under the continuation
          // prompt: the next Enter sends it as this prompt.
          if (composer.hasPending()) {
            out.write("\n");
            rl.setPrompt(CONT_PROMPT);
            rl.prompt();
            return;
          }
          composer.reset();
          rli.line = "";
          rli.cursor = 0;
          out.write("\n");
          mark("A");
          rl.setPrompt(MAIN_PROMPT);
          rl.prompt();
          mark("B");
          if (kept !== null && isTTY) {
            const message = kept;
            kept = null;
            rl.write(message);
          }
        });

      // Interactive approval prompt: reuses the persistent readline; the tool call is
      // already rendered above via streaming, so it is not re-rendered here.
      const interactivePrompt = (_tc: OmniMessage<ToolCallPayload>): Promise<ApprovalDecision> =>
        new Promise((resolve) => {
          state = "approving";
          pendingApproval = (decision) => {
            state = "running";
            // A paste still waiting for Enter holds output again before the screen unlocks
            // and drains what queued during the question.
            syncInputHold();
            resolve(decision);
          };
          rl.setPrompt(t.approvePrompt());
          rl.prompt();
        });

      /**
       * One server-driven turn: subscribe, POST via `post`, watch to idle. Returns once
       * the turn (or compaction/goal) has fully settled. Wires this turn's Ctrl-C to
       * POST /abort exactly once. `inline` recognizes a response that already settled
       * the request inside the POST (nothing streams for it, so there is nothing to watch);
       * the result says whether the stream was watched.
       */
      const runTurn = async (
        post: () => Promise<unknown>,
        watch: { goal?: boolean; inline?: (response: unknown) => boolean } = {},
      ): Promise<boolean> => {
        const sessionId = live().sessionId;
        const stream = new SessionStream(client, sessionId, t);
        let aborted = false;
        abortTurn = () => {
          if (aborted) return;
          aborted = true;
          void client.request("POST", `/api/sessions/${sessionId}/abort`).catch(() => undefined);
        };
        try {
          await stream.waitReady();
          const response = await post();
          if (watch.inline?.(response)) return false;
          await watchTask(stream, {
            client,
            sessionId,
            t,
            renderer,
            approvalPrompt: interactivePrompt,
            ...(watch.goal ? { goal: { out } } : {}),
          });
          return true;
        } finally {
          abortTurn = null;
          stream.close();
        }
      };

      // Whether this Session already has (or gained) history worth a resume hint.
      let resumable = opts.resume !== undefined;

      /**
       * `/switch-model <provider> <model_id>`: POST /switch-model through runTurn. A 202
       * streams like /compact — an ordinary compaction, rendered as any compaction is (none
       * for a context just compacted) — and the Session is re-read once it ends. A 200 carries
       * the Session back: it never ran, so it switched inside the request (under a new id when
       * the server had to rebuild one that left no Trace, which the chat follows). The model
       * line prints only when the model actually changed, since a failed compaction already
       * said why it did not. A 409 prints one localized line per refusal code.
       */
      const switchModel = async (target: ModelTarget): Promise<void> => {
        const previous = live();
        const startedAt = Date.now();
        let streamed: boolean;
        let switched: SessionInfo | undefined;
        try {
          streamed = await runTurn(
            () =>
              client.request("POST", `/api/sessions/${previous.sessionId}/switch-model`, target),
            // 200 SessionResponse vs 202 TaskCreateResponse: only the former has `session`.
            {
              inline: (response) => {
                switched = (response as { session?: SessionInfo } | null)?.session;
                return switched !== undefined;
              },
            },
          );
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            const line = switchModelRefusal(err, target, previous.projectId, t);
            if (line !== null) {
              out.write(`${line}\n`);
              return;
            }
          }
          throw err;
        } finally {
          renderer.endCompact(Date.now() - startedAt);
        }
        if (streamed) resumable = true;
        const now = switched ?? (await getSessionInfo(client, previous.sessionId));
        session = now;
        if (now.provider !== previous.provider || now.modelId !== previous.modelId) {
          out.write(
            `${t.switchModelDone(
              formatModelLabel(previous.provider, previous.modelId),
              formatModelLabel(now.provider, now.modelId),
            )}\n`,
          );
        }
      };

      /**
       * Creates the Session at the first message, with what `pending` holds — the first write
       * this chat makes — and pins the held level. Retried by the next message when either
       * step failed: a Session created whose pin failed stays this chat's, and only the pin is
       * tried again.
       */
      const ensureSession = async (): Promise<SessionInfo> => {
        let current = session;
        if (current === null) {
          const held: PendingSession = pending ?? { workspace: process.cwd() };
          current = await createServerSession(client, {
            projectId,
            agentId,
            workspace: held.workspace,
            ...(held.modelId !== undefined
              ? { modelId: held.modelId, provider: held.provider }
              : {}),
            ...(held.approvalMode !== undefined ? { approvalMode: held.approvalMode } : {}),
          });
          session = current;
          pending = null;
          pinAfterCreate = held.thinkingLevel ?? null;
        }
        if (pinAfterCreate !== null) {
          const level = pinAfterCreate;
          await pinThinkingLevel(client, current.sessionId, level);
          current = { ...current, thinkingLevel: level };
          session = current;
          pinAfterCreate = null;
        }
        return current;
      };

      /**
       * The Session a message goes to, created now when it is the first (ensureSession), or
       * null when that failed: the error is shown and the message kept, offered again at the
       * next prompt, so a server that was down or a sign-in that lapsed costs no typed text.
       */
      const sessionFor = async (message: string): Promise<SessionInfo | null> => {
        if (session !== null && pinAfterCreate === null) return session;
        try {
          return await ensureSession();
        } catch (err) {
          out.write(`\n${t.error(err instanceof Error ? err.message : String(err))}\n`);
          out.write(`${dim(t.chatMessageKept())}\n`);
          kept = message;
          return null;
        }
      };

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
          let text = line.trim();
          // A message that was not sent goes again on an empty line where it could not be put
          // back into the input line (a pipe); a non-empty line replaces it.
          if (text.length === 0 && kept !== null) text = kept;
          kept = null;
          if (text === "/exit" || text === "/quit") break;
          if (text.length === 0) continue;

          // Instant local commands (no Task runs, state stays idle). Typed mid-run they
          // are steering text. Before the first message they change what the Session is
          // created with.
          if (text === "/thinking" || text.startsWith("/thinking ")) {
            const parsed = parseThinkingCommand(text);
            if (!parsed.ok) {
              out.write(`${t.error(t.thinkingInvalid(parsed.value))}\n`);
            } else if (parsed.level === null) {
              out.write(`${t.thinkingCurrent(sessionThinkingLevel())}\n`);
            } else if (session === null) {
              if (pending !== null) pending.thinkingLevel = parsed.level;
              out.write(`${t.thinkingHeld(parsed.level)}\n`);
            } else {
              try {
                await pinThinkingLevel(client, session.sessionId, parsed.level);
                session = { ...session, thinkingLevel: parsed.level };
                pinAfterCreate = null;
                out.write(`${t.thinkingSet(parsed.level)}\n`);
              } catch (err) {
                out.write(`${t.error(err instanceof Error ? err.message : String(err))}\n`);
              }
            }
            continue;
          }
          let switchTarget: ModelTarget | null = null;
          if (text === "/switch-model" || text.startsWith("/switch-model ")) {
            const parsed = parseSwitchModelCommand(text);
            if (!parsed.ok) {
              out.write(`${t.error(t.switchModelUsage())}\n`);
              continue;
            }
            if (parsed.target === null) {
              out.write(`${t.switchModelCurrent(modelLabel())}\n`);
              continue;
            }
            if (session === null) {
              // Nothing to switch yet: the Session created at the first message runs on it, and
              // the server checks it then.
              if (pending !== null) {
                pending.provider = parsed.target.provider;
                pending.modelId = parsed.target.modelId;
              }
              out.write(
                `${t.switchModelHeld(formatModelLabel(parsed.target.provider, parsed.target.modelId))}\n`,
              );
              continue;
            }
            switchTarget = parsed.target;
          }
          if (text === "/verbose") {
            verbose = !verbose;
            renderer.setCollapseToolOutput(!verbose);
            out.write(`${verbose ? t.verboseOn() : t.verboseOff()}\n`);
            continue;
          }
          if ((text === "/compact" || text === "/clear") && session === null) {
            out.write(`${t.chatNoConversation()}\n`);
            continue;
          }
          if (text === "/clear") {
            // Start over: the next message creates a brand-new blank Session on the same
            // Workspace and model, pinned to the same level (whether it came from --thinking,
            // /thinking or the calling session's context). Nothing is created now. The old
            // Session stays on the server (resumable), so its resume command is printed first.
            const previous = live();
            const level = previous.thinkingLevel ?? pinAfterCreate ?? undefined;
            if (resumable) out.write(`${dim(t.resumeHint(resumeCommand(previous.sessionId)))}\n`);
            pending = {
              workspace: previous.workspace,
              modelId: previous.modelId,
              provider: previous.provider,
              approvalMode: previous.approvalMode,
              ...(level !== undefined ? { thinkingLevel: level } : {}),
            };
            session = null;
            pinAfterCreate = null;
            renderer = new StreamRenderer(out, t, { collapseToolOutput: !verbose });
            resumable = false;
            out.write(`${t.clearDone()}\n`);
            continue;
          }

          state = "running";
          mark("C");
          let failed = false;
          // What a Session this message creates is created with, for the catch below to put back.
          const unstarted: {
            pending: PendingSession | null;
            pinAfterCreate: ThinkingLevelName | null;
          } | null = session === null ? { pending, pinAfterCreate } : null;
          try {
            if (text === "/compact") {
              // Proactive context compaction: POST /compact and render its paired events
              // from the stream; a 409 (nothing to compact / just compacted) prints one
              // line of feedback. endCompact settles the renderer's counters afterwards.
              const startedAt = Date.now();
              const sessionId = live().sessionId;
              try {
                await runTurn(() => client.request("POST", `/api/sessions/${sessionId}/compact`));
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
            } else if (switchTarget !== null) {
              await switchModel(switchTarget);
            } else if (text === "/goal" || text.startsWith("/goal:") || text.startsWith("/goal ")) {
              // Goal mode: one POST drives the whole loop server-side; Ctrl-C aborts the
              // entire goal. A malformed one creates no Session.
              const parsed = parseGoalCommand(text);
              if (!parsed.ok) {
                const message =
                  parsed.reason === "budget" ? t.goalBudgetInvalid(parsed.value) : t.goalUsage();
                out.write(`${t.error(message)}\n`);
              } else {
                const current = await sessionFor(text);
                if (current === null) {
                  failed = true;
                } else {
                  resumable = true;
                  await runTurn(
                    () =>
                      client.request("POST", `/api/sessions/${current.sessionId}/tasks`, {
                        input: [{ type: "text", text: parsed.objective }],
                        goal: { budget: parsed.budget },
                      }),
                    { goal: true },
                  );
                }
              }
            } else {
              const current = await sessionFor(text);
              if (current === null) {
                failed = true;
              } else {
                resumable = true;
                await runTurn(() =>
                  client.request("POST", `/api/sessions/${current.sessionId}/tasks`, {
                    input: [{ type: "text", text }],
                  }),
                );
              }
            }
          } catch (err) {
            failed = true;
            out.write(`\n${t.error(err instanceof Error ? err.message : String(err))}\n`);
            // The server refused the first message of the Session this message just created (no
            // goal plugin, no model credential): that Session never ran and never will, and left
            // on the server it is an empty conversation in every Web sidebar. It goes, and the
            // message is kept for the next one, the way a failed create keeps it. A network error
            // or a 5xx keeps the Session: the request may have reached it, and a resend goes there.
            if (
              unstarted !== null &&
              session !== null &&
              err instanceof ApiError &&
              err.status >= 400 &&
              err.status < 500
            ) {
              const refused = session.sessionId;
              await client.request("DELETE", `/api/sessions/${refused}`).catch(() => undefined);
              session = null;
              ({ pending, pinAfterCreate } = unstarted);
              resumable = false;
              kept = text;
              out.write(`${dim(t.chatMessageKept())}\n`);
            }
          } finally {
            state = "idle";
            mark("D", failed ? 1 : 0);
          }
        }
      } finally {
        rl.close();
        cleanup();
        process.removeListener("exit", cleanup);
        // On exit, print a dimmed resume command example; skipped when the Session has
        // no history yet (nothing to resume), and when there is no Session at all. The
        // Session itself lives on the server.
        if (resumable && session !== null) {
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
