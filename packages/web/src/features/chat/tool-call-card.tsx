/**
 * A tool call of the session's stream, drawn by the shared UI package's `ToolCallCard`: this
 * binds the stream item, the pending-approval map and the session's callbacks to the card, and
 * holds the tool-specific reading of the call's arguments (the previews below), which is the
 * app's knowledge of its tools, not the card's.
 *
 * Duration accounting = **argument-generation segment + execution segment** (excludes time
 * spent waiting on human approval): the model streaming out arguments token by token is often
 * slower than the tool call itself, so reporting only the execution segment would badly
 * understate this step's cost. While waiting on approval, the already-settled generation
 * segment is shown; the wait itself is marked by the hourglass icon alone, since the approval
 * block below the row is always on screen and names the tool and its arguments.
 */
import { useMemo } from "react";
import { DETACHED_TOOL_NOTE_PREFIX } from "@prismshadow/penguin-core/interfaces";
import { ToolCallCard, useElapsedPast } from "@prismshadow/penguin-ui";
import type { RunState, ToolCallDuration } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toolDisplayName } from "../../lib/tool-alias";
import { stripAnsi } from "../../lib/strip-ansi";
import { approvalKey } from "../../lib/omni/stream-model";
import type { ToolCallItem } from "../../lib/omni/stream-model";
import { useTheme } from "../../state/theme";
import { agentIdFromRunSubagentArgs } from "./agent-topology";
import { SessionSubagentChip } from "./subagent-chip";
import type { StreamRenderContext } from "./message-stream";

/** Tools that accept the optional model-written `description` argument. */
const DESCRIBED_TOOLS = new Set([
  "exec_command",
  "input_command",
  "run_subagent",
  "input_subagent",
]);

/** The three file tools: previewed by their `file_path` argument. */
const FILE_TOOLS = new Set(["read_file", "edit_file", "write_file"]);

/**
 * The tools whose running call can be handed back as a background task: the two that own a
 * registry the work can move into (a process_id, a subagent_id). The file tools have nothing
 * to hand back, and an MCP tool has no such concept — asking would be refused.
 */
const DETACHABLE_TOOLS = new Set(["exec_command", "run_subagent"]);

/**
 * Tool names Traces carried before `read_file` absorbed image reading (2026-09-02): their
 * image argument was `source`, previewed here like a file path so an old Trace's card still
 * reads sensibly. Display-only — nothing assembles these tools any more. Removable once
 * Traces written before that date no longer need rendering.
 */
const LEGACY_IMAGE_TOOLS = new Set(["read_image", "describe_image"]);

/** The path-like argument a tool is previewed by: `file_path` for the file tools, `source` for the historical image tools. */
function pathArgument(name: string): string | null {
  if (FILE_TOOLS.has(name)) return "file_path";
  if (LEGACY_IMAGE_TOOLS.has(name)) return "source";
  return null;
}

/**
 * Shortens a path for one-line display: at most one parent directory plus the filename
 * (`…/parent/file.ts`); paths already within that shape are shown as-is (same rule as the
 * CLI's tool-render). The full path stays in the expanded arguments block.
 */
export function shortenPath(p: string): string {
  const segments = p.split("/").filter((s) => s.length > 0);
  if (segments.length <= 2) return p;
  return `…/${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
}

/**
 * Argument preview (same approach as the CLI's tool-render): exec_command shows `$ <cmd>`,
 * the file tools show their shortened file path, other tools show a single-line
 * `name(args)` prefix. Arguments may be incomplete JSON (mid-stream), so extraction is done
 * leniently. The preview deliberately keeps the real arguments (not the model-written
 * description): it heads the approval row, and the user must approve the actual command,
 * not the model's summary of it.
 */
export function previewArguments(name: string, argsJson: string): string {
  if (name === "exec_command") {
    // The schema names `cmd`; core also runs a call carrying the text as `command` (its alias,
    // see core's exec-command.ts), and a call that runs must preview — and be approved — as
    // the command it is.
    const cmd = extractStringField(argsJson, "cmd") ?? extractStringField(argsJson, "command");
    if (cmd !== null) return `$ ${cmd.value.replace(/\s+/g, " ").trim()}`;
  }
  const pathArg = pathArgument(name);
  if (pathArg !== null) {
    const filePath = extractStringField(argsJson, pathArg);
    if (filePath !== null) return shortenPath(filePath.value.replace(/\s+/g, " ").trim());
  }
  return argsJson.replace(/\s+/g, " ").trim();
}

/**
 * Collapsed-header subtitle: the human-readable line next to the tool name — the
 * model-written `description` argument when the call carries one (declared in the tool's
 * config schema; per-tool `call_description: false` removes it, in which case the model
 * never sends it), or the shortened file path for the file tools. Null when there is
 * nothing beyond the raw arguments.
 *
 * The subtitle appears once, fully formed, never mid-stream (#137): a growing description
 * re-solves the header's flex line every frame, and `shortenPath` on a still-growing path
 * rewrites non-monotonically (`/ho` → `…/cc/dev` → `…/dev/x`) — so a field renders only
 * after its closing quote. `settled` (arguments finished streaming) lifts that gate: the
 * text cannot change anymore, which also covers a call that never closed the string
 * (aborted / malformed). Same rule as the CLI's tool-render. The wait is short by
 * construction — `description` is required first in schema order, and `file_path` is the
 * first file-tool argument — while `write_file`'s `content` may stream long after.
 */
export function headerSubtitle(name: string, argsJson: string, settled = true): string | null {
  // The description wins whenever the call carries one: schemas are user-editable, so a
  // file tool may have `description` enabled even though the default schema leaves it out
  // (the CLI derives the same rule from the session's schemas).
  if (DESCRIBED_TOOLS.has(name) || FILE_TOOLS.has(name)) {
    const desc = extractStringField(argsJson, "description");
    if (desc !== null) {
      if (!desc.complete && !settled) return null;
      const line = desc.value.replace(/\s+/g, " ").trim();
      if (line) return line;
    }
    if (DESCRIBED_TOOLS.has(name)) return null;
  }
  const pathArg = pathArgument(name);
  if (pathArg !== null) {
    const filePath = extractStringField(argsJson, pathArg);
    if (filePath !== null) {
      if (!filePath.complete && !settled) return null;
      const line = filePath.value.replace(/\s+/g, " ").trim();
      if (line) return shortenPath(line);
    }
  }
  return null;
}

/**
 * Whether this call was launched with `run_in_background: true` — the argument `exec_command`
 * and `run_subagent` share, and the one that leaves work running after the tool has returned.
 * The row marks those calls the way the session list marks their conversation.
 *
 * Read from the parsed arguments rather than the streamed prefix: the flag is last in both
 * schemas, so it only exists once the call has closed, and an incomplete or malformed argument
 * string simply reads as "not background" — the mark appears with the closing brace.
 */
export function isBackgroundCall(argsJson: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return false;
  }
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as Record<string, unknown>)["run_in_background"] === true
  );
}

/**
 * Whether a call was moved to the background by the user while it was executing: its output
 * carries the note the tool wrote on handing its work back. Read from the output rather than
 * remembered from the click, so the mark survives a reload — the click is nowhere in the
 * Trace, and the note is.
 */
export function isDetachedCall(output: string): boolean {
  return output.includes(DETACHED_TOOL_NOTE_PREFIX);
}

/**
 * How long a call has to have been executing before the header offers "move to background".
 * A call that finishes in a few seconds would otherwise flash the action and drop it again,
 * and the row's right end would jump with every short command; ten seconds is where waiting
 * starts to feel like waiting.
 */
export const BACKGROUND_ACTION_DELAY_MS = 10_000;

/**
 * Whether the header offers "move to background": only while the call is genuinely executing
 * (that is the whole window in which there is something to move) and has been for
 * `BACKGROUND_ACTION_DELAY_MS` (`executedPastDelay`, the card's elapsed-time gate on the
 * execution segment), only for a tool that has a background form, and only on a main-session
 * card — a subagent's call lives in the child Session's environment, which the route does not
 * target.
 *
 * A call launched with `run_in_background` is excluded: its work is already back in the
 * registry, so there is nothing left to hand over, and the row would briefly carry the
 * background glyph twice — once as the action, once as the mark that call already wears.
 */
export function showsBackgroundAction(
  name: string,
  argsJson: string,
  executing: boolean,
  origin: readonly string[],
  executedPastDelay: boolean,
): boolean {
  return (
    executing &&
    executedPastDelay &&
    origin.length === 0 &&
    DETACHABLE_TOOLS.has(name) &&
    !isBackgroundCall(argsJson)
  );
}

/**
 * Decoded file-tool payload for the pending-approval block: the user is approving a
 * concrete rewrite (old_string/new_string/content), so the bare path is not enough — the
 * actual arguments are rendered in the scrollable expanded style while the call is PENDING.
 * Null for other tools or unparseable arguments (arguments are complete by approval time).
 */
export function pendingFilePayload(name: string, argsJson: string): string | null {
  if (!FILE_TOOLS.has(name)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const args = parsed as Record<string, unknown>;
  const sections: string[] = [];
  const push = (label: string, value: unknown): void => {
    if (value === undefined) return;
    if (typeof value === "string" && value.includes("\n")) {
      sections.push(`${label}:\n${value}`);
    } else {
      sections.push(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  };
  push("file_path", args["file_path"]);
  if (name === "read_file") {
    push("offset", args["offset"]);
    push("limit", args["limit"]);
    // The image branch's question is sent to the vision model, so it is part of what is approved.
    push("prompt", args["prompt"]);
  } else if (name === "edit_file") {
    push("old_string", args["old_string"]);
    push("new_string", args["new_string"]);
    if (args["replace_all"] === true) push("replace_all", true);
  } else if (name === "write_file") {
    push("content", args["content"]);
  }
  return sections.join("\n");
}

/** A string field read from possibly-incomplete JSON: the value seen so far, and whether its closing quote has arrived (mirrors the CLI's PartialField). */
interface PartialField {
  value: string;
  complete: boolean;
}

/** Extracts the current value of a string field from a possibly-incomplete JSON object string (a simplified version, good enough for preview purposes). */
function extractStringField(argsJson: string, field: string): PartialField | null {
  const key = `"${field}"`;
  const keyIndex = argsJson.indexOf(key);
  if (keyIndex === -1) return null;
  let i = keyIndex + key.length;
  while (/\s/.test(argsJson[i] ?? "")) i += 1;
  if (argsJson[i] !== ":") return null;
  i += 1;
  while (/\s/.test(argsJson[i] ?? "")) i += 1;
  if (argsJson[i] !== '"') return null;
  i += 1;
  let out = "";
  let escaped = false;
  for (; i < argsJson.length; i += 1) {
    const ch = argsJson[i]!;
    if (escaped) {
      out += ch === "n" ? "\n" : ch === "t" ? "\t" : ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') return { value: out, complete: true };
    out += ch;
  }
  return { value: out, complete: false };
}

export function SessionToolCall({ item, ctx }: { item: ToolCallItem; ctx: StreamRenderContext }) {
  const { toolAliases } = useTheme();
  // Matched by the current origin chain + toolCallId: prevents parent/child session tool_call_id collisions from lighting each other up.
  const pending = ctx.pendingApprovals.get(approvalKey(ctx.origin, item.toolCallId));

  // Display-only, and confined to the name props below: every name-keyed decision on this card
  // (DESCRIBED_TOOLS, FILE_TOOLS, the argument previews, the subagent chip) and everywhere else in
  // the app (the tools config table, permission rules, the Trace viewer) keeps reading
  // `item.name`, so an alias can never change what a call means.
  const displayName = toolDisplayName(item.name, toolAliases);
  // Escape sequences are stripped at render time only (the stored stream/trace data keeps its
  // raw bytes): hardened child envs should no longer produce any, but historical traces and
  // force-color programs still can (#102). Memoized — the aggregated output can be large and
  // grows on every streamed delta.
  const output = useMemo(() => stripAnsi(item.output), [item.output]);
  // Executing = the call has finished streaming, output hasn't arrived yet, and it's not waiting on approval (approval wait time doesn't count toward execution).
  const executing = item.callComplete && !item.outputComplete && !pending;
  // Whether the execution segment has run long enough for the "move to background" action (one
  // re-render at that moment, none before or after). Local-first on the start time: this end's
  // own answer time is there the instant the pending approval clears, while the server's
  // approvalAtMs is still a broadcast away, so falling straight back to callStartedAtMs in that
  // window would count the human wait as execution and then restart the gate once the event
  // lands. Local-first also keeps the value from ever moving again, and it is the clock the
  // gate compares against.
  const executedPastDelay = useElapsedPast(
    executing ? (item.localApprovalAtMs ?? item.approvalAtMs ?? item.callStartedAtMs) : undefined,
    BACKGROUND_ACTION_DELAY_MS,
  );
  // Argument-generation segment (settled): the live execution timer accumulates on top of this as a baseline, so the displayed duration doesn't shrink back once output arrives.
  const genMs =
    item.argStartedAtMs !== undefined && item.callStartedAtMs !== undefined
      ? Math.max(0, item.callStartedAtMs - item.argStartedAtMs)
      : 0;
  const failed =
    (item.callStopReason !== undefined && item.callStopReason !== "completed") ||
    (item.outputStopReason !== undefined && item.outputStopReason !== "completed");
  const state: RunState = pending
    ? "waiting"
    : executing || item.callStreaming
      ? "running"
      : failed
        ? "failed"
        : "done";
  // Decision wording ("Approved · manual", "Denied · manual", …): carried ONLY by the status
  // icon's title/aria-label — per review the row shows no visible decision text at any
  // breakpoint; the icon is the single source of truth for how the call was decided.
  const decisionText = item.decision
    ? `${item.decision === "allow" ? S.chat.decisionAllow : S.chat.decisionDeny} · ${
        item.decision === "forbidden"
          ? S.chat.decisionPolicy
          : item.decisionSource === "manual"
            ? S.chat.decisionManual
            : S.chat.decisionAuto
      }`
    : null;
  // A denial reports stop_reason "aborted" on the output it feeds back — a person's "deny"
  // and the command policy's "forbidden" alike; that abort IS the decision, so the icon
  // reads "Denied · …" (the label's second half names the decider) rather than falling
  // through to the raw stop reason. A user-abort of a RUNNING tool carries no deny
  // decision, so the label falls through to its stop reason below.
  const denied =
    (item.decision === "deny" || item.decision === "forbidden") &&
    item.outputStopReason === "aborted";
  const stateLabel = pending
    ? S.chat.approvalWaiting
    : state === "running"
      ? S.chat.workRunning
      : state === "done"
        ? (decisionText ?? S.chat.workDone)
        : denied
          ? (decisionText ?? undefined)
          : (item.outputStopReason ?? item.callStopReason);
  // Total duration = argument generation + execution, excluding the approval wait: settled once
  // known; while executing, a live segment from the approval grant (or from call completion when
  // no approval was needed) on top of the generation baseline; while waiting on approval, frozen
  // at the settled generation segment; while the arguments stream, a live clock from their start
  // (an ellipsis when no start time is known).
  const duration: ToolCallDuration | undefined =
    item.durationMs !== undefined
      ? { live: false, ms: item.durationMs }
      : executing
        ? { live: true, sinceMs: item.approvalAtMs ?? item.callStartedAtMs, offsetMs: genMs }
        : pending
          ? genMs > 0
            ? { live: false, ms: genMs }
            : undefined
          : item.callStreaming
            ? { live: true, sinceMs: item.argStartedAtMs }
            : undefined;
  const sendToBackground = ctx.onSendToBackground;

  return (
    <ToolCallCard
      state={state}
      stateLabel={stateLabel}
      name={displayName || S.chat.unknownTool}
      // The tool's own name stays one hover away, for matching a Trace or writing a permission
      // rule; when nothing was aliased the tooltip would only repeat the visible text.
      nameTooltip={displayName === item.name ? undefined : item.name}
      // Settled once argument streaming stopped (or the complete call arrived): the subtitle's
      // completeness gate is lifted — whatever is there is final.
      subtitle={headerSubtitle(item.name, item.argumentsText, !item.callStreaming)}
      duration={duration}
      // A call made with run_in_background, or moved there: the row says where its work went.
      marker={
        isBackgroundCall(item.argumentsText) || isDetachedCall(item.output)
          ? S.chat.backgroundCall
          : undefined
      }
      // "Send to background" once the call has been executing for a while: the tool hands its
      // work back as a background task and the turn carries on. No click guard: a second detach
      // is a no-op on an already-fired controller, and once the call closes the action unmounts
      // on its own — which is also the feedback.
      action={
        sendToBackground !== undefined &&
        showsBackgroundAction(
          item.name,
          item.argumentsText,
          executing,
          ctx.origin,
          executedPastDelay,
        )
          ? {
              label: S.chat.sendToBackground,
              hint: S.chat.sendToBackgroundHint,
              onClick: () => void sendToBackground(item.toolCallId),
            }
          : undefined
      }
      pending={
        pending
          ? {
              preview: previewArguments(item.name, item.argumentsText),
              payload: pendingFilePayload(item.name, item.argumentsText),
              onDecide: (decision) => ctx.onApprove(item.toolCallId, decision, ctx.origin),
              labels: { allow: S.chat.approve, deny: S.chat.deny },
            }
          : undefined
      }
      argumentsText={item.argumentsText}
      output={output}
      outputStreaming={item.outputStreaming}
      images={
        item.images && item.images.length > 0
          ? { srcs: item.images, alt: S.chat.toolImageAlt }
          : undefined
      }
      // A bound subagent: a shortcut row into the subagents panel, shown whatever the card's
      // collapsed state (the nested conversation itself no longer renders inline).
      footer={
        item.subagent ? (
          <SessionSubagentChip
            sessionId={item.subagentSessionId ?? ""}
            model={item.subagent}
            running={!item.outputComplete}
            agentId={agentIdFromRunSubagentArgs(item.argumentsText)}
            ctx={ctx}
          />
        ) : undefined
      }
    />
  );
}
