/**
 * Agent settings page: nine tabs —
 * Overview (name/description form + two ruled sections in the skills import modal's
 * family: Agent State — State version, snapshot export-import and the copyable State
 * path — and Kernel — the defaults generation with its update / restore-defaults
 * actions), System Prompt (AGENTS.md and system_prompt editors + placeholder
 * reference), Runtime (max_turns, model.*, compaction.*), Tools (editable built-in
 * tools table + the MCP Server form, mcp-servers-section.tsx), Skills (skills-tab.tsx),
 * Hooks (hooks-tab.tsx), Memory (memory-tab.tsx), Vault (vault-tab.tsx), Schedule
 * (schedules-tab.tsx).
 * Save = PUT config (sends only the changed keys; YAML comments are preserved
 * server-side).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type {
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  AgentCompactionConfigDto,
  AgentKernelUpdateResponse,
  AgentModelConfigDto,
} from "@prismshadow/penguin-server/api";
import type { ToolDefinitionConfig, ToolPermission } from "@prismshadow/penguin-core/interfaces";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useProject } from "../../state/project";
import { Tabs } from "../../components/ui/tabs";
import { Button } from "../../components/ui/button";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { Input, Textarea } from "../../components/ui/input";
import { OptionMenu, type OptionMenuChoice } from "../../components/ui/option-menu";
import { Switch } from "../../components/ui/switch";
import { ConfirmModal, useSaveConfirm } from "../../components/ui/confirm-modal";
import { CopyButton, ROW_COPY_CLASS } from "../../components/ui/copy-button";
import { Skeleton } from "../../components/ui/skeleton";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { UpdateDot } from "../../components/ui/update-dot";
import { SkillsTab } from "./skills-tab";
import { HooksTab } from "./hooks-tab";
import { MemoryTab } from "./memory-tab";
import { kernelTabLabel } from "./kernel-labels";
import { VaultTab } from "./vault-tab";
import { SchedulesTab } from "./schedules-tab";
import { McpServersSection } from "./mcp-servers-section";
import { SNAPSHOT_ACCEPT, SNAPSHOT_BUTTON_CLASS, fileToBase64 } from "./snapshot-file";
import { thinkingLevelOptionsFor } from "../chat/thinking-level";
import { InfoPopover } from "../../components/ui/info-popover";
import { ICON_SIZE } from "../../lib/icon-scale";

type TabKey =
  | "overview"
  | "prompt"
  | "runtime"
  | "tools"
  | "skills"
  | "hooks"
  | "memory"
  | "vault"
  | "schedules";

/**
 * Dropdown rows from a dictionary's [value, description] pairs (exported for unit tests).
 * The "" (not-overridden / inherit) row is filtered out per review — the menus offer only
 * concrete values in dictionary order, the user picks explicitly. An unset stored value
 * simply matches no row, so the OptionMenu trigger falls back to its placeholder
 * ("(default)", the same convention as the tools-table permission menu); nothing is
 * ever written silently, and the reset link next to each menu rewinds a local pick back to "".
 */
export function optionRows(
  entries: ReadonlyArray<readonly [string, string]>,
): ReadonlyArray<OptionMenuChoice<string>> {
  return entries
    .filter(([value]) => value !== "")
    .map(([value, description]) => ({
      value,
      triggerLabel: value,
      label: value,
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

/**
 * Narrow an untrusted `?tab=` query value to a known tab key (exported for unit tests):
 * validated against the live TABS keys — not a hardcoded list — so newly added tabs
 * deep-link without touching this helper; missing/unknown values fall back to the default.
 */
export function resolveTabKey<K extends string>(
  raw: string | null,
  tabs: ReadonlyArray<{ key: K }>,
  fallback: K,
): K {
  return tabs.some((t) => t.key === raw) ? (raw as K) : fallback;
}

export function AgentSettingsPage() {
  // Read inside the component: after a language switch remount, this picks up the current dictionary.
  const TABS = [
    { key: "overview", label: S.agent.tabOverview },
    { key: "prompt", label: S.agent.tabPrompt },
    { key: "runtime", label: S.agent.tabRuntime },
    { key: "tools", label: S.agent.tabTools },
    { key: "skills", label: S.agent.tabSkills },
    { key: "hooks", label: S.agent.tabHooks },
    { key: "memory", label: S.agent.tabMemory },
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
  // ?tab= deep link (from the Agents page's stat icons): a valid key lands the page on that
  // tab; missing/unknown values fall back to "overview", exactly the previous behavior.
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(() =>
    resolveTabKey(searchParams.get("tab"), TABS, "overview"),
  );
  /** Switch tab and mirror it into `?tab=` (replace history entry, keep other params) so the address stays shareable. */
  const switchTab = useCallback(
    (next: TabKey) => {
      setTab(next);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set("tab", next);
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // Only the initial config load failure renders inline (the page can't show without it); saves/imports report via toast.
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (opts?: { keepStale?: boolean }) => {
      if (!projectId || !agentId) return;
      // keepStale refreshes in place: dropping data would skeleton the page, unmount the tab
      // tree and lose unsaved editor state. Identity changes and whole-state replacements
      // (import / config reset) still clear, so no stale agent's config ever shows.
      if (!opts?.keepStale) setData(null);
      setError(null);
      api
        .getAgentConfig(projectId, agentId)
        .then(setData)
        .catch((e: unknown) => setError(apiErrorText(e)));
    },
    [projectId, agentId],
  );

  useEffect(() => {
    load();
  }, [load]);

  /** Memory-tab config writes (switch, placeholder insert, prompt save): refresh the page's config copy without unmounting the tabs. */
  const refreshConfig = useCallback(() => load({ keepStale: true }), [load]);

  /** Snapshot import succeeded: show the new version and reload the whole config (import overwrites the entire Agent State, so every tab's data needs a refresh). */
  const onImported = useCallback(
    (version: number) => {
      toastSuccess(S.agent.importDone(version));
      load();
      void reloadAgents();
    },
    [load, reloadAgents],
  );

  /** Config reset succeeded: the whole system_config.yaml was replaced, so reload every tab's data (and the list's tool counts). */
  const onConfigReset = useCallback(() => {
    toastSuccess(S.agent.resetConfigDone);
    load();
    void reloadAgents();
  }, [load, reloadAgents]);

  /**
   * Kernel update succeeded: refresh in place (keepStale keeps the Overview mounted so its
   * kept-fields report stays visible; the other tabs re-seed on their next mount) and reload
   * the list for its outdated markers. The toast comes from the Overview tab, which holds
   * the merge report.
   */
  const onKernelUpdated = useCallback(() => {
    load({ keepStale: true });
    void reloadAgents();
  }, [load, reloadAgents]);

  const save = useCallback(
    async (update: AgentConfigUpdateRequest) => {
      if (!projectId || !agentId) return;
      try {
        const res = await api.putAgentConfig(projectId, agentId, update);
        setData(res);
        toastSuccess(S.agent.savedTakesEffect);
        // Name/description changes affect the breadcrumb and list display; a builtin-tools
        // change moves the card's tool count.
        if (
          update.config?.name !== undefined ||
          update.config?.description !== undefined ||
          update.config?.toolsBuiltin !== undefined
        ) {
          void reloadAgents();
        }
      } catch (e) {
        toastError(apiErrorText(e));
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
    /* relative: a scroller is its own containing block (see the invariant in styles.css) —
       this page's snapshot-import control used to grow the document from below the fold. */
    <div className="no-scrollbar relative h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-3xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/agents")}
          className="-ml-2 mb-3 text-gray-500 dark:text-gray-400"
        >
          <GlyphIcon d="M15 18l-6-6 6-6M9 12h12" size={ICON_SIZE.rowLead} />
          {S.agent.backToList}
        </Button>
        <h1 className="mb-1 text-xl font-semibold">{data.config.name ?? agentId}</h1>
        <p className="mb-4 font-mono text-xs text-gray-400">{agentId}</p>
        {/* The kernel update action lives in the Overview tab's Kernel section, so the trail
            from the Agents list has to cross the tab strip to reach it. */}
        <Tabs
          items={TABS.map((t) =>
            t.key === "overview" && data.config.kernelOutdated
              ? { ...t, badge: S.agent.kernelOutdatedHint }
              : t,
          )}
          active={tab}
          onChange={switchTab}
        />
        <div className="py-4">
          {tab === "overview" && (
            <OverviewTab
              data={data}
              agentId={agentId}
              onSave={save}
              onImported={onImported}
              onConfigReset={onConfigReset}
              onKernelUpdated={onKernelUpdated}
            />
          )}
          {tab === "prompt" && <PromptTab data={data} onSave={save} />}
          {tab === "memory" && <MemoryTab agentId={agentId} onConfigChanged={refreshConfig} />}
          {tab === "runtime" && <RuntimeTab data={data} onSave={save} />}
          {tab === "tools" && (
            <div className="space-y-8">
              <ToolsTab data={data} onSave={save} />
              {/* MCP Servers persist vault-style (immediately, own modals) — separate from the
                  builtin table's Save button, so it lives beside ToolsTab, not inside it. */}
              <McpServersSection agentId={agentId} initial={data.config.mcpServers} />
            </div>
          )}
          {tab === "skills" && <SkillsTab agentId={agentId} onConfigChanged={refreshConfig} />}
          {tab === "hooks" && <HooksTab agentId={agentId} />}
          {tab === "vault" && <VaultTab agentId={agentId} onConfigChanged={refreshConfig} />}
          {tab === "schedules" && (
            <SchedulesTab agentId={agentId} onConfigChanged={refreshConfig} />
          )}
        </div>
      </div>
    </div>
  );
}

type SaveFn = (update: AgentConfigUpdateRequest) => Promise<void>;

/** Kernel-outdated hint icon (rotate-cw, 24×24 line path — the skill library's update glyph). */
const KERNEL_UPDATE_ICON = "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10";

function OverviewTab({
  data,
  agentId,
  onSave,
  onImported,
  onConfigReset,
  onKernelUpdated,
}: {
  data: AgentConfigResponse;
  agentId: string;
  onSave: SaveFn;
  onImported: (version: number) => void;
  onConfigReset: () => void;
  onKernelUpdated: () => void;
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
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [kernelOpen, setKernelOpen] = useState(false);
  const [kernelUpdating, setKernelUpdating] = useState(false);
  /** Last kernel update's merge report (kept fields listed under the section until the next full reload). */
  const [kernelResult, setKernelResult] = useState<AgentKernelUpdateResponse | null>(null);
  const { requestSave, element: saveConfirm } = useSaveConfirm();

  const runReset = async () => {
    if (!projectId) return;
    setResetting(true);
    try {
      await api.resetAgentConfig(projectId, agentId);
      setResetOpen(false);
      onConfigReset();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setResetting(false);
    }
  };

  const runKernelUpdate = async () => {
    if (!projectId) return;
    setKernelUpdating(true);
    try {
      const res = await api.kernelUpdateAgentConfig(projectId, agentId);
      setKernelOpen(false);
      setKernelResult(res);
      toastSuccess(S.agent.kernelUpdateDone(res.kernelVersion, res.advanced.length));
      onKernelUpdated();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setKernelUpdating(false);
    }
  };

  const submit = () => {
    const config: NonNullable<AgentConfigUpdateRequest["config"]> = {};
    if (name.trim() !== (data.config.name ?? "")) config.name = name.trim();
    if (description.trim() !== (data.config.description ?? "")) {
      config.description = description.trim();
    }
    if (Object.keys(config).length === 0) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    requestSave(() => void onSave({ config }));
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
        setImportError(apiErrorText(e));
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
    fileToBase64(file).then(
      (dataBase64) => void runImport(dataBase64, false),
      () => setImportError(S.common.unknownError),
    );
  };

  return (
    <div className="space-y-4">
      <Input
        size="sm"
        label={S.common.name}
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
      <Button size="sm" variant="primary" onClick={submit}>
        {S.common.save}
      </Button>
      {saveConfirm}

      {/* Agent State section (ruled, the skills import modal's section family — no card
          boxes; per user feedback the sections separate with a top rule and the values
          carry the visual weight): title row with the snapshot transfer actions on the
          right (export is available to any member; import overwrites the entire Agent
          State, so it is visible only to owners), labeled value rows below — light
          text-xs labels over dark font-semibold values. */}
      <section className="border-t border-gray-200 pt-4 dark:border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {S.agent.stateTitle}
            <InfoPopover label={S.agent.stateTitle}>{S.agent.transferDesc}</InfoPopover>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {/* The portable bundle first, then the snapshot pair: two exports with different
                jobs, named apart — a bundle ports the Agent, a snapshot backs its state up. */}
            {projectId && (
              <a
                href={api.agentBundleUrl(projectId, agentId)}
                download
                title={S.agent.exportAgentDesc}
                className={SNAPSHOT_BUTTON_CLASS}
              >
                {S.agent.exportAgent}
              </a>
            )}
            {projectId && (
              <a
                href={api.agentExportUrl(projectId, agentId)}
                download
                className={SNAPSHOT_BUTTON_CLASS}
              >
                {S.agent.exportSnapshot}
              </a>
            )}
            {isOwner && (
              <label
                className={`${SNAPSHOT_BUTTON_CLASS} ${importing ? "pointer-events-none opacity-60" : ""}`}
              >
                <HiddenFileInput
                  accept={SNAPSHOT_ACCEPT}
                  disabled={importing}
                  onChange={onPickFile}
                />
                {importing ? S.agent.importing : S.agent.importSnapshot}
              </label>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-2.5">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {S.agent.stateVersion}
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold">v{data.config.version}</p>
          </div>
          {/* State path row (the chat details card's Session id convention): selectable mono
              text with the shared CopyButton beside it; the title attribute carries the full
              path for hover. */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {S.agent.stateDir}
            </p>
            <div className="flex items-start gap-1.5">
              <span
                title={data.stateDir}
                className="min-w-0 flex-1 break-all font-mono text-xs leading-5"
              >
                {data.stateDir}
              </span>
              <CopyButton
                text={data.stateDir}
                label={S.agent.copyStateDir}
                className={ROW_COPY_CLASS}
              />
            </div>
          </div>
        </div>
        {importError && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{importError}</p>
        )}
      </section>

      {/* Kernel section (same ruled family as Agent State — no lone card): the defaults
          generation the config is based on, with its two maintenance actions in the title
          row — update (smart merge, enabled only when outdated) and restore defaults
          (destructive, danger tone). Both keep their confirm-first modals below. The value
          line renders the generation dates dark and semibold with the connector words kept
          light, mirroring the State rows' label/value contrast. */}
      <section className="border-t border-gray-200 pt-4 dark:border-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* Last stop on the kernel trail: the dot sits on the update control itself, straddling
              the top-right corner of the enabled button's border (the anchoring rule in
              update-dot.tsx), not hung off the section title's text, whose flex item is only
              as wide as its glyphs. The dot is decorative — the sr-only sentence folds what is
              waiting into the button's accessible name, in the same wording the trail carried
              all the way down. */}
          <p className="text-sm font-medium">{S.agent.kernelTitle}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="relative"
              disabled={kernelUpdating || !data.config.kernelOutdated}
              onClick={() => setKernelOpen(true)}
            >
              {S.agent.kernelUpdateAction}
              {data.config.kernelOutdated && (
                <>
                  <UpdateDot
                    size="inline"
                    position="right-0.5 top-0.5 -translate-y-1/2 translate-x-1/2"
                  />
                  <span className="sr-only"> · {S.agent.kernelOutdatedHint}</span>
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={resetting}
              onClick={() => setResetOpen(true)}
            >
              {S.agent.resetConfigAction}
            </Button>
          </div>
        </div>
        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm">
          {data.config.kernelOutdated ? (
            <>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {S.agent.kernelCurrent}
              </span>
              <span className="font-mono font-semibold">
                {data.config.kernelVersion ?? S.agent.kernelLegacy}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                · {S.agent.kernelLatest}
              </span>
              <span className="font-mono font-semibold">{data.config.kernelLatest}</span>
              {/* Minimal outdated hint: icon + tooltip only (no textual alarm). */}
              <span
                role="img"
                title={S.agent.kernelOutdatedHint}
                aria-label={S.agent.kernelOutdatedHint}
                className="self-center text-gray-500 dark:text-gray-400"
              >
                <GlyphIcon d={KERNEL_UPDATE_ICON} size={12} />
              </span>
            </>
          ) : (
            <>
              <span className="font-mono font-semibold">{data.config.kernelVersion}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                · {S.agent.kernelUpToDate}
              </span>
            </>
          )}
        </p>
        {/* Merge report: which fields the last update kept because customized (lightweight inline note). */}
        {kernelResult !== null && kernelResult.kept.length > 0 && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {S.agent.kernelUpdateKeptIntro}
            {kernelResult.kept.map(kernelTabLabel).join(S.agent.kernelListSeparator)}
          </p>
        )}
      </section>

      {/* Version conflict confirmation: resend the same package with confirm: true after confirming. */}
      <ConfirmModal
        open={conflict !== null}
        title={S.agent.importConflictTitle}
        busy={importing}
        onClose={() => setConflict(null)}
        onConfirm={() => {
          if (conflict !== null) void runImport(conflict, true);
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.agent.importConflictBody}</p>
      </ConfirmModal>

      {/* Kernel update confirmation: lossless by design, but it still rewrites config fields —
          confirm-first like the sibling reset, with the primary (overwrite) tone rather than
          the reset's danger tone. */}
      <ConfirmModal
        open={kernelOpen}
        title={S.agent.kernelUpdateTitle}
        busy={kernelUpdating}
        tone="primary"
        onClose={() => setKernelOpen(false)}
        onConfirm={() => void runKernelUpdate()}
        confirmLabel={S.agent.kernelUpdateAction}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.agent.kernelUpdateConfirmBody}
        </p>
      </ConfirmModal>

      {/* Reset confirmation: overwriting customizations with the defaults is destructive, so it keeps the danger tone. */}
      <ConfirmModal
        open={resetOpen}
        title={S.agent.resetConfigTitle}
        busy={resetting}
        onClose={() => setResetOpen(false)}
        onConfirm={() => void runReset()}
        confirmLabel={S.agent.resetConfigAction}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.agent.resetConfigConfirmBody}</p>
      </ConfirmModal>
    </div>
  );
}

function PromptTab({ data, onSave }: { data: AgentConfigResponse; onSave: SaveFn }) {
  const [agentsMd, setAgentsMd] = useState(data.agentsMd);
  const [systemPrompt, setSystemPrompt] = useState(data.config.systemPrompt);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const { requestSave, element: saveConfirm } = useSaveConfirm();

  const submit = () => {
    const update: AgentConfigUpdateRequest = {};
    if (agentsMd !== data.agentsMd) update.agentsMd = agentsMd;
    if (systemPrompt !== data.config.systemPrompt) update.config = { systemPrompt };
    if (update.agentsMd === undefined && update.config === undefined) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    requestSave(() => void onSave(update));
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
      {saveConfirm}
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
  const [fieldErrors, setFieldErrors] = useState<{ maxTurns?: string; timeoutMs?: string }>({});
  const clearFieldErrors = () => setFieldErrors((p) => (p.maxTurns || p.timeoutMs ? {} : p));
  const { requestSave, element: saveConfirm } = useSaveConfirm();

  const submit = () => {
    setFieldErrors({});
    const config: NonNullable<AgentConfigUpdateRequest["config"]> = {};

    const mt = parseNum(maxTurns);
    if (mt !== undefined && mt !== cfg.maxTurns) {
      if (mt <= 0 && mt !== -1) {
        setFieldErrors({ maxTurns: S.agent.maxTurnsInvalid });
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
        setFieldErrors({ timeoutMs: S.agent.timeoutInvalid });
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

    if (Object.keys(config).length === 0) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    requestSave(() => void onSave({ config }));
  };

  // S is reassigned on language switch (live binding), so read it during render rather than hoisting to a module-level constant.
  // Thinking level composes both review rounds: the "" inherit row is filtered (the user picks
  // explicitly; unset shows the (default) placeholder and the reset link rewinds to it), "none"
  // is no longer offered (many models cannot disable thinking) but stays a valid stored value —
  // when the **persisted** config carries it, a display-only legacy row is appended, so a
  // misclick onto another tier keeps it reachable until the change is actually saved
  // (see thinking-level.ts).
  const thinkingLevelOptions = thinkingLevelOptionsFor(
    S.agent.thinkingLevelOptions,
    S.agent.thinkingLevelNoneKept,
    cfg.model?.thinkingLevel,
  );
  const compactionModeOptions = optionRows(S.agent.compactionModeOptions);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label={S.agent.maxTurns}
              size="sm"
              value={maxTurns}
              error={fieldErrors.maxTurns}
              onChange={(e) => {
                setMaxTurns(e.target.value);
                clearFieldErrors();
              }}
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
              placeholder={S.agent.defaultValue}
              value={thinkingLevel}
              onChange={setThinkingLevel}
              options={thinkingLevelOptions}
            />
            <Input
              label={S.agent.timeoutMs}
              info={S.agent.timeoutMsHint}
              infoLabel={S.agent.timeoutMs}
              size="sm"
              value={timeoutMs}
              error={fieldErrors.timeoutMs}
              onChange={(e) => {
                setTimeoutMs(e.target.value);
                clearFieldErrors();
              }}
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
              info={S.agent.maxContextLengthHint}
              infoLabel={S.agent.maxContextLength}
              size="sm"
              value={maxContextLength}
              onChange={(e) => setMaxContextLength(e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <Input
              label={S.agent.maxSessionTurns}
              info={S.agent.maxSessionTurnsHint}
              infoLabel={S.agent.maxSessionTurns}
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
              placeholder={S.agent.defaultValue}
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

      <Button size="sm" variant="primary" onClick={submit}>
        {S.common.save}
      </Button>
      {saveConfirm}
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
  // Per-cell validation errors, keyed `${rowIndex}-${column}`, shown red under the offending numeric input.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { requestSave, element: saveConfirm } = useSaveConfirm();

  const update = (index: number, patch: Partial<ToolRowState>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setFieldErrors((p) => {
      const kt = `${index}-timeoutMs`;
      const km = `${index}-maxOutputLength`;
      if (!p[kt] && !p[km]) return p;
      const next = { ...p };
      delete next[kt];
      delete next[km];
      return next;
    });
  };

  const submit = () => {
    // toolsBuiltin is submitted as a full table: an empty string omits that key (revert to default); non-empty values are validated per the server's rules.
    const errs: Record<string, string> = {};
    const tools: ToolDefinitionConfig[] = [];
    for (const [i, row] of rows.entries()) {
      const tool: ToolDefinitionConfig = { ...row.base };
      delete tool.timeoutMs;
      delete tool.maxOutputLength;
      const timeout = row.timeoutMs.trim();
      if (timeout) {
        const n = Number(timeout);
        if (!Number.isInteger(n) || (n <= 0 && n !== -1)) {
          errs[`${i}-timeoutMs`] = S.agent.toolFieldInvalid(row.base.name, "timeoutMs");
        } else tool.timeoutMs = n;
      }
      const maxOutput = row.maxOutputLength.trim();
      if (maxOutput) {
        const n = Number(maxOutput);
        if (!Number.isInteger(n) || (n <= 0 && n !== -1)) {
          errs[`${i}-maxOutputLength`] = S.agent.toolFieldInvalid(row.base.name, "maxOutputLength");
        } else tool.maxOutputLength = n;
      }
      // call_description: missing = true, so flipping a stored-missing row back to on
      // rewinds to "not written" instead of writing the default explicitly.
      const origRow = data.config.toolsBuiltin[i];
      if (tool.call_description === true && origRow?.call_description === undefined) {
        delete tool.call_description;
      }
      tools.push(tool);
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    // The table is submitted whole, so compare the editable columns against the loaded
    // config to detect a no-op save (row order is stable — both sides map the same list).
    const orig = data.config.toolsBuiltin;
    const dirty =
      tools.length !== orig.length ||
      tools.some((t, i) => {
        const o = orig[i]!;
        return (
          t.permission !== o.permission ||
          t.timeoutMs !== o.timeoutMs ||
          t.maxOutputLength !== o.maxOutputLength ||
          t.call_description !== o.call_description
        );
      });
    if (!dirty) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    requestSave(() => void onSave({ config: { toolsBuiltin: tools } }));
  };

  /** Whether a tool's config schema declares the optional `description` call argument (only then does the per-row switch make sense). */
  const hasDescriptionProperty = (t: ToolDefinitionConfig): boolean => {
    const props = (t.parameters as { properties?: Record<string, unknown> } | undefined)
      ?.properties;
    return props !== undefined && props !== null && props["description"] !== undefined;
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
              <th className="px-3 py-2">{S.common.name}</th>
              <th className="px-3 py-2">{S.agent.toolPermission}</th>
              <th className="px-3 py-2">{S.agent.toolTimeout}</th>
              <th className="px-3 py-2">{S.agent.toolMaxOutput}</th>
              <th className="px-3 py-2">
                <span className="flex items-center gap-1.5">
                  {S.agent.toolCallDescription}
                  <InfoPopover label={S.agent.toolCallDescription}>
                    {S.agent.callDescriptionHint}
                  </InfoPopover>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.base.name} className="border-b border-gray-100 dark:border-gray-800/60">
                <td className="px-3 py-2 align-top font-mono text-xs">{row.base.name}</td>
                <td className="px-3 py-2 align-top">
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
                <td className="px-3 py-2 align-top">
                  <Input
                    size="sm"
                    value={row.timeoutMs}
                    error={fieldErrors[`${i}-timeoutMs`]}
                    inputMode="numeric"
                    className="font-mono"
                    onChange={(e) => update(i, { timeoutMs: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <Input
                    size="sm"
                    value={row.maxOutputLength}
                    error={fieldErrors[`${i}-maxOutputLength`]}
                    inputMode="numeric"
                    className="font-mono"
                    onChange={(e) => update(i, { maxOutputLength: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  {/* Per-tool call_description switch (missing = on): shown only for tools whose
                      config schema actually declares the description argument. */}
                  {hasDescriptionProperty(row.base) ? (
                    <Switch
                      checked={row.base.call_description !== false}
                      onChange={(v) => update(i, { base: { ...row.base, call_description: v } })}
                      aria-label={`${row.base.name} ${S.agent.toolCallDescription}`}
                    />
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button size="sm" variant="primary" onClick={submit}>
        {S.common.save}
      </Button>
      {saveConfirm}
    </div>
  );
}
