/**
 * Coding agents: drive external ACP-speaking agents (Claude Code, Codex, Gemini CLI, or any
 * custom command) against a folder on the server machine, and watch their sessions live —
 * text and thinking streams, tool-call cards, permission asks, mode switches.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CodingAgentEvent,
  CodingAgentSaveRequest,
  CodingAgentServerInfo,
  CodingAgentSessionInfo,
} from "@prismshadow/penguin-server/api";
import {
  answerCodingAgentPermission,
  cancelCodingAgentSession,
  createCodingAgentSession,
  promptCodingAgentSession,
  removeCodingAgent,
  saveCodingAgent,
  setCodingAgentMode,
} from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip, type Tone } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Field } from "../../components/ui/field";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { useCodingAgents, useCodingAgentStream } from "./use-coding-agents";

/** The page's own mark, shared by the nav icon and the section rows. */
const BOT_PATH =
  "M12 2.6v2.9M6.5 21h11M6 10.5h12V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8.5ZM9.2 14.6h.01M14.8 14.6h.01M6 10.5a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3";

/** Tool-call status → tone, by meaning (a pending ask reads as waiting on the user). */
const TOOL_TONE: Record<string, Tone> = {
  pending: "attention",
  in_progress: "busy",
  completed: "success",
  failed: "danger",
};

const STOP_LABEL: Record<
  string,
  { label: "turnEnded" | "turnCancelled" | "turnFailed"; tone: Tone }
> = {
  end_turn: { label: "turnEnded", tone: "muted" },
  cancelled: { label: "turnCancelled", tone: "muted" },
  failed: { label: "turnFailed", tone: "danger" },
};

type PermissionRequest = Extract<CodingAgentEvent, { type: "permission_request" }>["request"];
type ToolCallSnapshot = Extract<CodingAgentEvent, { type: "tool_call" }>["call"];

interface TextBlock {
  kind: "assistant" | "thinking";
  text: string;
}

export function CodingAgentsPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const { agents, sessions, loading, loadError, reload } = useCodingAgents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [launchFor, setLaunchFor] = useState<CodingAgentServerInfo | null>(null);
  const [removing, setRemoving] = useState<CodingAgentServerInfo | null>(null);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <GlyphIcon
          d={BOT_PATH}
          size={ICON_SIZE.sectionMark}
          className="text-gray-500 dark:text-gray-400"
        />
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {S.codingAgents.title}
        </h1>
      </div>
      <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{S.codingAgents.description}</p>

      {loadError ? (
        <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
          {S.codingAgents.loadFailed}
        </div>
      ) : null}

      <section className="mb-8">
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {S.codingAgents.agentsTitle}
          </h2>
          {isAdmin ? (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              {S.codingAgents.addAgent}
            </Button>
          ) : null}
        </div>
        {agents.length === 0 && !loading ? (
          <p className="whitespace-pre-line rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            {S.codingAgents.noAgents}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {agents.map((agent) => (
              <li key={agent.id} className="flex min-w-0 items-center gap-2 py-2">
                <GlyphIcon
                  d={BOT_PATH}
                  size={ICON_SIZE.rowLead}
                  className="shrink-0 text-gray-400 dark:text-gray-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-gray-900 dark:text-gray-100">
                    {agent.title ?? agent.id}
                  </div>
                  <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                    {[agent.command, ...agent.args].join(" ")}
                  </div>
                </div>
                <Button size="sm" onClick={() => setLaunchFor(agent)}>
                  {S.codingAgents.newSession}
                </Button>
                {isAdmin ? (
                  <Button size="sm" variant="danger" onClick={() => setRemoving(agent)}>
                    {S.codingAgents.removeAgent}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <SessionsSection
        sessions={sessions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onSettled={reload}
      />

      <AddAgentModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={reload} />
      <LaunchModal agent={launchFor} onClose={() => setLaunchFor(null)} onCreated={reload} />
      <ConfirmModal
        open={removing !== null}
        title={S.codingAgents.removeConfirmTitle}
        confirmLabel={S.codingAgents.removeAgent}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing !== null) {
            void removeCodingAgent(removing.id)
              .then(() => {
                toastSuccess(S.codingAgents.removeAgent);
                reload();
              })
              .catch((e: unknown) => toastError(apiErrorText(e)));
          }
          setRemoving(null);
        }}
      >
        {removing !== null ? S.codingAgents.removeConfirmBody(removing.title ?? removing.id) : ""}
      </ConfirmModal>
    </div>
  );
}

function SessionsSection({
  sessions,
  selectedId,
  onSelect,
  onSettled,
}: {
  sessions: CodingAgentSessionInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSettled: () => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {S.codingAgents.sessionsTitle}
      </h2>
      {sessions.length === 0 ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          {S.codingAgents.noSessions}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 lg:col-span-2">
            {sessions.map((session) => (
              <li key={session.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelect(session.sessionId)}
                  aria-pressed={selectedId === session.sessionId}
                  className={`flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-2 text-left ${
                    selectedId === session.sessionId
                      ? "bg-gray-100 dark:bg-gray-800"
                      : "hover:bg-gray-50 dark:hover:bg-gray-900"
                  }`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                      session.busy ? toneDot.busy : toneDot.muted
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                    {session.agentId} — {session.workspaceDir}
                    <span className="sr-only">
                      {". "}
                      {session.busy ? S.codingAgents.busy : S.codingAgents.idle}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    {session.busy ? S.codingAgents.busy : S.codingAgents.idle}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="lg:col-span-3">
            {selectedId !== null ? (
              <SessionView sessionId={selectedId} onSettled={onSettled} />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/** Fold the event log into render state: merged text blocks + tool calls at latest state. */
function buildTranscript(events: CodingAgentEvent[]): {
  blocks: TextBlock[];
  toolList: ToolCallSnapshot[];
  notices: string[];
  stops: { label: "turnEnded" | "turnCancelled" | "turnFailed"; tone: Tone }[];
  modes: { id: string; name: string }[];
  currentMode: string | null;
  permission: PermissionRequest | null;
} {
  const blocks: TextBlock[] = [];
  const tools = new Map<string, ToolCallSnapshot>();
  const notices: string[] = [];
  const stops: { label: "turnEnded" | "turnCancelled" | "turnFailed"; tone: Tone }[] = [];
  let modes: { id: string; name: string }[] = [];
  let currentMode: string | null = null;
  let permission: PermissionRequest | null = null;
  const resolved = new Set<string>();
  let current: TextBlock | null = null;
  for (const event of events) {
    if (event.type === "message_chunk" || event.type === "thought_chunk") {
      const kind = event.type === "message_chunk" ? "assistant" : "thinking";
      if (current === null || current.kind !== kind) {
        current = { kind, text: event.delta };
        blocks.push(current);
      } else {
        current.text += event.delta;
      }
      continue;
    }
    current = null;
    if (event.type === "tool_call" || event.type === "tool_call_update") {
      const existing = tools.get(event.call.toolCallId);
      tools.set(event.call.toolCallId, { ...(existing ?? {}), ...event.call });
    } else if (event.type === "notice") {
      notices.push(event.message);
    } else if (event.type === "modes") {
      if (event.modes.modes.length > 0) modes = event.modes.modes;
      currentMode = event.modes.currentModeId;
    } else if (event.type === "permission_request") {
      permission = event.request;
    } else if (event.type === "permission_resolved") {
      resolved.add(event.requestId);
    } else if (event.type === "turn_end") {
      stops.push(STOP_LABEL[event.stopReason] ?? { label: "turnEnded", tone: "muted" });
    }
  }
  if (permission !== null && resolved.has(permission.requestId)) permission = null;
  return { blocks, toolList: [...tools.values()], notices, stops, modes, currentMode, permission };
}

function SessionView({ sessionId, onSettled }: { sessionId: string; onSettled: () => void }) {
  const { events, connected, missing } = useCodingAgentStream(sessionId, onSettled);
  const transcript = useMemo(() => buildTranscript(events), [events]);
  const [draft, setDraft] = useState("");
  const [awaitingTurn, setAwaitingTurn] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (events.some((e) => e.type === "turn_end")) setAwaitingTurn(false);
  }, [events]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events.length]);

  const send = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    setAwaitingTurn(true);
    promptCodingAgentSession(sessionId, { text }).catch((e: unknown) => {
      toastError(apiErrorText(e));
      setAwaitingTurn(false);
      setDraft(text);
    });
  };

  if (missing) {
    return (
      <div className={`rounded-md border px-3 py-2 text-sm ${toneStrip.muted}`}>
        {S.codingAgents.sessionGone}
      </div>
    );
  }

  const busy = awaitingTurn;

  return (
    <div className="flex max-h-[70vh] flex-col rounded-md border border-gray-200 dark:border-gray-800">
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {transcript.blocks.map((block, i) =>
          block.kind === "assistant" ? (
            <p
              key={`t${i}`}
              className="whitespace-pre-wrap text-sm text-gray-900 dark:text-gray-100"
            >
              {block.text}
            </p>
          ) : (
            <p
              key={`t${i}`}
              className="whitespace-pre-wrap text-xs italic text-gray-500 dark:text-gray-400"
            >
              {S.codingAgents.thinking}: {block.text}
            </p>
          ),
        )}
        {transcript.toolList.map((call) => (
          <ToolCallCard key={call.toolCallId} call={call} />
        ))}
        {transcript.notices.map((message, i) => (
          <div
            key={`n${i}`}
            className={`rounded-md border px-2.5 py-1.5 text-xs ${toneStrip.attention}`}
          >
            {S.codingAgents.noticeTitle}: {message}
          </div>
        ))}
        {transcript.stops.map((stop, i) => (
          <div key={`s${i}`} className={`text-xs ${toneInk[stop.tone]}`}>
            {S.codingAgents[stop.label]}
          </div>
        ))}
        {transcript.permission !== null ? (
          <div className={`rounded-md border px-2.5 py-2 ${toneStrip.attention}`}>
            <div className="mb-1.5 text-xs font-medium">{S.codingAgents.permissionTitle}</div>
            <div className="mb-2 truncate font-mono text-xs">
              {transcript.permission.toolCall.title}
            </div>
            <div className="flex gap-2">
              {transcript.permission.options.map((option) => (
                <Button
                  key={option.optionId}
                  size="sm"
                  variant={option.kind.startsWith("allow") ? "primary" : "danger"}
                  onClick={() => {
                    const request = transcript.permission;
                    if (request === null) return;
                    void answerCodingAgentPermission(sessionId, request.requestId, {
                      outcome: { outcome: "selected", optionId: option.optionId },
                    }).catch((e: unknown) => toastError(apiErrorText(e)));
                  }}
                >
                  {option.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <div className="border-t border-gray-100 px-3 py-2 dark:border-gray-800">
        {transcript.modes.length > 0 ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {S.codingAgents.modeLabel}
            </span>
            {transcript.modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  void setCodingAgentMode(sessionId, { modeId: mode.id }).catch((e: unknown) =>
                    toastError(apiErrorText(e)),
                  );
                }}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  transcript.currentMode === mode.id
                    ? "border-[var(--accent-bg)] bg-[var(--accent-bg)] text-[var(--accent-fg)]"
                    : "border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                {mode.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <Textarea
            size="sm"
            aria-label={S.codingAgents.composerPlaceholder}
            placeholder={S.codingAgents.composerPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="primary" onClick={send} disabled={draft.trim() === ""}>
              {S.codingAgents.send}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void cancelCodingAgentSession(sessionId).catch(() => undefined)}
            >
              {S.codingAgents.stop}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One tool call as a card row: status dot + title (state spoken in the accessible name), details folded beneath. */
function ToolCallCard({ call }: { call: ToolCallSnapshot }) {
  const tone = TOOL_TONE[call.status] ?? "muted";
  const [open, setOpen] = useState(false);
  const hasDetails =
    call.rawInput !== undefined || (call.output !== undefined && call.output !== "");
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-1.5 px-2.5 py-1.5 text-left"
      >
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
          <span className="sr-only">{`${call.status}. `}</span>
          {call.title}
        </span>
        {hasDetails ? (
          <span className={`shrink-0 ${toneInk.muted}`}>
            <GlyphIcon
              d="M6 9l6 6 6-6"
              size={ICON_SIZE.rowMark}
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            />
          </span>
        ) : null}
      </button>
      {open && hasDetails ? (
        <div className="border-t border-gray-100 px-2.5 py-2 dark:border-gray-800">
          {call.rawInput !== undefined ? (
            <>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {S.codingAgents.toolInput}
              </div>
              <pre className="mb-2 overflow-x-auto font-mono text-xs text-gray-600 dark:text-gray-300">
                {JSON.stringify(call.rawInput, null, 2)}
              </pre>
            </>
          ) : null}
          {call.output !== undefined && call.output !== "" ? (
            <>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {S.codingAgents.toolOutput}
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-gray-600 dark:text-gray-300">
                {call.output}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AddAgentModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");

  const reset = () => {
    setId("");
    setTitle("");
    setCommand("");
    setArgs("");
    setEnv("");
  };

  const save = () => {
    const envRecord: Record<string, string> = {};
    for (const line of env.split("\n")) {
      const sep = line.indexOf("=");
      if (sep <= 0) continue;
      envRecord[line.slice(0, sep).trim()] = line.slice(sep + 1);
    }
    saveCodingAgent({
      id: id.trim(),
      ...(title.trim() === "" ? {} : { title: title.trim() }),
      command: command.trim(),
      args: args
        .split("\n")
        .map((a) => a.trim())
        .filter((a) => a !== ""),
      env: envRecord,
    })
      .then(() => {
        toastSuccess(S.codingAgents.save);
        reset();
        onSaved();
        onClose();
      })
      .catch((e: unknown) => toastError(apiErrorText(e)));
  };

  return (
    <Modal
      open={open}
      title={S.codingAgents.addAgent}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.codingAgents.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={id.trim() === "" || command.trim() === ""}
            onClick={save}
          >
            {S.codingAgents.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={S.codingAgents.idLabel} hint={S.codingAgents.idHint} required>
          <Input size="sm" value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.titleLabel}>
          <Input size="sm" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.commandLabel} hint={S.codingAgents.commandHint} required>
          <Input size="sm" value={command} onChange={(e) => setCommand(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.argsLabel} hint={S.codingAgents.argsHint}>
          <Textarea size="sm" value={args} onChange={(e) => setArgs(e.target.value)} />
        </Field>
        <Field label={S.codingAgents.envLabel} hint={S.codingAgents.envHint}>
          <Textarea size="sm" value={env} onChange={(e) => setEnv(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function LaunchModal({
  agent,
  onClose,
  onCreated,
}: {
  agent: CodingAgentServerInfo | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [workspace, setWorkspace] = useState("");
  const create = () => {
    if (agent === null || workspace.trim() === "") return;
    createCodingAgentSession({ agentId: agent.id, workspaceDir: workspace.trim() })
      .then(() => {
        onCreated();
        setWorkspace("");
        onClose();
      })
      .catch((e: unknown) => toastError(apiErrorText(e)));
  };
  return (
    <Modal
      open={agent !== null}
      title={agent?.title ?? agent?.id ?? S.codingAgents.newSession}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.codingAgents.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={workspace.trim() === ""} onClick={create}>
            {S.codingAgents.startSession}
          </Button>
        </>
      }
    >
      <Field label={S.codingAgents.workspaceLabel} hint={S.codingAgents.workspaceHint} required>
        <Input size="sm" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
      </Field>
    </Modal>
  );
}
