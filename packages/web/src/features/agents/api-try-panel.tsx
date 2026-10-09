/**
 * The API tab's Try it section, for the Project owner: one framed block holding the question and
 * Run, and under them the output. Run sends one real API run through the try route — the owner's
 * sign-in in place of a key, the runs route's handler behind it — and the output shows its stream
 * as a program would receive it.
 *
 * The output is one box in two views, switched in its header beside the Session the run named:
 * Rendered, one numbered row per item or event — an item's fragments merged into the content
 * they add up to, the answer included — and Raw, one numbered line per `data:` payload exactly
 * as received, scrolling sideways rather than wrapping. Both views share the box's height and
 * scroll inside it. The strip under them names the run's outcome: the status, the Request count,
 * the output and total tokens, the cache-read and cache-write tokens when there are any, and the
 * elapsed time; or, in the danger tone, why there is none.
 *
 * Running again continues the same Session, as a program does with `session_id`; New
 * conversation starts over. Stop asks the Session's abort route, so the stream still ends with
 * its `run.done`; an approval the Agent's API approval mode asks for is answered on its row.
 * Leaving the tab mid-run closes the connection, which aborts the run on the server.
 *
 * `ApiTryView` is the section for one state, with no state of its own; the reducer and the
 * driver behind `ApiTryPanel` live in api-try-log.ts.
 */
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  ApprovalButtons,
  Button,
  Card,
  CopyButton,
  Input,
  Segmented,
  StreamingCaret,
  Text,
  toastError,
} from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  answerApproval,
  initialTryState,
  rawLines,
  reduceTry,
  rowLabel,
  runTry,
  stopTry,
  tryBody,
} from "./api-try-log";
import type { TryEventRow, TryField, TryItemRow, TryRow, TryState, TryView } from "./api-try-log";

export interface ApiTryViewProps {
  input: string;
  running: boolean;
  sessionId: string | null;
  /** The rendered view's rows. */
  rows: TryRow[];
  /** The raw view's lines: every payload as received, `[DONE]` last once it came. */
  lines: string[];
  view: TryView;
  result: TryState["result"];
  error: TryState["error"];
  /** The body ended before `run.done`. */
  broken: boolean;
  /** Nothing can run (the admin has the Agent API off); `disabledReason` says why. */
  disabled: boolean;
  disabledReason?: string;
  onInput: (text: string) => void;
  onRun: () => void;
  onStop: () => void;
  onNewSession: () => void;
  onView: (view: TryView) => void;
  /** Answers an approval; its buttons stay disabled until the answer settles. */
  onApprove: (toolCallId: string, decision: "allow" | "deny") => Promise<void>;
}

/** One labelled value of the outcome strip: the label muted, the value bold. */
function Stat({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: string;
  mono?: boolean;
}) {
  return (
    <span>
      <span className="text-fg-muted">{label}</span>{" "}
      <span className={`font-semibold tabular-nums ${mono ? "font-mono" : ""}`}>{children}</span>
    </span>
  );
}

/**
 * The output's scroll box, one for both views, so switching keeps the box where it is; each view
 * opens at its top. While the reader is at the end it stays there as the content grows — rows
 * arriving, a row filling in, text re-wrapping once a font lands — and a reader who scrolled up
 * to read is left where they are.
 */
function OutputBody({ view, children }: { view: TryView; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  /** Where the box last scrolled itself: only a reader going above it leaves the end. */
  const placed = useRef(0);
  const shownView = useRef(view);
  useLayoutEffect(() => {
    const el = box.current;
    if (shownView.current === view || el === null) return;
    shownView.current = view;
    el.scrollTop = 0;
    placed.current = 0;
    atEnd.current = el.scrollHeight <= el.clientHeight;
  }, [view]);
  useEffect(() => {
    const el = box.current;
    const inner = content.current;
    if (el === null || inner === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!atEnd.current) return;
      el.scrollTop = el.scrollHeight;
      placed.current = el.scrollTop;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={box}
      data-testid="api-try-output"
      onScroll={(e) => {
        const el = e.currentTarget;
        // The box's own scroll can land after more rows came in, short of the new end: that is
        // not the reader leaving it. Going back up is.
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 16) atEnd.current = true;
        else if (el.scrollTop < placed.current - 1) atEnd.current = false;
      }}
      className="max-h-[32rem] overflow-auto border-t border-[color:inherit] bg-canvas"
    >
      <div ref={content}>{children}</div>
    </div>
  );
}

/**
 * The line number in front of a row or a raw line, in the code gutter's ink. It stays put while
 * a raw line scrolls sideways, and a selection never picks it up.
 */
const GUTTER =
  "sticky left-0 min-w-[3ch] select-none bg-canvas pl-3 pr-3 text-right font-mono text-xs leading-5 tabular-nums text-[var(--ui-code-gutter)]";

/** A tool call's arguments, indented when they parse; as received while they do not yet. */
function prettyArguments(text: string): string {
  if (text.trim() === "") return "";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * Name/value pairs as one run of text: the names muted, the values bold. Inline, so a long value
 * (a list of tool names, an error message) carries on after the short ones and wraps as prose.
 */
function fieldLine(fields: readonly TryField[], after?: ReactNode) {
  return (
    <p className="break-words font-mono text-xs leading-5">
      {fields.map((field, i) => (
        <span key={i} className="mr-3">
          {field.name !== undefined && <span className="text-fg-muted">{field.name} </span>}
          <span className={field.quiet === true ? "text-fg-muted" : "font-semibold text-fg"}>
            {field.value}
          </span>
        </span>
      ))}
      {after}
    </p>
  );
}

/** A merged item's content: prose in the text face, arguments and output in mono. */
function itemContent(row: TryItemRow, live: boolean) {
  const caret = live && row.open ? <StreamingCaret /> : null;
  const tags =
    row.tags.length > 0 ? (
      <span className="mr-2 font-mono text-xs text-fg-muted">{row.tags.join(" ")}</span>
    ) : null;
  switch (row.item) {
    case "text":
    case "thinking":
    case "summary":
      return (
        <p
          className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${
            row.item === "text" ? "text-fg" : "text-fg-muted"
          }`}
        >
          {tags}
          {row.text}
          {caret}
        </p>
      );
    case "tool_call": {
      const args = prettyArguments(row.text);
      return (
        <div className="font-mono text-xs leading-5">
          <p className="break-words">
            {tags}
            <span className="font-semibold text-fg">{row.name}</span>
            {args === "" && caret}
          </p>
          {args !== "" && (
            <pre className="whitespace-pre-wrap break-words text-fg-muted">
              {args}
              {caret}
            </pre>
          )}
        </div>
      );
    }
    case "tool_result":
      return (
        <div className="font-mono text-xs leading-5">
          {(tags !== null || row.images !== undefined) && (
            <p>
              {tags}
              {row.images !== undefined && (
                <span className="text-fg-muted">
                  images <span className="font-semibold text-fg">{row.images}</span>
                </span>
              )}
            </p>
          )}
          {/* The output's closing newline would read as an empty line. */}
          <pre className="whitespace-pre-wrap break-words">
            {row.text.replace(/\n+$/, "")}
            {caret}
          </pre>
        </div>
      );
    default:
      // Inline media and image inputs: what they are and how big, never the bytes.
      return fieldLine(
        [
          ...row.tags.map((tag) => ({ value: tag, quiet: true })),
          ...(row.media !== undefined
            ? [{ value: row.media.mime }, { value: formatBytes(row.media.bytes) }]
            : [{ value: row.text }]),
        ],
        caret,
      );
  }
}

/**
 * A standalone event's content: its key fields, and under them, while an approval waits, the
 * conversation view's own Allow and Deny.
 */
function eventContent(row: TryEventRow, onApprove: ApiTryViewProps["onApprove"]) {
  const approval = row.approval;
  return (
    <>
      {fieldLine(row.fields)}
      {approval?.pending === true && (
        <div className="mt-2">
          <ApprovalButtons
            labels={{ allow: S.chat.approve, deny: S.chat.deny }}
            onDecide={(decision) => onApprove(approval.toolCallId, decision)}
          />
        </div>
      )}
    </>
  );
}

/** The rendered view: one numbered row per item or event, the label before the content. */
function renderedRows(p: ApiTryViewProps) {
  return (
    <ol className="grid grid-cols-[auto_minmax(0,1fr)] gap-y-2 py-3 pr-3 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
      {p.rows.map((row, i) => (
        <li
          key={row.id}
          data-testid="api-try-row"
          className="col-span-2 grid grid-cols-subgrid items-baseline sm:col-span-3"
        >
          <span aria-hidden className={GUTTER}>
            {i + 1}
          </span>
          <span
            className="font-mono text-xs leading-5 text-fg-muted sm:pr-4"
            data-tooltip={row.origin}
          >
            {row.origin !== undefined && "↳ "}
            {rowLabel(row)}
          </span>
          <div className="col-start-2 min-w-0 sm:col-start-auto">
            {row.kind === "item" ? itemContent(row, p.running) : eventContent(row, p.onApprove)}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The raw view: one numbered line per payload as received, scrolling sideways, never wrapping. */
function rawRows(lines: readonly string[]) {
  return (
    <ol className="grid w-max min-w-full grid-cols-[auto_1fr] py-3 pr-3">
      {lines.map((line, i) => (
        <li key={i} data-testid="api-try-raw-line" className="col-span-2 grid grid-cols-subgrid">
          <span aria-hidden className={GUTTER}>
            {i + 1}
          </span>
          <span className="whitespace-pre font-mono text-xs leading-5">{line}</span>
        </li>
      ))}
    </ol>
  );
}

/** The section as it reads for one state of a run: no state of its own. */
export function ApiTryView(p: ApiTryViewProps) {
  const canRun = !p.disabled && !p.running && p.input.trim() !== "";
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // An IME's Enter commits its composition; it does not run.
    if (e.key === "Enter" && !e.nativeEvent.isComposing && canRun) p.onRun();
  };
  const run = p.result?.run;
  const shown = p.view === "rendered" ? p.rows.length : p.lines.length;
  // Nothing has run yet, or the last run was stopped before it said anything.
  const idle = !p.running && p.rows.length === 0 && p.error === null && !p.broken;
  const notice =
    p.error !== null
      ? `${p.error.status} ${p.error.code} — ${p.error.message}`
      : p.broken
        ? S.agent.apiTryStreamBroken
        : null;

  return (
    // A flush card, the page's box whose bands run edge to edge: the theme draws its frame as it
    // draws the examples' code blocks above.
    <Card as="section" padding="none">
      {/* The question: what a run does, the input and Run. */}
      <div className="space-y-3 bg-canvas p-4">
        <h2>
          <Text variant="eyebrow" as="span">
            {S.agent.apiTry}
          </Text>
        </h2>
        <p className="text-xs text-fg-muted">{S.agent.apiTryHint}</p>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              size="sm"
              aria-label={S.agent.apiTry}
              value={p.input}
              placeholder={p.sessionId !== null ? S.agent.apiTryFollowUp : S.agent.apiTryExample}
              disabled={p.disabled || p.running}
              onChange={(e) => p.onInput(e.target.value)}
              onKeyDown={onKey}
            />
          </div>
          {p.running ? (
            <Button size="sm" variant="ghost" className="shrink-0" onClick={p.onStop}>
              {S.agent.apiTryStop}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              className="shrink-0"
              disabled={!canRun}
              data-tooltip={p.disabledReason}
              onClick={p.onRun}
            >
              {S.agent.apiTryRun}
            </Button>
          )}
        </div>
      </div>

      {/* The output's header: the Session on the left, the views on the right. One line from sm
          up, so neither a view switch nor a long id pushes the switch down — a narrow box cuts the
          id short, which is whole in its copy button and on the run.started row; below sm the
          Session and the switch take a line each. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[color:inherit] bg-[var(--ui-code-bg)] px-3 py-1.5 sm:flex-nowrap">
        {p.sessionId !== null && (
          <div className="flex min-w-0 items-center gap-x-2">
            <span className="shrink-0 font-mono text-xs text-fg-muted">session_id</span>
            <span className="min-w-0 truncate font-mono text-xs font-semibold">{p.sessionId}</span>
            <CopyButton
              text={p.sessionId}
              label={S.agent.apiCopy("session_id")}
              size="sm"
              className="shrink-0"
            />
            <Button
              size="xs"
              variant="ghost"
              className="shrink-0"
              disabled={p.running}
              onClick={p.onNewSession}
            >
              {S.agent.apiTryNewSession}
            </Button>
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* In both views, so switching never moves the switch. */}
          {p.lines.length > 0 && (
            <CopyButton
              text={p.lines.join("\n")}
              label={S.agent.apiTryCopyRaw}
              size="sm"
              className="shrink-0"
            />
          )}
          <div className="w-32">
            <Segmented
              cols={2}
              options={[
                { value: "rendered", label: S.agent.apiTryRendered },
                { value: "raw", label: S.agent.apiTryRaw },
              ]}
              value={p.view}
              onChange={p.onView}
            />
          </div>
        </div>
      </div>

      {(shown > 0 || p.running || idle) && (
        <OutputBody view={p.view}>
          {shown > 0 ? (
            p.view === "rendered" ? (
              renderedRows(p)
            ) : (
              rawRows(p.lines)
            )
          ) : p.running ? (
            // The request is out; nothing has come back yet.
            <p className="px-4 py-3 text-sm">
              <StreamingCaret />
            </p>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-fg-muted">{S.agent.apiTryEmpty}</p>
          )}
        </OutputBody>
      )}

      {/* The outcome: what run.done reported, or why the stream gave none. */}
      {(run !== undefined || notice !== null) && (
        <div
          data-slot="foot"
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[color:inherit] bg-[var(--ui-code-bg)] px-3 py-1.5 text-xs"
        >
          {notice !== null ? (
            <p className={toneInk.danger}>{notice}</p>
          ) : (
            run !== undefined && (
              <>
                <Stat label={S.agent.apiTryStatus} mono>
                  {run.status}
                </Stat>
                <Stat label={S.agent.apiTryRequests}>{String(run.requests)}</Stat>
                <Stat
                  label={S.agent.apiTryTokens}
                >{`${run.usage.output} / ${run.usage.total}`}</Stat>
                {run.usage.cache_read > 0 && (
                  <Stat label={S.agent.apiTryCacheRead}>{String(run.usage.cache_read)}</Stat>
                )}
                {run.usage.cache_write > 0 && (
                  <Stat label={S.agent.apiTryCacheWrite}>{String(run.usage.cache_write)}</Stat>
                )}
                {p.result !== null && p.result.elapsedMs !== null && (
                  <Stat
                    label={S.agent.apiTryElapsed}
                  >{`${(p.result.elapsedMs / 1000).toFixed(1)} s`}</Stat>
                )}
              </>
            )
          )}
        </div>
      )}
    </Card>
  );
}

/** The section with its run: the state, the connection to close on leaving, the handlers. */
export function ApiTryPanel({
  projectId,
  agentId,
  disabledReason,
}: {
  projectId: string;
  agentId: string;
  /** Set when nothing can run, saying why (the admin has the Agent API off). */
  disabledReason?: string;
}) {
  const [state, dispatch] = useReducer(reduceTry, S.agent.apiTryExample, initialTryState);
  const connection = useRef<AbortController | null>(null);
  // Leaving mid-run closes the connection, and the server aborts the run.
  useEffect(() => () => connection.current?.abort(), []);
  const disabled = disabledReason !== undefined;

  return (
    <ApiTryView
      input={state.input}
      running={state.running}
      sessionId={state.sessionId}
      rows={state.rows}
      lines={rawLines(state)}
      view={state.view}
      result={state.result}
      error={state.error}
      broken={state.broken}
      disabled={disabled}
      disabledReason={disabledReason}
      onInput={(text) => dispatch({ type: "input", text })}
      onRun={() => {
        if (state.running || disabled || state.input.trim() === "") return;
        const controller = new AbortController();
        connection.current = controller;
        void runTry({ projectId, agentId }, dispatch, tryBody(state), controller.signal);
      }}
      onStop={() => {
        stopTry(state, connection.current).catch((e: unknown) => toastError(apiErrorText(e)));
      }}
      onNewSession={() => dispatch({ type: "reset" })}
      onView={(view) => dispatch({ type: "view", view })}
      onApprove={async (toolCallId, decision) => {
        if (state.sessionId === null) return;
        try {
          await answerApproval(state.sessionId, toolCallId, decision, dispatch);
        } catch (e) {
          toastError(apiErrorText(e));
        }
      }}
    />
  );
}
