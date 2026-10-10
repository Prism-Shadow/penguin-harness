/**
 * Agent settings page "API" tab: whether external programs may talk to this Agent over its public
 * API (the AMSP stream under /api/amsp/v1), the approval mode its API conversations start with,
 * the address and id a program needs, the keys, and two examples that call it.
 *
 * Everything here is this server's, kept in its database — not in the Agent State, not in the
 * synced Project file — so the Agent can neither expose itself nor loosen its own approvals. Any
 * member reads it; only the Project owner changes it. Each control applies on the flip, with no
 * Save: turning the API on writes at once, while turning it off and deleting a key ask first,
 * because a program using them is refused from then on. A new key's secret exists only in the
 * create response: it is shown once, in a panel with its copy button, until Done, and afterwards
 * the list names the key by its prefix alone. The name typed for a new key is a one-field form:
 * Create (or Enter) is live once a name is typed, Cancel or Esc drops it, and leaving the tab
 * with a name typed asks first.
 *
 * The admin's server-wide switch (Settings › Server › Agent API) overrides every Agent: when it is
 * off the switch here is disabled and says so, and nothing is lost. The tab's own read carries that
 * switch (`serverEnabled`), so every member sees it, not only an admin.
 *
 * The owner's tab ends with Try it (api-try-panel.tsx): one real API run on the owner's sign-in,
 * its stream shown as a program would receive it.
 */
import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type {
  AgentApiKeyInfo,
  AgentApiResponse,
  AgentApiSettings,
  AgentApiUpdateRequest,
  ApprovalMode,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  CodeBlock,
  ConfirmModal,
  CopyButton,
  GlyphIcon,
  ICON_SIZE,
  ICONS,
  Input,
  RuledSection,
  Select,
  SkeletonList,
  ToggleRow,
  toastError,
  useUnsavedChanges,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { useProject } from "../../state/project";
import { APPROVAL_MODES } from "../chat/approval-mode";
import { ApiTryPanel } from "./api-try-panel";

/** The public API's root on the server this page was served from. */
export function agentApiBaseUrl(origin: string): string {
  return `${origin}/api/amsp/v1`;
}

/** How the API names an Agent: the Project and the Agent, qualified. */
export function agentApiRef(projectId: string, agentId: string): string {
  return `${projectId}/${agentId}`;
}

/** A curl call and an SDK call against this Agent, with the key left as an environment variable. */
export function agentApiExamples(baseUrl: string, agentRef: string): { curl: string; sdk: string } {
  const curl = [
    `curl -N ${baseUrl}/agents/${agentRef}/runs \\`,
    `  -H "Authorization: Bearer $PENGUIN_AGENT_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"input":"Hello"}'`,
  ].join("\n");
  const sdk = [
    `import { AgentClient } from "@prismshadow/amsp";`,
    ``,
    `const client = new AgentClient({`,
    `  baseUrl: "${baseUrl}",`,
    `  agent: "${agentRef}",`,
    `  apiKey: process.env.PENGUIN_AGENT_KEY,`,
    `});`,
    ``,
    `const result = await client.ask({ input: "Hello" });`,
    `console.log(result.text);`,
  ].join("\n");
  return { curl, sdk };
}

/** Writes the Agent's API off. Reached only through the confirm. */
const switchOffAgentApi = (projectId: string, agentId: string): Promise<AgentApiResponse> =>
  api.putAgentApi(projectId, agentId, { enabled: false });

/** Opens the Agent to callers without a key. Reached only through the confirm. */
const switchOnKeyless = (projectId: string, agentId: string): Promise<AgentApiResponse> =>
  api.putAgentApi(projectId, agentId, { open: true });

/**
 * The warning before keyless access goes on, in the danger tone: once it is on, anything that
 * can reach the server talks to the Agent on the Project's models and credentials. Answered yes,
 * it says the write began, writes the switch on and hands on the outcome. Turning it off needs
 * no question.
 */
export function KeylessOnConfirm({
  open,
  projectId,
  agentId,
  onClose,
  onWriting,
  onSettled,
}: {
  open: boolean;
  projectId: string;
  agentId: string;
  onClose: () => void;
  onWriting: () => void;
  onSettled: (outcome: AgentApiResponse | { error: unknown }) => void;
}) {
  return (
    <ConfirmModal
      open={open}
      title={S.agent.apiOpenTitle}
      onClose={onClose}
      onConfirm={() => {
        onClose();
        onWriting();
        switchOnKeyless(projectId, agentId).then(
          (res) => onSettled(res),
          (error: unknown) => onSettled({ error }),
        );
      }}
      confirmLabel={S.agent.apiOpenConfirm}
      cancelLabel={S.common.cancel}
    >
      <p className="text-sm text-fg-muted">{S.agent.apiOpenBody}</p>
    </ConfirmModal>
  );
}

/** Deletes one key. Reached only through the confirm. */
const deleteKey = (projectId: string, agentId: string, keyId: string): Promise<void> =>
  api.deleteAgentApiKey(projectId, agentId, keyId);

/**
 * The question before the Agent's API goes off, in the danger tone. Answered yes, it says the
 * write began, writes the switch off and hands on the outcome: what the server stored, or the
 * failure.
 */
export function AgentApiOffConfirm({
  open,
  projectId,
  agentId,
  onClose,
  onWriting,
  onSettled,
}: {
  open: boolean;
  projectId: string;
  agentId: string;
  onClose: () => void;
  onWriting: () => void;
  onSettled: (outcome: AgentApiResponse | { error: unknown }) => void;
}) {
  return (
    <ConfirmModal
      open={open}
      title={S.agent.apiOffTitle}
      onClose={onClose}
      onConfirm={() => {
        onClose();
        onWriting();
        switchOffAgentApi(projectId, agentId).then(
          (res) => onSettled(res),
          (error: unknown) => onSettled({ error }),
        );
      }}
      confirmLabel={S.agent.apiOff}
      cancelLabel={S.common.cancel}
    >
      <p className="text-sm text-fg-muted">{S.agent.apiOffBody}</p>
    </ConfirmModal>
  );
}

/**
 * The question before a key is deleted, naming it, in the danger tone. Answered yes, it deletes
 * the key and hands on which one went; a refused delete says why and hands on nothing.
 */
export function DeleteKeyConfirm({
  record,
  projectId,
  agentId,
  onClose,
  onDeleted,
}: {
  /** The key in question; null keeps the dialog closed. */
  record: AgentApiKeyInfo | null;
  projectId: string;
  agentId: string;
  onClose: () => void;
  onDeleted: (keyId: string) => void;
}) {
  return (
    <ConfirmModal
      open={record !== null}
      title={S.agent.apiDeleteKey}
      onClose={onClose}
      onConfirm={() => {
        if (record === null) return;
        onClose();
        deleteKey(projectId, agentId, record.keyId).then(
          () => onDeleted(record.keyId),
          (error: unknown) => toastError(apiErrorText(error)),
        );
      }}
      confirmLabel={S.common.delete}
      cancelLabel={S.common.cancel}
    >
      <p className="text-sm text-fg-muted">
        {record !== null ? S.agent.apiDeleteKeyBody(record.name) : ""}
      </p>
    </ConfirmModal>
  );
}

/** One labelled value a program needs, set in mono with its copy button. */
function ConnectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 break-all font-mono text-sm font-semibold leading-5">
          {value}
        </span>
        <CopyButton text={value} label={S.agent.apiCopy(label)} size="sm" className="shrink-0" />
      </div>
    </div>
  );
}

/** A just-created key's secret: the one time it is on screen, with its copy button and Done. */
export function OneTimeKey({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <div className="mb-3 space-y-2 rounded-lg border border-line px-4 py-3">
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 break-all font-mono text-sm font-semibold leading-5">
          {secret}
        </span>
        <CopyButton text={secret} label={S.agent.apiCopySecret} size="sm" className="shrink-0" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className={`text-xs ${toneInk.attention}`}>{S.agent.apiKeyShownOnce}</p>
        <Button size="sm" onClick={onDone}>
          {S.agent.apiKeyDone}
        </Button>
      </div>
    </div>
  );
}

/** One key: its name, the prefix it is told apart by, when it was made and last used. */
function KeyRow({
  record,
  canDelete,
  onDelete,
}: {
  record: AgentApiKeyInfo;
  canDelete: boolean;
  onDelete: (record: AgentApiKeyInfo) => void;
}) {
  return (
    <li data-testid="api-key" className="flex items-center gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="min-w-0 truncate text-sm font-medium">{record.name}</span>
        <span className="font-mono text-xs text-fg-muted">{record.prefix}…</span>
        <span className="text-xs">
          <span className="text-fg-muted">{S.agent.apiKeyCreated}</span>{" "}
          <span className="font-semibold tabular-nums">{formatDateTime(record.createdAt)}</span>
        </span>
        <span className="text-xs">
          <span className="text-fg-muted">{S.agent.apiKeyLastUsed}</span>{" "}
          <span className="font-semibold tabular-nums">
            {record.lastUsedAt === null ? S.agent.apiKeyNever : formatDateTime(record.lastUsedAt)}
          </span>
        </span>
      </div>
      {canDelete && (
        <button
          type="button"
          data-tooltip={S.agent.apiDeleteKey}
          aria-label={`${S.agent.apiDeleteKey} ${record.name}`}
          onClick={() => onDelete(record)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors duration-150 hover:text-tone-danger-fg"
        >
          <GlyphIcon d={ICONS.trash} size={ICON_SIZE.rowLead} />
        </button>
      )}
    </li>
  );
}

export interface ApiTabViewProps {
  projectId: string;
  agentId: string;
  settings: AgentApiSettings;
  /** The admin's server-wide switch, as the tab's own read reports it to every member. */
  serverEnabled: boolean;
  isOwner: boolean;
  busy: boolean;
  baseUrl: string;
  agentRef: string;
  /** The name typed for a new key; null while no key is being made. */
  draftName: string | null;
  draftError?: string;
  /** A just-created key's secret, until Done; null otherwise. */
  secret: string | null;
  onToggleEnabled: (next: boolean) => void;
  onApprovalMode: (mode: ApprovalMode) => void;
  onToggleOpen: (next: boolean) => void;
  onStartKey: () => void;
  onDraftName: (name: string) => void;
  onCreateKey: () => void;
  onCancelKey: () => void;
  onSecretDone: () => void;
  onDeleteKey: (record: AgentApiKeyInfo) => void;
}

/** The tab as it reads for one state of the settings: no state of its own. */
export function ApiTabView(p: ApiTabViewProps) {
  const serverOff = !p.serverEnabled;
  const examples = agentApiExamples(p.baseUrl, p.agentRef);
  const nameTyped = (p.draftName ?? "").trim() !== "";
  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && nameTyped && !p.busy) p.onCreateKey();
    else if (e.key === "Escape") p.onCancelKey();
  };
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <ToggleRow
          variant="card"
          label={S.agent.apiEnable}
          info={S.agent.apiEnableHint}
          checked={p.settings.enabled}
          onChange={p.onToggleEnabled}
          disabled={!p.isOwner || serverOff || p.busy}
        />
        {serverOff && <p className="text-xs text-fg-muted">{S.agent.apiAdminOff}</p>}
        {!p.isOwner && <p className="text-xs text-fg-muted">{S.agent.apiOwnerOnly}</p>}
      </div>

      {p.settings.enabled && (
        <>
          {/* A width on a box around the field: the select's own w-full would beat one passed in. */}
          <div className="max-w-sm">
            <Select
              size="sm"
              label={S.agent.apiApprovalMode}
              hint={S.agent.apiApprovalModeHint}
              value={p.settings.approvalMode}
              disabled={!p.isOwner || p.busy}
              onChange={(e) => {
                const mode = APPROVAL_MODES.find((m) => m === e.target.value);
                if (mode !== undefined) p.onApprovalMode(mode);
              }}
            >
              {APPROVAL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {S.chat.approvalModeNames[mode] ?? mode}
                </option>
              ))}
            </Select>
          </div>

          <RuledSection title={S.agent.apiConnection}>
            <div className="space-y-3">
              <ConnectionRow label={S.agent.apiBaseUrl} value={p.baseUrl} />
              <ConnectionRow label={S.agent.apiAgentId} value={p.agentRef} />
            </div>
          </RuledSection>

          <RuledSection
            title={S.agent.apiKeys}
            count={p.settings.keys.length}
            actions={
              p.isOwner && p.draftName === null ? (
                <Button size="sm" disabled={p.busy} onClick={p.onStartKey}>
                  {S.agent.apiNewKey}
                </Button>
              ) : undefined
            }
          >
            {p.draftName !== null && (
              <div className="mb-3 flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1 sm:max-w-xs">
                  <Input
                    size="sm"
                    aria-label={S.agent.apiKeyName}
                    placeholder={S.agent.apiKeyName}
                    value={p.draftName}
                    maxLength={64}
                    error={p.draftError}
                    autoFocus
                    onChange={(e) => p.onDraftName(e.target.value)}
                    onKeyDown={onDraftKey}
                  />
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  loading={p.busy}
                  disabled={!nameTyped}
                  onClick={p.onCreateKey}
                >
                  {S.common.create}
                </Button>
                <Button size="sm" variant="ghost" onClick={p.onCancelKey}>
                  {S.common.cancel}
                </Button>
              </div>
            )}
            {p.secret !== null && <OneTimeKey secret={p.secret} onDone={p.onSecretDone} />}
            {p.settings.keys.length === 0 ? (
              <p className="text-xs text-fg-muted">{S.agent.apiKeysEmpty}</p>
            ) : (
              <ul className="divide-y divide-line-muted">
                {p.settings.keys.map((record) => (
                  <KeyRow
                    key={record.keyId}
                    record={record}
                    canDelete={p.isOwner}
                    onDelete={p.onDeleteKey}
                  />
                ))}
              </ul>
            )}
            <div className="mt-4 space-y-1">
              <ToggleRow
                variant="plain"
                label={S.agent.apiOpen}
                checked={p.settings.open}
                onChange={p.onToggleOpen}
                disabled={!p.isOwner || p.busy}
              />
              <p className={`text-xs ${toneInk.attention}`}>{S.agent.apiOpenHint}</p>
            </div>
          </RuledSection>

          <RuledSection title={S.agent.apiExamples}>
            <CodeBlock language="bash" code={examples.curl} />
            <CodeBlock language="typescript" code={examples.sdk} />
          </RuledSection>

          {p.isOwner && (
            <ApiTryPanel
              // Another Agent's tab starts its own Try it: no Session carried over.
              key={p.agentRef}
              projectId={p.projectId}
              agentId={p.agentId}
              disabledReason={serverOff ? S.agent.apiAdminOff : undefined}
            />
          )}
        </>
      )}
    </div>
  );
}

export function ApiTab({
  projectId,
  agentId,
  isOwner,
}: {
  projectId: string;
  agentId: string;
  isOwner: boolean;
}) {
  const { reloadAgents } = useProject();
  const [settings, setSettings] = useState<AgentApiSettings | null>(null);
  // Only the initial load failure renders inline; writes report via toast.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverEnabled, setServerEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirmKeyless, setConfirmKeyless] = useState(false);
  const [deleting, setDeleting] = useState<AgentApiKeyInfo | null>(null);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | undefined>(undefined);
  const [secret, setSecret] = useState<string | null>(null);
  /** Drops the name typed for a new key: Cancel, Esc, and what a confirmed leave runs. */
  const dropDraft = () => {
    setDraftName(null);
    setDraftError(undefined);
  };
  // A typed key name is unsaved input: leaving the tab with one asks first. The row's own
  // Cancel and Esc drop it without asking — they are the explicit discard, like a Reset.
  useUnsavedChanges((draftName ?? "").trim() !== "", { discard: dropDraft });

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setLoadError(null);
    api.getAgentApi(projectId, agentId).then(
      (res) => {
        if (cancelled) return;
        setSettings(res.api);
        setServerEnabled(res.serverEnabled);
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId]);

  /** One settings write: the stored answer replaces the view, a failure says why. */
  const write = useCallback(
    async (patch: AgentApiUpdateRequest) => {
      setBusy(true);
      try {
        const res = await api.putAgentApi(projectId, agentId, patch);
        setSettings(res.api);
        setServerEnabled(res.serverEnabled);
        // The Agents list marks an Agent whose API is on.
        if (patch.enabled !== undefined) void reloadAgents();
      } catch (e) {
        toastError(apiErrorText(e));
      } finally {
        setBusy(false);
      }
    },
    [projectId, agentId, reloadAgents],
  );

  const createKey = async () => {
    const name = (draftName ?? "").trim();
    if (name === "" || busy) return;
    setBusy(true);
    try {
      const res = await api.createAgentApiKey(projectId, agentId, { name });
      setSettings((prev) => (prev === null ? prev : { ...prev, keys: [...prev.keys, res.key] }));
      setSecret(res.secret);
      setDraftName(null);
      setDraftError(undefined);
    } catch (e) {
      setDraftError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (loadError !== null) return <p className={`text-sm ${toneInk.danger}`}>{loadError}</p>;
  if (settings === null) return <SkeletonList rows={3} />;

  return (
    <>
      <ApiTabView
        projectId={projectId}
        agentId={agentId}
        settings={settings}
        serverEnabled={serverEnabled}
        isOwner={isOwner}
        busy={busy}
        baseUrl={agentApiBaseUrl(window.location.origin)}
        agentRef={agentApiRef(projectId, agentId)}
        draftName={draftName}
        {...(draftError !== undefined ? { draftError } : {})}
        secret={secret}
        onToggleEnabled={(next) => {
          if (next) void write({ enabled: true });
          else setConfirmOff(true);
        }}
        onApprovalMode={(approvalMode) => void write({ approvalMode })}
        onToggleOpen={(open) => {
          if (open) setConfirmKeyless(true);
          else void write({ open: false });
        }}
        onStartKey={() => {
          setDraftName("");
          setDraftError(undefined);
        }}
        onDraftName={(name) => {
          setDraftName(name);
          setDraftError(undefined);
        }}
        onCreateKey={() => void createKey()}
        onCancelKey={dropDraft}
        onSecretDone={() => setSecret(null)}
        onDeleteKey={setDeleting}
      />
      <AgentApiOffConfirm
        open={confirmOff}
        projectId={projectId}
        agentId={agentId}
        onClose={() => setConfirmOff(false)}
        onWriting={() => setBusy(true)}
        onSettled={(outcome) => {
          if ("api" in outcome) {
            setSettings(outcome.api);
            setServerEnabled(outcome.serverEnabled);
            void reloadAgents();
          } else toastError(apiErrorText(outcome.error));
          setBusy(false);
        }}
      />
      <KeylessOnConfirm
        open={confirmKeyless}
        projectId={projectId}
        agentId={agentId}
        onClose={() => setConfirmKeyless(false)}
        onWriting={() => setBusy(true)}
        onSettled={(outcome) => {
          if ("api" in outcome) {
            setSettings(outcome.api);
            setServerEnabled(outcome.serverEnabled);
          } else toastError(apiErrorText(outcome.error));
          setBusy(false);
        }}
      />
      <DeleteKeyConfirm
        record={deleting}
        projectId={projectId}
        agentId={agentId}
        onClose={() => setDeleting(null)}
        onDeleted={(keyId) =>
          setSettings((prev) =>
            prev === null ? prev : { ...prev, keys: prev.keys.filter((k) => k.keyId !== keyId) },
          )
        }
      />
    </>
  );
}
