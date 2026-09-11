/**
 * Tool call card: collapses to a single line by
 * default — status icon + tool name + duration (a live-ticking timer while running) + a plain
 * `[stop reason]` marker when the step did not finish cleanly; clicking expands full arguments
 * and output; a bound subagent renders as a full-width shortcut row below them regardless of
 * collapsed state (the child conversation itself lives in the subagents side panel; the row
 * carries its own pending-approval dot, so the card no longer needs to auto-expand for nested
 * approvals).
 *
 * Duration accounting = **argument-generation segment + execution segment** (excludes time
 * spent waiting on human approval): the model streaming out arguments token by token is often
 * slower than the tool call itself, so reporting only the execution segment would badly
 * understate this step's cost. While waiting on approval, the already-settled generation
 * segment is shown; the wait itself is marked by the amber hourglass icon alone, since the
 * approval block below the row is always on screen and names the tool and its arguments.
 */
import { useMemo, useRef, useState } from "react";
import { DETACHED_TOOL_NOTE_PREFIX } from "@prismshadow/penguin-core/interfaces";
import { S } from "../../lib/strings";
import { humanizeDuration } from "../../lib/format";
import { toolDisplayName } from "../../lib/tool-alias";
import { stripAnsi } from "../../lib/strip-ansi";
import { approvalKey } from "../../lib/omni/stream-model";
import type { ToolCallItem } from "../../lib/omni/stream-model";
import { Chevron } from "../../components/ui/chevron";
import {
  DISCLOSURE_OUTPUT_PRE_CLASS,
  DISCLOSURE_ROW_CLASS,
  DISCLOSURE_ROW_STICKY_CLASS,
} from "./disclosure-row";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { toneInk } from "../../lib/tone";
import { StatusIcon } from "../../components/ui/status-icon";
import type { RunState } from "../../components/ui/status-icon";
import { ApprovalButtons } from "./approval-buttons";
import { LiveDuration } from "./live-duration";
import { useTheme } from "../../state/theme";
import { agentIdFromRunSubagentArgs } from "./agent-topology";
import { SubagentChip } from "./subagent-chip";
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
 * Whether the header offers "move to background": only while the call is genuinely executing
 * (that is the whole window in which there is something to move), only for a tool that has a
 * background form, and only on a main-session card — a subagent's call lives in the child
 * Session's environment, which the route does not target.
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
): boolean {
  return (
    executing && origin.length === 0 && DETACHABLE_TOOLS.has(name) && !isBackgroundCall(argsJson)
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

export function ToolCallCard({ item, ctx }: { item: ToolCallItem; ctx: StreamRenderContext }) {
  const [open, setOpen] = useState(false);
  const userToggled = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { toolAliases } = useTheme();
  // Matched by the current origin chain + toolCallId: prevents parent/child session tool_call_id collisions from lighting each other up.
  const pending = ctx.pendingApprovals.get(approvalKey(ctx.origin, item.toolCallId));

  const preview = previewArguments(item.name, item.argumentsText);
  // Display-only, and confined to the two render expressions below: every name-keyed
  // decision on this card (DESCRIBED_TOOLS, FILE_TOOLS, the argument previews, the subagent
  // chip) and everywhere else in the app (the tools config table, permission rules, the
  // Trace viewer) keeps reading `item.name`, so an alias can never change what a call means.
  const displayName = toolDisplayName(item.name, toolAliases);
  // The tool's own name stays one hover away, for matching a Trace or writing a permission
  // rule; when nothing was aliased the tooltip would only repeat the visible text.
  const nameTitle = displayName === item.name ? undefined : item.name;
  // Escape sequences are stripped at render time only (the stored stream/trace data keeps its
  // raw bytes): hardened child envs should no longer produce any, but historical traces and
  // force-color programs still can (#102). Memoized — the aggregated output can be large and
  // grows on every streamed delta.
  const output = useMemo(() => stripAnsi(item.output), [item.output]);
  // Settled once argument streaming stopped (or the complete call arrived): the subtitle's
  // completeness gate is lifted — whatever is there is final.
  const subtitle = headerSubtitle(item.name, item.argumentsText, !item.callStreaming);
  // Executing = the call has finished streaming, output hasn't arrived yet, and it's not waiting on approval (approval wait time doesn't count toward execution).
  const executing = item.callComplete && !item.outputComplete && !pending;
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
  // Decision wording ("Approved · manual", "Denied · manual", …): carried ONLY by the left status
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
  // Shared by the row and the chevron beside it: two buttons, one disclosure. Collapsing
  // while the row is stuck lands the view back on the row.
  const toggleOpen = (): void => {
    userToggled.current = true;
    const willClose = open;
    setOpen((v) => !v);
    if (willClose) {
      requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }));
    }
  };
  const stateLabel = pending
    ? S.chat.approvalWaiting
    : state === "running"
      ? S.chat.workRunning
      : state === "done"
        ? (decisionText ?? S.chat.workDone)
        : denied
          ? (decisionText ?? undefined)
          : (item.outputStopReason ?? item.callStopReason);

  return (
    <div ref={rootRef}>
      {/* Collapsed row: status icon + tool name + total duration (generation + execution,
          excluding approval wait) + the stop reason when the step did not finish cleanly.
          Expand chevron on the right.

          Stacked sticky, second level (same as the thinking row): while this card's expanded
          output scrolls, the row pins right BELOW the stuck group header (top-4 = the
          header's -top-4 offset + its 2rem height) — the bar directly above the content is
          always the section the reader is in, never a skipped level. Opaque background for
          the stuck state; collapsing from stuck lands the view back on the row.

          The row spells out NO stop reason: it rendered `[reason]` markers (and before that,
          Badge pills) until per-user-feedback review removed them — the red text read as
          alarming repetition of what the left StatusIcon already signals. The icon plus its
          title/aria stateLabel (which still names the raw reason) is the single carrier of
          the outcome, same rule the decision wording above already follows. The known cost,
          accepted deliberately: at a glance an aborted, timed-out, malformed or auth-failed
          call all read as the icon's one failure tone, and on touch the distinction lives
          only in the expanded output (when one exists) — the tooltip/aria and the Trace
          viewer, which shows the raw stop reason per event, remain where the literal value
          belongs.

          A pending call gets no "awaiting approval" text either: the approval block below is
          always on screen while one is pending — it names the tool, shows the arguments and
          carries the Allow/Deny buttons — so the row would only repeat it. The amber hourglass
          StatusIcon (labeled) marks the wait, at every breakpoint. */}
      <div className={`${DISCLOSURE_ROW_STICKY_CLASS} ${DISCLOSURE_ROW_CLASS}`}>
        <button
          type="button"
          aria-expanded={open}
          onClick={toggleOpen}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
        >
          <StatusIcon state={state} label={stateLabel} />
          <span
            title={nameTitle}
            className="shrink-0 truncate font-mono text-xs font-semibold text-gray-700 dark:text-gray-300"
          >
            {displayName || S.chat.unknownTool}
          </span>
          {/* Human-readable subtitle: the model-written call description (command/subagent tools) or the file path (file tools). */}
          {subtitle && (
            <span className="min-w-0 shrink truncate text-xs text-gray-500 dark:text-gray-400">
              {subtitle}
            </span>
          )}
          <span className="shrink-0 font-mono text-xs text-gray-500 dark:text-gray-400">
            {item.durationMs !== undefined ? (
              humanizeDuration(item.durationMs)
            ) : executing ? (
              // Execution timer: argument-generation baseline + a live segment starting from approval grant (or from call completion if no approval was needed).
              <LiveDuration sinceMs={item.approvalAtMs ?? item.callStartedAtMs} offsetMs={genMs} />
            ) : pending ? (
              // No ticking while waiting on approval: frozen at the settled argument-generation segment.
              genMs > 0 ? (
                humanizeDuration(genMs)
              ) : null
            ) : item.callStreaming ? (
              // Generating arguments: live-ticking timer (falls back to a pulsing ellipsis when no start time is known).
              item.argStartedAtMs !== undefined ? (
                <LiveDuration sinceMs={item.argStartedAtMs} />
              ) : (
                <span className="animate-pulse">…</span>
              )
            ) : null}
          </span>
          {/* Right of the duration, on a call made with run_in_background or moved there:
            a bracketed marker in the row's own mono type, the shape this row already used
            for an outcome that needs a word. A glyph here would be the session list's
            count-of-many mark doing duty for a single call, and it would say nothing to a
            reader who cannot spend a hover on it. It sits after the duration rather than
            beside the name so it never competes with the truncating subtitle, and the row's
            own status icon keeps saying what the CALL did — this says where its work went. */}
          {(isBackgroundCall(item.argumentsText) || isDetachedCall(item.output)) && (
            <span className={`shrink-0 font-mono text-xs ${toneInk.muted}`}>
              {S.chat.backgroundCall}
            </span>
          )}
          <span className="min-w-0 flex-1" />
        </button>
        {/* "Send to background" while the call executes: the tool hands its work back as a
          background task and the turn carries on. A sibling of the row button rather than a
          child — a <button> cannot nest another — with the hover tint on the whole row, so the
          two still read as one line. The app's inline text-action style: a real <button>
          (it acts, it navigates nowhere) painted as a link. Text at the row's own size and
          NO padding of its own, so a row carrying it measures exactly like one that does not
          — an action that changed the row's height would break the rhythm of a list of calls.

          No click guard: a second detach is a no-op on an already-fired controller, and once
          the call closes the action unmounts on its own — which is also the feedback. */}
        {showsBackgroundAction(item.name, item.argumentsText, executing, ctx.origin) &&
          ctx.onSendToBackground && (
            <button
              type="button"
              title={S.chat.sendToBackgroundHint}
              onClick={() => void ctx.onSendToBackground?.(item.toolCallId)}
              className="shrink-0 text-xs text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
            >
              {S.chat.sendToBackground}
            </button>
          )}
        {/* Expand indicator on the right; clicking it toggles too (it is its own button, so the
          row's action above stays reachable). Named for what it DOES, the way every other
          chevron toggle here is: naming it after the tool would give the row two buttons under
          one name, which no row-scoped query could then tell apart. */}
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? S.nav.collapseGroup : S.nav.expandGroup}
          onClick={toggleOpen}
          className="flex shrink-0 items-center self-stretch"
        >
          <Chevron open={open} className="text-gray-400" />
        </button>
      </div>

      {/* Pending approval: always visible regardless of collapsed state — shows the tool name and arguments so the user knows what they're approving. */}
      {pending && (
        <div className="border-t border-gray-100 bg-amber-50 px-3 py-2 dark:border-gray-800 dark:bg-amber-950/30">
          {/* The user must be able to read the FULL command before deciding: below sm the
              preview wraps in whole (expanded-args style: pre-wrap + break-all, no inner
              scroll, the block may grow) — the one-line treatment resumes once decided, since
              this pending block unmounts and only the truncating header subtitle remains. At
              ≥sm the row stays one line (the desktop column is wide enough in practice). */}
          <div className="mb-2 flex items-start gap-2 sm:items-center">
            <span
              title={nameTitle}
              className="shrink-0 rounded-md bg-white px-1.5 py-0.5 font-mono text-xs font-semibold text-gray-700 dark:bg-gray-900 dark:text-gray-300"
            >
              {displayName || S.chat.unknownTool}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-gray-600 sm:truncate dark:text-gray-400">
              {preview}
            </span>
          </div>
          {/* File tools: the one-line preview shows only the (shortened) path, but the user is
              approving a concrete rewrite — render the decoded payload (old_string/new_string/
              content) in the scrollable expanded style while pending. */}
          {(() => {
            const payload = pendingFilePayload(item.name, item.argumentsText);
            return payload !== null ? (
              <pre className="mb-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-white/70 px-2 py-1.5 text-xs leading-5 text-gray-700 dark:bg-gray-950/40 dark:text-gray-300">
                {payload}
              </pre>
            ) : null;
          })()}
          <ApprovalButtons
            onDecide={(decision) => ctx.onApprove(item.toolCallId, decision, ctx.origin)}
          />
        </div>
      )}

      {/* Expanded details: full arguments / output */}
      {open && (
        <div className="anim-fade">
          {item.argumentsText && (
            // Arguments are shown as a fully wrapped block (no height cap, no scrollbar): the
            // arguments are key to understanding this call, and tucking them into an inner
            // scroll area would make them hard to read and fight with the message stream's own scroll.
            <pre className="whitespace-pre-wrap break-all border-t border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950/60 dark:text-gray-400">
              {item.argumentsText}
            </pre>
          )}
          {(item.output || item.outputStreaming) && (
            <pre className={DISCLOSURE_OUTPUT_PRE_CLASS}>
              {output}
              {item.outputStreaming && <span className="animate-pulse">▌</span>}
            </pre>
          )}
          {/* Tool output images (e.g. read_file on an image): shown as thumbnails, click to zoom (ZoomableImage). */}
          {item.images && item.images.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
              {item.images.map((src, i) => (
                <ZoomableImage
                  key={i}
                  src={src}
                  alt={S.chat.toolImageAlt}
                  className="max-h-40 max-w-full rounded-md border border-gray-200 dark:border-gray-700"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Subagent row: always visible (unaffected by the tool card's collapsed state) below the expanded arguments/output — a full-width shortcut bar into the subagents panel; the nested conversation no longer renders inline. */}
      {item.subagent && (
        <div className="px-3 pb-2 pt-2">
          <SubagentChip
            sessionId={item.subagentSessionId ?? ""}
            model={item.subagent}
            running={!item.outputComplete}
            agentId={agentIdFromRunSubagentArgs(item.argumentsText)}
            ctx={ctx}
          />
        </div>
      )}
    </div>
  );
}
