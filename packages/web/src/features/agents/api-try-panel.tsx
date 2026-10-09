/**
 * The API tab's Try it section, for the Project owner: an input (the example question to start
 * with) and Run, which sends one real API run through the try route — the owner's sign-in in
 * place of a key, the runs route's handler behind it — and shows its stream as a program would
 * receive it: the Session it named, the result line and the answer once `run.done` arrives, and
 * the events, readable or as the raw `data:` lines.
 *
 * Running again continues the same Session, as a program does with `session_id`; New
 * conversation starts over. Stop asks the Session's abort route, so the stream still ends with
 * its `run.done`; an approval the Agent's API approval mode asks for is answered on its line.
 * Leaving the tab mid-run closes the connection, which aborts the run on the server.
 *
 * `ApiTryView` is the section for one state, with no state of its own; the reducer and the
 * driver behind `ApiTryPanel` live in api-try-log.ts.
 */
import { useEffect, useReducer, useRef } from "react";
import type { KeyboardEvent } from "react";
import {
  Button,
  CopyButton,
  Count,
  Input,
  RuledSection,
  Segmented,
  toastError,
} from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  answerApproval,
  initialTryState,
  rawLines,
  reduceTry,
  runTry,
  stopTry,
  tryBody,
} from "./api-try-log";
import type { TryEntry, TryState, TryView } from "./api-try-log";

export interface ApiTryViewProps {
  input: string;
  running: boolean;
  sessionId: string | null;
  entries: TryEntry[];
  view: TryView;
  result: TryState["result"];
  error: TryState["error"];
  /** The body ended before `run.done`. */
  broken: boolean;
  /** `[DONE]` arrived: the raw view ends with it. */
  closed: boolean;
  /** Nothing can run (the admin has the Agent API off); `disabledReason` says why. */
  disabled: boolean;
  disabledReason?: string;
  onInput: (text: string) => void;
  onRun: () => void;
  onStop: () => void;
  onNewSession: () => void;
  onView: (view: TryView) => void;
  onApprove: (toolCallId: string, decision: "allow" | "deny") => void;
}

/** One labelled value of the result line: the label muted, the value bold. */
function Stat({
  label,
  children,
  tooltip,
  mono = false,
}: {
  label: string;
  children: string;
  tooltip?: string;
  mono?: boolean;
}) {
  return (
    <span className="text-xs">
      <span className="text-fg-muted">{label}</span>{" "}
      <span
        data-tooltip={tooltip}
        className={`font-semibold tabular-nums ${mono ? "font-mono" : ""}`}
      >
        {children}
      </span>
    </span>
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
  const events = p.entries.reduce((n, e) => n + e.count, 0);
  const showLog = p.running || p.entries.length > 0 || p.broken;
  return (
    <RuledSection title={S.agent.apiTry}>
      <div className="space-y-4">
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

        {p.sessionId !== null && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-xs text-fg-muted">session_id</span>
            <span className="min-w-0 break-all font-mono text-sm font-semibold">{p.sessionId}</span>
            <CopyButton
              text={p.sessionId}
              label={S.agent.apiCopy("session_id")}
              size="sm"
              className="shrink-0"
            />
            <Button size="sm" variant="ghost" disabled={p.running} onClick={p.onNewSession}>
              {S.agent.apiTryNewSession}
            </Button>
          </div>
        )}

        {run !== undefined && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <Stat label={S.agent.apiTryStatus} mono>
              {run.status}
            </Stat>
            <Stat label={S.agent.apiTryRequests}>{String(run.requests)}</Stat>
            <Stat
              label={S.agent.apiTryTokens}
              tooltip={S.agent.apiTryCacheTokens(run.usage.cache_read, run.usage.cache_write)}
            >
              {`${run.usage.output} / ${run.usage.total}`}
            </Stat>
            {p.result !== null && p.result.elapsedMs !== null && (
              <Stat
                label={S.agent.apiTryElapsed}
              >{`${(p.result.elapsedMs / 1000).toFixed(1)} s`}</Stat>
            )}
          </div>
        )}

        {run !== undefined && run.text !== "" && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg-muted">{S.agent.apiTryAnswer}</p>
            <div className="whitespace-pre-wrap break-words rounded-lg border border-line px-4 py-3 text-sm">
              {run.text}
            </div>
          </div>
        )}

        {p.error !== null && (
          <p className={`text-xs ${toneInk.danger}`}>
            {`${p.error.status} ${p.error.code} — ${p.error.message}`}
          </p>
        )}

        {showLog && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-fg-muted">{S.agent.apiTryEvents}</span>
                <Count n={events} />
              </span>
              <div className="w-40 shrink-0">
                <Segmented
                  cols={2}
                  options={[
                    { value: "events", label: S.agent.apiTryEvents },
                    { value: "raw", label: S.agent.apiTryRaw },
                  ]}
                  value={p.view}
                  onChange={p.onView}
                />
              </div>
            </div>
            {p.view === "events" ? (
              <ol className="space-y-1 font-mono text-xs">
                {p.entries.map((entry) => {
                  const approval = entry.approval;
                  return (
                    <li
                      key={entry.id}
                      data-testid="api-try-event"
                      className="flex flex-wrap items-baseline gap-x-2"
                    >
                      <span className="font-semibold">{entry.type}</span>
                      {entry.count > 1 && <span className="text-fg-muted">×{entry.count}</span>}
                      <span className="min-w-0 break-all text-fg-muted">{entry.summary}</span>
                      {approval?.pending === true && (
                        <span className="flex gap-1 font-sans">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => p.onApprove(approval.toolCallId, "allow")}
                          >
                            {S.chat.approve}
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => p.onApprove(approval.toolCallId, "deny")}
                          >
                            {S.chat.deny}
                          </Button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <pre className="max-h-96 overflow-auto font-mono text-xs leading-5">
                {rawLines({ entries: p.entries, closed: p.closed }).join("\n")}
              </pre>
            )}
            {p.broken && (
              <p className={`mt-2 text-xs ${toneInk.danger}`}>{S.agent.apiTryStreamBroken}</p>
            )}
          </div>
        )}
      </div>
    </RuledSection>
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
      entries={state.entries}
      view={state.view}
      result={state.result}
      error={state.error}
      broken={state.broken}
      closed={state.closed}
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
      onApprove={(toolCallId, decision) => {
        if (state.sessionId === null) return;
        answerApproval(state.sessionId, toolCallId, decision, dispatch).catch((e: unknown) =>
          toastError(apiErrorText(e)),
        );
      }}
    />
  );
}
