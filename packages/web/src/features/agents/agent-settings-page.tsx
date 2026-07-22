/**
 * Agent settings page: six tabs —
 * Overview (name/description/State path/active count/State version + snapshot
 * export-import), Prompt (AGENTS.md and system_prompt editors + placeholder
 * reference), Runtime (max_turns, model.*, compaction.*), Tools (editable built-in
 * tools table, MCP Server read-only JSON), Vault (vault-tab.tsx), Schedule
 * (schedules-tab.tsx).
 * Save = PUT config (sends only the changed keys; YAML comments are preserved
 * server-side).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router";
import type {
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  AgentCompactionConfigDto,
  AgentModelConfigDto,
} from "@prismshadow/penguin-server/api";
import type { ToolDefinitionConfig, ToolPermission } from "@prismshadow/penguin-core/interfaces";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useProject } from "../../state/project";
import { Tabs } from "../../components/ui/tabs";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { OptionMenu, type OptionMenuChoice } from "../../components/ui/option-menu";
import { Modal } from "../../components/ui/modal";
import { Skeleton } from "../../components/ui/skeleton";
import { VaultTab } from "./vault-tab";
import { SchedulesTab } from "./schedules-tab";
import { thinkingLevelOptionsFor } from "../chat/thinking-level";

type TabKey = "overview" | "prompt" | "runtime" | "tools" | "vault" | "schedules";

/** "" represents not overridden (falls back to the current config), corresponding to the defaultValue placeholder row. */
function withDefaultOption(
  entries: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<OptionMenuChoice<string>> {
  return entries.map(([value, description]) => ({
    value,
    triggerLabel: value || S.agent.defaultValue,
    label: value || S.agent.defaultValue,
    description,
  }));
}

/** Numeric input's string state → number (empty/invalid = undefined, meaning no change). */
function parseNum(s: string): number | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function numToStr(n: number | undefined): string {
  return n === undefined ? "" : String(n);
}

export function AgentSettingsPage() {
  // Read inside the component: after a language switch remount, this picks up the current dictionary.
  const TABS = [
    { key: "overview", label: S.agent.tabOverview },
    { key: "prompt", label: S.agent.tabPrompt },
    { key: "runtime", label: S.agent.tabRuntime },
    { key: "tools", label: S.agent.tabTools },
    { key: "vault", label: S.agent.tabVault },
    { key: "schedules", label: S.agent.tabSchedules },
  ] as const;
  const navigate = useNavigate();
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId ?? "";
  useDocumentTitle(S.agent.settings);
  const { currentProject, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [data, setData] = useState<AgentConfigResponse | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId || !agentId) return;
    setData(null);
    setError(null);
    api
      .getAgentConfig(projectId, agentId)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : S.common.unknownError));
  }, [projectId, agentId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Snapshot import succeeded: show the new version and reload the whole config (import overwrites the entire Agent State, so every tab's data needs a refresh). */
  const onImported = useCallback(
    (version: number) => {
      setNotice(S.agent.importDone(version));
      load();
      void reloadAgents();
    },
    [load, reloadAgents],
  );

  const save = useCallback(
    async (update: AgentConfigUpdateRequest) => {
      if (!projectId || !agentId) return;
      setError(null);
      setNotice(null);
      try {
        const res = await api.putAgentConfig(projectId, agentId, update);
        setData(res);
        setNotice(S.common.saved);
        // Name/description changes affect the breadcrumb and list display.
        if (update.config?.name !== undefined || update.config?.description !== undefined) {
          void reloadAgents();
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : S.common.unknownError);
      }
    },
    [projectId, agentId, reloadAgents],
  );

  if (!projectId) return null;
  if (error && !data) {
    return <p className="p-6 text-sm text-red-600 dark:text-red-400">{error}</p>;
  }
  if (!data) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="no-scrollbar h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/agents")}
          className="-ml-2 mb-3 text-gray-500 dark:text-gray-400"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
            <path d="M9 12h12" />
          </svg>
          {S.agent.backToList}
        </Button>
        <h1 className="mb-1 text-xl font-semibold">{data.config.name ?? agentId}</h1>
        <p className="mb-4 font-mono text-xs text-gray-400">{agentId}</p>
        <Tabs items={TABS} active={tab} onChange={setTab} />
        <div className="py-4">
          {tab === "overview" && (
            <OverviewTab data={data} agentId={agentId} onSave={save} onImported={onImported} />
          )}
          {tab === "prompt" && <PromptTab data={data} onSave={save} />}
          {tab === "runtime" && <RuntimeTab data={data} onSave={save} />}
          {tab === "tools" && <ToolsTab data={data} onSave={save} />}
          {tab === "vault" && <VaultTab agentId={agentId} />}
          {tab === "schedules" && <SchedulesTab agentId={agentId} />}
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}
      </div>
    </div>
  );
}

type SaveFn = (update: AgentConfigUpdateRequest) => Promise<void>;

/** <a download>/<label> version of the button look (matches Button secondary sm; the Button component only renders <button>). */
const TRANSFER_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-gray-300 " +
  "bg-white px-2.5 py-1 text-xs font-medium text-gray-800 transition-colors duration-150 " +
  "hover:bg-gray-50 focus-within:ring-2 focus-within:ring-gray-400/30 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800";

function OverviewTab({
  data,
  agentId,
  onSave,
  onImported,
}: {
  data: AgentConfigResponse;
  agentId: string;
  onSave: SaveFn;
  onImported: (version: number) => void;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  const [name, setName] = useState(data.config.name ?? "");
  const [description, setDescription] = useState(data.config.description ?? "");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // base64 of the snapshot package pending confirmation for a version conflict (409 version_conflict); non-null shows the confirm modal.
  const [conflict, setConflict] = useState<string | null>(null);

  const submit = () => {
    const config: NonNullable<AgentConfigUpdateRequest["config"]> = {};
    if (name.trim() !== (data.config.name ?? "")) config.name = name.trim();
    if (description.trim() !== (data.config.description ?? "")) {
      config.description = description.trim();
    }
    if (Object.keys(config).length === 0) return;
    void onSave({ config });
  };

  const runImport = async (dataBase64: string, confirm: boolean) => {
    if (!projectId) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await api.importAgent(projectId, agentId, {
        dataBase64,
        ...(confirm ? { confirm: true } : {}),
      });
      setConflict(null);
      onImported(res.version);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "version_conflict") {
        setConflict(dataBase64); // resend with confirm: true after confirming
      } else {
        setConflict(null);
        setImportError(e instanceof ApiError ? e.message : S.common.unknownError);
      }
    } finally {
      setImporting(false);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      void runImport(url.slice(url.indexOf(",") + 1), false); // strip the data:...;base64, prefix
    };
    reader.onerror = () => setImportError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      <Input
        size="sm"
        label={S.agent.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Textarea
        label={S.agent.description}
        size="sm"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">{S.agent.stateDir}</p>
        <p className="break-all font-mono text-xs text-gray-500 dark:text-gray-400">
          {data.stateDir}
        </p>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">{S.agent.activeSessions}</p>
        <p className="text-sm">{data.activeSessionCount}</p>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">{S.agent.stateVersion}</p>
        <p className="font-mono text-sm">v{data.config.version}</p>
      </div>

      {/* Snapshot export / import: export is available to any member; import overwrites the entire Agent State, visible only to owners. */}
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">{S.agent.transferTitle}</p>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{S.agent.transferDesc}</p>
        <div className="flex flex-wrap items-center gap-2">
          {projectId && (
            <a
              href={api.agentExportUrl(projectId, agentId)}
              download
              className={TRANSFER_BUTTON_CLASS}
            >
              {S.agent.exportSnapshot}
            </a>
          )}
          {isOwner && (
            <label
              className={`${TRANSFER_BUTTON_CLASS} ${importing ? "pointer-events-none opacity-60" : ""}`}
            >
              {/* sr-only rather than hidden: keeps it keyboard-Tab-focusable (same as the workspace-browser upload). */}
              <input
                type="file"
                accept=".tar.gz,.tgz"
                className="sr-only"
                disabled={importing}
                onChange={onPickFile}
              />
              {importing ? S.agent.importing : S.agent.importSnapshot}
            </label>
          )}
        </div>
        {importError && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{importError}</p>
        )}
      </div>

      <Button size="sm" variant="primary" onClick={submit}>
        {S.common.save}
      </Button>

      {/* Version conflict confirmation: resend the same package with confirm: true after confirming. */}
      <Modal
        open={conflict !== null}
        title={S.agent.importConflictTitle}
        onClose={() => setConflict(null)}
        footer={
          <>
            <Button onClick={() => setConflict(null)}>{S.common.cancel}</Button>
            <Button
              variant="danger"
              disabled={importing}
              onClick={() => {
                if (conflict !== null) void runImport(conflict, true);
              }}
            >
              {S.common.confirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.agent.importConflictBody}</p>
      </Modal>
    </div>
  );
}

function PromptTab({ data, onSave }: { data: AgentConfigResponse; onSave: SaveFn }) {
  const [agentsMd, setAgentsMd] = useState(data.agentsMd);
  const [systemPrompt, setSystemPrompt] = useState(data.config.systemPrompt);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const update: AgentConfigUpdateRequest = {};
    if (agentsMd !== data.agentsMd) update.agentsMd = agentsMd;
    if (systemPrompt !== data.config.systemPrompt) update.config = { systemPrompt };
    if (update.agentsMd === undefined && update.config === undefined) return;
    void onSave(update);
  };

  /**
   * Quickly insert a placeholder at the system_prompt cursor position (appends to the
   * end when unfocused). Prefers execCommand insertText — it writes to the browser's
   * undo stack (undoable with Ctrl/⌘+Z) and fires an input event, which the
   * controlled onChange syncs into state; falls back to directly mutating state when
   * unsupported (no undo).
   */
  const insertPlaceholder = (ph: string) => {
    const el = promptRef.current;
    if (el) {
      el.focus();
      // execCommand is deprecated but still the only available way to preserve the textarea's native undo stack.
      const inserted = document.execCommand?.("insertText", false, ph);
      if (inserted) return; // onChange will update state from e.target.value
    }
    const start = el ? el.selectionStart : systemPrompt.length;
    const end = el ? el.selectionEnd : systemPrompt.length;
    setSystemPrompt(systemPrompt.slice(0, start) + ph + systemPrompt.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + ph.length;
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="space-y-4">
      <Textarea
        label={S.agent.agentsMd}
        mono
        size="sm"
        rows={14}
        value={agentsMd}
        onChange={(e) => setAgentsMd(e.target.value)}
      />
      <Textarea
        ref={promptRef}
        label={S.agent.systemPrompt}
        mono
        size="sm"
        rows={12}
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
      />
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
        <p className="mb-2 text-xs font-semibold text-gray-500">{S.agent.placeholdersTitle}</p>
        <ul className="space-y-1">
          {S.agent.placeholders.map(([ph, desc]) => (
            <li key={ph} className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => insertPlaceholder(ph)}
                title={S.agent.insertPlaceholder}
                className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono font-semibold text-gray-800 transition-colors duration-150 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-700"
              >
                {ph}
              </button>
              <span className="text-gray-500 dark:text-gray-400">{desc}</span>
            </li>
          ))}
        </ul>
      </div>
      <Button size="sm" variant="primary" onClick={submit}>
        {S.common.save}
      </Button>
    </div>
  );
}

function RuntimeTab({ data, onSave }: { data: AgentConfigResponse; onSave: SaveFn }) {
  const cfg = data.config;
  const [maxTurns, setMaxTurns] = useState(numToStr(cfg.maxTurns));
  const [maxTokens, setMaxTokens] = useState(numToStr(cfg.model?.maxTokens));
  const [thinkingLevel, setThinkingLevel] = useState(cfg.model?.thinkingLevel ?? "");
  const [timeoutMs, setTimeoutMs] = useState(numToStr(cfg.model?.timeoutMs));
  const [maxContextLength, setMaxContextLength] = useState(
    numToStr(cfg.compaction?.maxContextLength),
  );
  const [maxSessionTurns, setMaxSessionTurns] = useState(numToStr(cfg.compaction?.maxSessionTurns));
  const [mode, setMode] = useState(cfg.compaction?.mode ?? "");
  const [prompt, setPrompt] = useState(cfg.compaction?.prompt ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    setLocalError(null);
    const config: NonNullable<AgentConfigUpdateRequest["config"]> = {};

    const mt = parseNum(maxTurns);
    if (mt !== undefined && mt !== cfg.maxTurns) {
      if (mt <= 0 && mt !== -1) {
        setLocalError(S.agent.maxTurnsInvalid);
        return;
      }
      config.maxTurns = mt;
    }

    const model: AgentModelConfigDto = {};
    const tok = parseNum(maxTokens);
    if (tok !== undefined && tok !== cfg.model?.maxTokens) model.maxTokens = tok;
    if (thinkingLevel && thinkingLevel !== (cfg.model?.thinkingLevel ?? "")) {
      model.thinkingLevel = thinkingLevel as AgentModelConfigDto["thinkingLevel"];
    }
    const tmo = parseNum(timeoutMs);
    if (tmo !== undefined && tmo !== cfg.model?.timeoutMs) {
      if (tmo <= 0 && tmo !== -1) {
        setLocalError(S.agent.timeoutInvalid);
        return;
      }
      model.timeoutMs = tmo;
    }
    if (Object.keys(model).length > 0) config.model = model;

    const compaction: AgentCompactionConfigDto = {};
    const mcl = parseNum(maxContextLength);
    if (mcl !== undefined && mcl !== cfg.compaction?.maxContextLength) {
      compaction.maxContextLength = mcl;
    }
    const mst = parseNum(maxSessionTurns);
    if (mst !== undefined && mst !== cfg.compaction?.maxSessionTurns) {
      compaction.maxSessionTurns = mst;
    }
    if (mode && mode !== (cfg.compaction?.mode ?? "")) {
      compaction.mode = mode as AgentCompactionConfigDto["mode"];
    }
    if (prompt !== (cfg.compaction?.prompt ?? "")) compaction.prompt = prompt;
    if (Object.keys(compaction).length > 0) config.compaction = compaction;

    if (Object.keys(config).length === 0) return;
    void onSave({ config });
  };

  // S is reassigned on language switch (live binding), so read it during render rather than hoisting to a module-level constant.
  // "none" is no longer offered (many models cannot disable thinking) but stays a valid stored
  // value: assembly lives in thinkingLevelOptionsFor, gated on the **persisted** config — a
  // misclick onto another tier keeps the legacy row until the change is actually saved, so the
  // stored value stays reachable (see thinking-level.ts).
  const thinkingLevelOptions = thinkingLevelOptionsFor(
    S.agent.thinkingLevelOptions,
    S.agent.defaultValue,
    S.agent.thinkingLevelNoneKept,
    cfg.model?.thinkingLevel,
  );
  const compactionModeOptions = withDefaultOption(S.agent.compactionModeOptions);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label={S.agent.maxTurns}
              size="sm"
              value={maxTurns}
              onChange={(e) => setMaxTurns(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <Input
              label={S.agent.maxTokens}
              size="sm"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <OptionMenu
              label={S.agent.thinkingLevel}
              fullWidth
              size="sm"
              value={thinkingLevel}
              onChange={setThinkingLevel}
              options={thinkingLevelOptions}
            />
            <Input
              label={S.agent.timeoutMs}
              hint={S.agent.timeoutMsHint}
              size="sm"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
          </div>
        </div>

        <div className="border-t border-b border-gray-200 bg-gray-50/80 px-3 py-2 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900">
          {S.agent.compaction}
        </div>
        <div className="p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input
              label={S.agent.maxContextLength}
              hint={S.agent.maxContextLengthHint}
              size="sm"
              value={maxContextLength}
              onChange={(e) => setMaxContextLength(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <Input
              label={S.agent.maxSessionTurns}
              hint={S.agent.maxSessionTurnsHint}
              size="sm"
              value={maxSessionTurns}
              onChange={(e) => setMaxSessionTurns(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <OptionMenu
              label={S.agent.compactionMode}
              fullWidth
              size="sm"
              value={mode}
              onChange={setMode}
              options={compactionModeOptions}
            />
          </div>
        </div>

        <div className="border-t border-b border-gray-200 bg-gray-50/80 px-3 py-2 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:bg-gray-900">
          {S.agent.compactionPrompt}
        </div>
        <div className="p-3">
          <Textarea
            aria-label={S.agent.compactionPrompt}
            mono
            size="sm"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
      </div>

      {localError && <p className="text-xs text-red-600 dark:text-red-400">{localError}</p>}
      <Button size="sm" variant="primary" onClick={submit}>
        {S.common.save}
      </Button>
    </div>
  );
}

/** Local edit state for a tool row: numeric columns use string state (can be cleared then re-entered; empty string = clear the override and revert to default). */
interface ToolRowState {
  base: ToolDefinitionConfig;
  timeoutMs: string;
  maxOutputLength: string;
}

function ToolsTab({ data, onSave }: { data: AgentConfigResponse; onSave: SaveFn }) {
  // S is reassigned on language switch (live binding), so read it during render rather than hoisting to a module-level constant.
  const permissionOptions: ReadonlyArray<OptionMenuChoice<ToolPermission>> = [
    {
      value: "r",
      triggerLabel: "r",
      label: S.agent.permissionReadLabel,
      description: S.agent.permissionReadDescription,
    },
    {
      value: "rw",
      triggerLabel: "rw",
      label: S.agent.permissionReadWriteLabel,
      description: S.agent.permissionReadWriteDescription,
    },
  ];
  const [rows, setRows] = useState<ToolRowState[]>(() =>
    data.config.toolsBuiltin.map((t) => ({
      base: { ...t },
      timeoutMs: numToStr(t.timeoutMs),
      maxOutputLength: numToStr(t.maxOutputLength),
    })),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const update = (index: number, patch: Partial<ToolRowState>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const submit = () => {
    setLocalError(null);
    // toolsBuiltin is submitted as a full table: an empty string omits that key (revert to default); non-empty values are validated per the server's rules.
    const tools: ToolDefinitionConfig[] = [];
    for (const row of rows) {
      const tool: ToolDefinitionConfig = { ...row.base };
      delete tool.timeoutMs;
      delete tool.maxOutputLength;
      const timeout = row.timeoutMs.trim();
      if (timeout) {
        const n = Number(timeout);
        if (!Number.isInteger(n) || (n <= 0 && n !== -1)) {
          setLocalError(S.agent.toolFieldInvalid(row.base.name, "timeoutMs"));
          return;
        }
        tool.timeoutMs = n;
      }
      const maxOutput = row.maxOutputLength.trim();
      if (maxOutput) {
        const n = Number(maxOutput);
        if (!Number.isInteger(n) || (n <= 0 && n !== -1)) {
          setLocalError(S.agent.toolFieldInvalid(row.base.name, "maxOutputLength"));
          return;
        }
        tool.maxOutputLength = n;
      }
      tools.push(tool);
    }
    void onSave({ config: { toolsBuiltin: tools } });
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
              <th className="px-3 py-2">{S.agent.toolName}</th>
              <th className="px-3 py-2">{S.agent.toolPermission}</th>
              <th className="px-3 py-2">{S.agent.toolTimeout}</th>
              <th className="px-3 py-2">{S.agent.toolMaxOutput}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.base.name} className="border-b border-gray-100 dark:border-gray-800/60">
                <td className="px-3 py-2 font-mono text-xs">{row.base.name}</td>
                <td className="px-3 py-2">
                  <OptionMenu
                    mono
                    size="sm"
                    aria-label={S.agent.toolPermission}
                    placeholder={S.agent.defaultValue}
                    options={permissionOptions}
                    value={row.base.permission}
                    onChange={(v) => update(i, { base: { ...row.base, permission: v } })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    size="sm"
                    value={row.timeoutMs}
                    inputMode="numeric"
                    className="font-mono"
                    onChange={(e) => update(i, { timeoutMs: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    size="sm"
                    value={row.maxOutputLength}
                    inputMode="numeric"
                    className="font-mono"
                    onChange={(e) => update(i, { maxOutputLength: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {localError && <p className="text-xs text-red-600 dark:text-red-400">{localError}</p>}

      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">{S.agent.mcpServers}</p>
        <pre className="max-h-64 overflow-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900">
          {JSON.stringify(data.config.mcpServers, null, 2)}
        </pre>
      </div>

      <Button size="sm" variant="primary" onClick={submit}>
        {S.common.save}
      </Button>
    </div>
  );
}
