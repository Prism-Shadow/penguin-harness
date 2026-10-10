/**
 * Agent settings page: ten tabs —
 * Overview (name/description form + two ruled sections in the skills import modal's
 * family: Agent State — State version, snapshot export-import and the copyable State
 * path — and Kernel — the defaults generation with its update / restore-defaults
 * actions), System Prompt (AGENTS.md and system_prompt editors + placeholder
 * reference), Runtime (max_turns, model.*, compaction.*), Tools (editable built-in
 * tools table + the MCP Server form, mcp-servers-section.tsx), Skills (skills-tab.tsx),
 * Hooks (hooks-tab.tsx), Memory (memory-tab.tsx), Vault (vault-tab.tsx), Schedule
 * (schedules-tab.tsx), API (api-tab.tsx: the Agent's public API, kept by this server).
 * Save = PUT config (sends only the changed keys; YAML comments are preserved
 * server-side).
 *
 * Every form tab follows the settings commit model: its typed fields are a draft
 * (`useFormDraft`) that only Save writes, Save is live only while the draft changed and is
 * valid, and Reset puts the stored values back. The open tab lives in `?tab=` alone, so a tab
 * switch, Back, a sidebar link and the browser's back button are all navigations that the
 * app's leave guard holds while a tab has unsaved edits. Switches write at once, alone — the
 * tools table's `call_description` included. A snapshot import asks before it replaces the
 * Agent State.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type {
  AgentConfigDto,
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  AgentKernelUpdateResponse,
} from "@prismshadow/penguin-server/api";
import type { ToolPermission } from "@prismshadow/penguin-core/interfaces";
import {
  Button,
  Card,
  ConfirmModal,
  CopyButton,
  GlyphIcon,
  HiddenFileInput,
  ICONS,
  InfoPopover,
  Input,
  OptionMenu,
  PageFrame,
  PageHeader,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  Textarea,
  UpdateDot,
  toastError,
  toastSuccess,
  useFormDraft,
} from "@prismshadow/penguin-ui";
import type { OptionMenuChoice } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useProject } from "../../state/project";
import { normalizeRuntime, runtimeDraftOf, runtimeErrors, runtimeUpdateOf } from "./runtime-form";
import type { RuntimeDraft, RuntimeNumberField } from "./runtime-form";
import {
  hasDescriptionProperty,
  normalizeTools,
  toolsDraftOf,
  toolsErrors,
  toolsUpdateOf,
  withCallDescription,
} from "./tools-form";
import type { ToolNumberField, ToolRowDraft } from "./tools-form";
import { SkillsTab } from "./skills-tab";
import { HooksTab } from "./hooks-tab";
import { MemoryTab } from "./memory-tab";
import { kernelTabLabel } from "./kernel-labels";
import { VaultTab } from "./vault-tab";
import { SchedulesTab } from "./schedules-tab";
import { ApiTab } from "./api-tab";
import { McpServersSection } from "./mcp-servers-section";
import { SNAPSHOT_ACCEPT, SNAPSHOT_BUTTON_CLASS, fileToBase64 } from "./snapshot-file";
import { thinkingLevelOptionsFor } from "../chat/thinking-level";

type TabKey =
  | "overview"
  | "prompt"
  | "runtime"
  | "tools"
  | "skills"
  | "hooks"
  | "memory"
  | "vault"
  | "schedules"
  | "api";

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
    { key: "api", label: S.agent.tabApi },
  ] as const;
  const navigate = useNavigate();
  const params = useParams<{ agentId: string }>();
  const agentId = params.agentId ?? "";
  useDocumentTitle(S.agent.settings);
  const { currentProject, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [data, setData] = useState<AgentConfigResponse | null>(null);
  // The open tab is the `?tab=` value alone (the Agents page's stat icons deep-link with it;
  // missing or unknown values fall back to "overview"). A switch only writes the address, so
  // it is a navigation: while the open tab holds unsaved edits the app's leave guard asks
  // before it happens, and the tab on screen never runs ahead of the address it would leave.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = resolveTabKey(searchParams.get("tab"), TABS, "overview");
  /** Writes the tab into `?tab=` (replacing the history entry, keeping the other params). */
  const switchTab = useCallback(
    (next: TabKey) => {
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

  /**
   * One config write from a tab. Resolves with the stored config, which the tab adopts as its
   * new baseline; a refused write toasts why and resolves with null, leaving the tab's draft as
   * it was — still dirty.
   */
  const save = useCallback(
    async (update: AgentConfigUpdateRequest): Promise<AgentConfigResponse | null> => {
      if (!projectId || !agentId) return null;
      try {
        const res = await api.putAgentConfig(projectId, agentId, update);
        setData(res);
        // Compaction is the one section core re-reads at every compaction checkpoint, so a save
        // that changed nothing else lands on a running conversation right away; everything else
        // still waits for that conversation's next context. The test is "only compaction", not
        // "compaction among others" — a mixed save is only as immediate as its slowest field.
        const changed = update.config ?? {};
        const compactionOnly =
          update.agentsMd === undefined &&
          Object.keys(changed).length === 1 &&
          changed.compaction !== undefined;
        toastSuccess(compactionOnly ? S.agent.savedTakesEffectNow : S.agent.savedTakesEffect);
        // Name/description changes affect the breadcrumb and list display; a builtin-tools
        // change moves the card's tool count.
        if (
          update.config?.name !== undefined ||
          update.config?.description !== undefined ||
          update.config?.toolsBuiltin !== undefined
        ) {
          void reloadAgents();
        }
        return res;
      } catch (e) {
        toastError(apiErrorText(e));
        return null;
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
    <PageFrame width="sm" className="no-scrollbar relative">
      <PageHeader
        title={data.config.name ?? agentId}
        back={{ label: S.agent.backToList, onClick: () => navigate("/agents") }}
        // The id is data: mono on the small rung. A block keeps its line box at its own
        // 16px rather than the description line's body height.
        description={<span className="block font-mono text-xs text-gray-400">{agentId}</span>}
      />
      {/* The kernel update action lives in the Overview tab's Kernel section, so the trail
          from the Agents list has to cross the tab strip to reach it. */}
      <Tabs
        items={TABS.map((t) =>
          t.key === "overview" && data.config.kernelOutdated
            ? { ...t, badge: S.agent.kernelOutdatedHint }
            : t,
        )}
        active={tab}
        onChange={(next) => {
          if (next !== tab) switchTab(next);
        }}
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
          <div className="space-y-6">
            <ToolsTab data={data} onSave={save} />
            {/* MCP Servers persist vault-style (immediately, own modals) — separate from the
                builtin table's Save button, so it lives beside ToolsTab, not inside it. */}
            <McpServersSection agentId={agentId} initial={data.config.mcpServers} />
          </div>
        )}
        {tab === "skills" && <SkillsTab agentId={agentId} onConfigChanged={refreshConfig} />}
        {tab === "hooks" && <HooksTab agentId={agentId} onConfigChanged={refreshConfig} />}
        {tab === "vault" && <VaultTab agentId={agentId} onConfigChanged={refreshConfig} />}
        {tab === "schedules" && <SchedulesTab agentId={agentId} onConfigChanged={refreshConfig} />}
        {tab === "api" && (
          <ApiTab
            projectId={projectId}
            agentId={agentId}
            isOwner={currentProject?.role === "owner"}
          />
        )}
      </div>
    </PageFrame>
  );
}

/** The page's config write: the stored config on success, null once a refusal has been toasted. */
type SaveFn = (update: AgentConfigUpdateRequest) => Promise<AgentConfigResponse | null>;

/**
 * A form tab's Save and Reset. Save is live only while the draft differs from the stored values
 * and is valid; Reset puts the stored values back without asking, and is live only while there
 * is something to put back.
 */
function SaveRow({
  dirty,
  valid,
  busy,
  onSave,
  onReset,
}: {
  dirty: boolean;
  valid: boolean;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="primary" disabled={!dirty || !valid || busy} onClick={onSave}>
        {S.common.save}
      </Button>
      <Button size="sm" disabled={!dirty || busy} onClick={onReset}>
        {S.common.reset}
      </Button>
    </div>
  );
}

/** Runs one tab save with its busy flag, adopting the stored answer when there is one. */
async function saveWith(
  setBusy: (busy: boolean) => void,
  run: () => Promise<AgentConfigResponse | null>,
  adopt: (res: AgentConfigResponse) => void,
): Promise<void> {
  setBusy(true);
  try {
    const res = await run();
    if (res !== null) adopt(res);
  } finally {
    setBusy(false);
  }
}

interface OverviewDraft {
  name: string;
  description: string;
}

const overviewDraftOf = (config: AgentConfigDto): OverviewDraft => ({
  name: config.name ?? "",
  description: config.description ?? "",
});

/** What Save sends: both fields trimmed. */
const trimOverview = (draft: OverviewDraft): OverviewDraft => ({
  name: draft.name.trim(),
  description: draft.description.trim(),
});

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
  const form = useFormDraft(overviewDraftOf(data.config), { normalize: trimOverview });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  /** A picked snapshot package awaiting the overwrite confirmation: an import replaces the whole Agent State. */
  const [pendingImport, setPendingImport] = useState<{ name: string; dataBase64: string } | null>(
    null,
  );
  // base64 of the snapshot package pending confirmation for a version conflict (409 version_conflict); non-null shows the confirm modal.
  const [conflict, setConflict] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [kernelOpen, setKernelOpen] = useState(false);
  const [kernelUpdating, setKernelUpdating] = useState(false);
  /** Last kernel update's merge report (kept fields listed under the section until the next full reload). */
  const [kernelResult, setKernelResult] = useState<AgentKernelUpdateResponse | null>(null);

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

  /** Sends the trimmed fields that differ from the stored ones. */
  const submit = () => {
    const draft = trimOverview(form.draft);
    const stored = trimOverview(form.baseline);
    const config: NonNullable<AgentConfigUpdateRequest["config"]> = {};
    if (draft.name !== stored.name) config.name = draft.name;
    if (draft.description !== stored.description) config.description = draft.description;
    void saveWith(
      setSaving,
      () => onSave({ config }),
      (res) => form.adopt(overviewDraftOf(res.config)),
    );
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
      (dataBase64) => setPendingImport({ name: file.name, dataBase64 }),
      () => setImportError(S.common.unknownError),
    );
  };

  return (
    <div className="space-y-4">
      <Input
        size="sm"
        label={S.common.name}
        value={form.draft.name}
        onChange={(e) => form.patch({ name: e.target.value })}
      />
      <Textarea
        label={S.agent.description}
        size="sm"
        rows={3}
        value={form.draft.description}
        onChange={(e) => form.patch({ description: e.target.value })}
      />
      <SaveRow dirty={form.dirty} valid busy={saving} onSave={submit} onReset={form.reset} />

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
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {S.agent.stateVersion}
            </p>
            <p className="mt-0.5 font-mono text-sm font-semibold">v{data.config.version}</p>
          </div>
          {/* State path row (the chat details card's Session id convention): selectable mono
              text with the shared CopyButton beside it; the path wraps, so it is always shown
              whole. */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {S.agent.stateDir}
            </p>
            <div className="flex items-start gap-1.5">
              <span className="min-w-0 flex-1 break-all font-mono text-xs leading-5">
                {data.stateDir}
              </span>
              <CopyButton
                text={data.stateDir}
                label={S.agent.copyStateDir}
                size="sm"
                className="shrink-0"
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
        <p className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm">
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
                data-tooltip={S.agent.kernelOutdatedHint}
                aria-label={S.agent.kernelOutdatedHint}
                className="self-center text-gray-500 dark:text-gray-400"
              >
                <GlyphIcon d={ICONS.rotateCw} size={12} />
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

      {/* Overwrite confirmation, before every import: the package replaces the whole Agent
          State. An overwrite, not a deletion, so it takes the primary (pencil) tone. A package
          that is not newer still meets the version-conflict prompt below. */}
      <ConfirmModal
        open={pendingImport !== null}
        title={S.agent.importSnapshot}
        tone="primary"
        onClose={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport !== null) void runImport(pendingImport.dataBase64, false);
          setPendingImport(null);
        }}
        confirmLabel={S.agent.importSnapshot}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {pendingImport !== null ? S.agent.importConfirmBody(pendingImport.name) : ""}
        </p>
      </ConfirmModal>

      {/* Version conflict confirmation: resend the same package with confirm: true after confirming. */}
      <ConfirmModal
        open={conflict !== null}
        title={S.agent.importConflictTitle}
        busy={importing}
        tone="primary"
        onClose={() => setConflict(null)}
        onConfirm={() => {
          if (conflict !== null) void runImport(conflict, true);
        }}
        confirmLabel={S.agent.importSnapshot}
        cancelLabel={S.common.cancel}
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
        cancelLabel={S.common.cancel}
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
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.agent.resetConfigConfirmBody}</p>
      </ConfirmModal>
    </div>
  );
}

/** The props every form tab takes: the loaded config and the page's save. */
interface FormTabProps {
  data: AgentConfigResponse;
  onSave: SaveFn;
}

interface PromptDraft {
  agentsMd: string;
  systemPrompt: string;
}

const promptDraftOf = (res: AgentConfigResponse): PromptDraft => ({
  agentsMd: res.agentsMd,
  systemPrompt: res.config.systemPrompt,
});

function PromptTab({ data, onSave }: FormTabProps) {
  // Both editors compare exactly: whitespace is part of a prompt.
  const form = useFormDraft(promptDraftOf(data));
  const [saving, setSaving] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const update: AgentConfigUpdateRequest = {};
    if (form.draft.agentsMd !== form.baseline.agentsMd) update.agentsMd = form.draft.agentsMd;
    if (form.draft.systemPrompt !== form.baseline.systemPrompt) {
      update.config = { systemPrompt: form.draft.systemPrompt };
    }
    void saveWith(
      setSaving,
      () => onSave(update),
      (res) => form.adopt(promptDraftOf(res)),
    );
  };

  /**
   * Quickly insert a placeholder at the system_prompt cursor position (appends to the
   * end when unfocused). Prefers execCommand insertText — it writes to the browser's
   * undo stack (undoable with Ctrl/⌘+Z) and fires an input event, which the
   * controlled onChange syncs into the draft; falls back to directly editing the draft when
   * unsupported (no undo).
   */
  const insertPlaceholder = (ph: string) => {
    const el = promptRef.current;
    if (el) {
      el.focus();
      // execCommand is deprecated but still the only available way to preserve the textarea's native undo stack.
      const inserted = document.execCommand?.("insertText", false, ph);
      if (inserted) return; // onChange will update the draft from e.target.value
    }
    const value = form.draft.systemPrompt;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    form.patch({ systemPrompt: value.slice(0, start) + ph + value.slice(end) });
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
        value={form.draft.agentsMd}
        onChange={(e) => form.patch({ agentsMd: e.target.value })}
      />
      <Textarea
        ref={promptRef}
        label={S.agent.systemPrompt}
        mono
        size="sm"
        rows={12}
        value={form.draft.systemPrompt}
        onChange={(e) => form.patch({ systemPrompt: e.target.value })}
      />
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
        <p className="mb-2 text-xs font-semibold text-gray-500">{S.agent.placeholdersTitle}</p>
        <ul className="space-y-1">
          {S.agent.placeholders.map(([ph, desc]) => (
            <li key={ph} className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => insertPlaceholder(ph)}
                data-tooltip={S.agent.insertPlaceholder}
                className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono font-semibold text-gray-800 transition-colors duration-150 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-700"
              >
                {ph}
              </button>
              <span className="text-gray-500 dark:text-gray-400">{desc}</span>
            </li>
          ))}
        </ul>
      </div>
      <SaveRow dirty={form.dirty} valid busy={saving} onSave={submit} onReset={form.reset} />
    </div>
  );
}

function RuntimeTab({ data, onSave }: FormTabProps) {
  const cfg = data.config;
  // The five numbers, the two menus and the prompt are one form: the menus sit inside it, so
  // they save with it (a menu that stood alone in its row would write at once instead).
  const form = useFormDraft(runtimeDraftOf(cfg), { normalize: normalizeRuntime });
  const errors = runtimeErrors(form.draft, form.baseline);
  const [saving, setSaving] = useState(false);

  /** A number box's inline error, judged only once it differs from the stored value. */
  const errorOf = (field: RuntimeNumberField): string | undefined => {
    const error = errors?.[field];
    if (error === "invalid") return S.agent.numberInvalid;
    if (error === "cannotClear") return S.agent.numberCannotClear;
    return undefined;
  };
  const setNumber = (field: RuntimeNumberField, value: string) =>
    form.patch({ [field]: value } as Partial<RuntimeDraft>);

  /** Sends the keys that differ from the stored config, and nothing else. */
  const submit = () => {
    if (errors !== null) return;
    const config = runtimeUpdateOf(form.draft, form.baseline);
    void saveWith(
      setSaving,
      () => onSave({ config }),
      (res) => form.adopt(runtimeDraftOf(res.config)),
    );
  };

  // S is reassigned on language switch (live binding), so read it during render rather than hoisting to a module-level constant.
  // Thinking level composes both review rounds: the "" inherit row is filtered (the user picks
  // explicitly; unset shows the (default) placeholder and Reset rewinds to it), "none"
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
      <Card padding="none">
        <div className="p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label={S.agent.maxTurns}
              size="sm"
              value={form.draft.maxTurns}
              error={errorOf("maxTurns")}
              onChange={(e) => setNumber("maxTurns", e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <Input
              label={S.agent.maxTokens}
              size="sm"
              value={form.draft.maxTokens}
              error={errorOf("maxTokens")}
              onChange={(e) => setNumber("maxTokens", e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <OptionMenu
              label={S.agent.thinkingLevel}
              fullWidth
              size="sm"
              placeholder={S.agent.defaultValue}
              value={form.draft.thinkingLevel}
              onChange={(thinkingLevel) => form.patch({ thinkingLevel })}
              options={thinkingLevelOptions}
            />
            <Input
              label={S.agent.timeoutMs}
              info={S.agent.timeoutMsHint}
              infoLabel={S.agent.timeoutMs}
              size="sm"
              value={form.draft.timeoutMs}
              error={errorOf("timeoutMs")}
              onChange={(e) => setNumber("timeoutMs", e.target.value)}
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
              value={form.draft.maxContextLength}
              error={errorOf("maxContextLength")}
              onChange={(e) => setNumber("maxContextLength", e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <Input
              label={S.agent.maxSessionTurns}
              info={S.agent.maxSessionTurnsHint}
              infoLabel={S.agent.maxSessionTurns}
              size="sm"
              value={form.draft.maxSessionTurns}
              error={errorOf("maxSessionTurns")}
              onChange={(e) => setNumber("maxSessionTurns", e.target.value)}
              inputMode="numeric"
              className="font-mono"
            />
            <OptionMenu
              label={S.agent.compactionMode}
              fullWidth
              size="sm"
              placeholder={S.agent.defaultValue}
              value={form.draft.mode}
              onChange={(mode) => form.patch({ mode })}
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
            value={form.draft.prompt}
            onChange={(e) => form.patch({ prompt: e.target.value })}
          />
        </div>
      </Card>

      <SaveRow
        dirty={form.dirty}
        valid={errors === null}
        busy={saving}
        onSave={submit}
        onReset={form.reset}
      />
    </div>
  );
}

function ToolsTab({ data, onSave }: FormTabProps) {
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
  const stored = data.config.toolsBuiltin;
  // The permission menus and the two number columns are the table's draft (see tools-form.ts);
  // the call_description switches are not — each writes at once, alone.
  const form = useFormDraft(toolsDraftOf(stored), { normalize: normalizeTools });
  const errors = toolsErrors(form.draft, form.baseline);
  const [saving, setSaving] = useState(false);
  /** A call_description write in flight: the row it flips and the value it shows meanwhile. */
  const [flip, setFlip] = useState<{ name: string; on: boolean } | null>(null);
  // One write at a time: a flip and a table Save both PUT the whole table, so one landing
  // after the other must not carry the other's stale copy.
  const writing = saving || flip !== null;

  const setRow = (name: string, patch: Partial<ToolRowDraft>) =>
    form.setDraft((rows) => rows.map((r) => (r.name === name ? { ...r, ...patch } : r)));

  /**
   * The switch: the stored table with this one row flipped, written at once. The table's draft
   * beside it stays as typed; a refused write toasts (the page's save) and the switch shows the
   * stored value again.
   */
  const flipCallDescription = async (name: string, on: boolean) => {
    if (writing) return;
    setFlip({ name, on });
    try {
      await onSave({ config: { toolsBuiltin: withCallDescription(stored, name, on) } });
    } finally {
      setFlip(null);
    }
  };

  /** The whole table: the draft laid over the stored rows (a blank cell drops its override). */
  const submit = () => {
    if (errors !== null || writing) return;
    void saveWith(
      setSaving,
      () => onSave({ config: { toolsBuiltin: toolsUpdateOf(stored, form.draft) } }),
      (res) => form.adopt(toolsDraftOf(res.config.toolsBuiltin)),
    );
  };

  const cellError = (row: ToolRowDraft, field: ToolNumberField): string | undefined =>
    errors?.has(`${row.name}/${field}`) === true
      ? S.agent.toolFieldInvalid(row.name, field)
      : undefined;

  return (
    <div className="space-y-4">
      <Table tableClassName="min-w-[640px]">
        <TableHead>
          <TableHeaderCell>{S.common.name}</TableHeaderCell>
          <TableHeaderCell>{S.agent.toolPermission}</TableHeaderCell>
          <TableHeaderCell>{S.agent.toolTimeout}</TableHeaderCell>
          <TableHeaderCell>{S.agent.toolMaxOutput}</TableHeaderCell>
          <TableHeaderCell>
            <span className="flex items-center gap-1.5">
              {S.agent.toolCallDescription}
              <InfoPopover label={S.agent.toolCallDescription}>
                {S.agent.callDescriptionHint}
              </InfoPopover>
            </span>
          </TableHeaderCell>
        </TableHead>
        <TableBody>
          {form.draft.map((row) => {
            const tool = stored.find((t) => t.name === row.name);
            return (
              <TableRow key={row.name}>
                <TableCell className="align-top font-mono text-xs">{row.name}</TableCell>
                <TableCell className="align-top">
                  <OptionMenu
                    mono
                    size="sm"
                    aria-label={S.agent.toolPermission}
                    placeholder={S.agent.defaultValue}
                    options={permissionOptions}
                    value={row.permission}
                    onChange={(permission) => setRow(row.name, { permission })}
                  />
                </TableCell>
                <TableCell className="align-top">
                  <Input
                    size="sm"
                    aria-label={`${row.name} ${S.agent.toolTimeout}`}
                    value={row.timeoutMs}
                    error={cellError(row, "timeoutMs")}
                    inputMode="numeric"
                    className="font-mono"
                    onChange={(e) => setRow(row.name, { timeoutMs: e.target.value })}
                  />
                </TableCell>
                <TableCell className="align-top">
                  <Input
                    size="sm"
                    aria-label={`${row.name} ${S.agent.toolMaxOutput}`}
                    value={row.maxOutputLength}
                    error={cellError(row, "maxOutputLength")}
                    inputMode="numeric"
                    className="font-mono"
                    onChange={(e) => setRow(row.name, { maxOutputLength: e.target.value })}
                  />
                </TableCell>
                <TableCell className="align-top">
                  {/* Per-tool call_description switch (missing = on): shown only for tools whose
                      config schema actually declares the description argument. */}
                  {tool !== undefined && hasDescriptionProperty(tool) ? (
                    <Switch
                      checked={flip?.name === row.name ? flip.on : tool.call_description !== false}
                      disabled={writing}
                      onChange={(on) => void flipCallDescription(row.name, on)}
                      aria-label={`${row.name} ${S.agent.toolCallDescription}`}
                    />
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <SaveRow
        dirty={form.dirty}
        valid={errors === null}
        busy={writing}
        onSave={submit}
        onReset={form.reset}
      />
    </div>
  );
}
