/**
 * Agent settings page "Memory" tab: the switch, then every memory the Agent keeps, grouped by
 * scope — user memory first (read by every Session), then one group per Workspace (labeled by
 * its `.workspace` path, newest activity first).
 *
 * The tab is read + delete only, matching the API: a memory's content is the model's document,
 * so both "edit" and each scope header's "import" open a bridge modal first — a text field and
 * a live preview of the generated prompt, the same shape as the skill import modal — and then
 * jump to a new chat with this Agent and the prompt as the prefilled draft (the same
 * draft-cache route). For a Workspace scope the draft also pins that Workspace, so the Session
 * is injected with the very index it is about to change. Deleting confirms first and also
 * drops the file's MEMORY.md index lines (server-side).
 *
 * The switch writes immediately rather than joining a tab-level Save, so turning Memory off
 * never drags an unrelated half-finished edit along with it. Off keeps every file and this tab
 * fully usable; it only stops Memory from entering the context and from preparing directories
 * for new Sessions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useNavigate } from "react-router";
import type { MemoryFileInfo, MemoryScopeInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatRelativeDate } from "../../lib/format";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { Textarea } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Chevron } from "../../components/ui/chevron";
import { Drawer } from "../../components/ui/drawer";
import { Sheet, type SheetSnap } from "../../components/ui/sheet";
import { ConfirmModal, useSaveConfirm } from "../../components/ui/confirm-modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Md } from "../chat/md";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { buildMemoryEditPrompt, buildMemoryImportPrompt } from "./memory-chat-prompts";

/** The body without its frontmatter block: the drawer's metadata header already shows those fields, so rendering the raw YAML too would only repeat them. */
function bodyWithoutFrontmatter(content: string): string {
  return content.replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/** Same breakpoint as the chat page's panels: \u22651024px the view opens as a side Drawer, below it as a bottom Sheet. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Collapsed scope keys, persisted per user \u00d7 Project \u00d7 Agent (localStorage, same conventions as
 * the chat draft cache: userId in the key against cross-account leaks, tolerant reads, silent
 * best-effort writes). Only collapsed keys are stored, so new scopes start expanded.
 */
const collapsedStoreKey = (userId: string, projectId: string, agentId: string): string =>
  `penguin.memoryCollapsed.${userId}.${projectId}.${agentId}`;

function readCollapsedScopes(key: string | null): Set<string> {
  if (!key) return new Set();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((s): s is string => typeof s === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsedScopes(key: string | null, collapsed: ReadonlySet<string>): void {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...collapsed]));
  } catch {
    // Quota / private browsing: the collapse state just won't survive the visit.
  }
}

/** One scope group as the tab renders it: the overview entry plus its listed files. */
interface ScopeGroup {
  scope: MemoryScopeInfo;
  files: MemoryFileInfo[];
}

/** A memory selected for an action (view drawer / delete confirm). */
interface Selected {
  scope: MemoryScopeInfo;
  file: MemoryFileInfo;
}

export function MemoryTab({
  agentId,
  onConfigChanged,
}: {
  agentId: string;
  /** Config writes happen here directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them (e.g. the inserted placeholder). */
  onConfigChanged?: () => void;
}) {
  const navigate = useNavigate();
  const { locale } = useLocale();
  const userId = useAuth().user?.userId ?? null;
  const { currentProject, setCurrentAgentId } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [enabled, setEnabled] = useState(true);
  const [templateHasMemory, setTemplateHasMemory] = useState(true);
  const [memoryDir, setMemoryDir] = useState("");
  const [groups, setGroups] = useState<ScopeGroup[] | null>(null);
  // Tab-level error is the initial load failure only; actions report via toast.
  const [error, setError] = useState<string | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const collapseKey = userId && projectId ? collapsedStoreKey(userId, projectId, agentId) : null;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsedScopes(collapseKey));
  const [memoryPrompt, setMemoryPrompt] = useState("");
  const [workspacePrompt, setWorkspacePrompt] = useState("");
  const mainPromptRef = useRef<HTMLTextAreaElement>(null);
  const workspacePromptRef = useRef<HTMLTextAreaElement>(null);
  // Chip clicks steal focus, so track the last-focused prompt field instead of the current one.
  const [lastPromptField, setLastPromptField] = useState<"main" | "workspace">("main");
  const { requestSave, element: saveConfirm } = useSaveConfirm();
  // Open flag and content are separate: the Sheet animates out on close, and nulling the
  // content with it would empty the panel mid-exit. The stale content is simply kept.
  const [viewOpen, setViewOpen] = useState(false);
  const [viewing, setViewing] = useState<(Selected & { content: string }) | null>(null);
  const [editing, setEditing] = useState<Selected | null>(null);
  const [editRequirement, setEditRequirement] = useState("");
  const [importing, setImporting] = useState<MemoryScopeInfo | null>(null);
  const [importContent, setImportContent] = useState("");
  const [removing, setRemoving] = useState<Selected | null>(null);
  // ≥1024px the view opens as a right Drawer, below as a bottom Sheet — same live-updating
  // breakpoint as the chat page's panels; the two are mounted mutually exclusively.
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("half");

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // The collapse state follows its storage slot (login/project switches swap the key in place).
  useEffect(() => {
    setCollapsed(readCollapsedScopes(collapseKey));
  }, [collapseKey]);

  const toggleCollapsed = (scopeKey: string) => {
    const next = new Set(collapsed);
    if (!next.delete(scopeKey)) next.add(scopeKey);
    writeCollapsedScopes(collapseKey, next);
    setCollapsed(next);
  };

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setGroups(null);
    setError(null);
    try {
      const [overview, configView] = await Promise.all([
        api.getMemoryOverview(projectId, agentId),
        api.getAgentConfig(projectId, agentId),
      ]);
      setMemoryPrompt(configView.config.memory.prompt);
      setWorkspacePrompt(configView.config.memory.workspacePrompt);
      setEnabled(overview.enabled);
      setTemplateHasMemory(overview.templateHasMemory);
      setMemoryDir(overview.memoryDir);
      // Stored collapse keys for scopes that no longer exist are pruned on sight, so the
      // entry doesn't linger forever in localStorage.
      const live = new Set(overview.scopes.map((s) => s.scopeKey));
      setCollapsed((prev) => {
        const next = new Set([...prev].filter((k) => live.has(k)));
        if (next.size === prev.size) return prev;
        writeCollapsedScopes(collapseKey, next);
        return next;
      });
      // Files are the source of truth and each scope is one request; fetch them in parallel.
      setGroups(
        await Promise.all(
          overview.scopes.map(async (scope) => {
            try {
              return {
                scope,
                files: (await api.getMemoryFiles(projectId, agentId, scope.scopeKey)).files,
              };
            } catch {
              // One unreadable scope (bad hand-made directory name, raced delete) must not
              // blank the whole tab; it lists as an empty group instead.
              return { scope, files: [] };
            }
          }),
        ),
      );
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId, collapseKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEnabled = async (next: boolean) => {
    if (!projectId) return;
    setSwitchBusy(true);
    try {
      const res = await api.putAgentConfig(projectId, agentId, {
        config: { memory: { enabled: next } },
      });
      setEnabled(res.config.memory.enabled);
      toastSuccess(S.common.saved);
      onConfigChanged?.();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSwitchBusy(false);
    }
  };

  /** The explicit adoption path for an agent whose template predates Memory: one idempotent config write. */
  const insertPlaceholder = async () => {
    if (!projectId) return;
    try {
      const overview = await api.insertMemoryPlaceholder(projectId, agentId);
      setTemplateHasMemory(overview.templateHasMemory);
      toastSuccess(S.memory.insertPlaceholderDone);
      onConfigChanged?.();
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /** Same contract as the Prompt tab's inserter: execCommand keeps the textarea's native undo stack, with a state-splice fallback. */
  const insertPromptToken = (
    ref: RefObject<HTMLTextAreaElement | null>,
    value: string,
    setValue: (next: string) => void,
    token: string,
  ) => {
    const el = ref.current;
    if (el) {
      el.focus();
      const inserted = document.execCommand?.("insertText", false, token);
      if (inserted) return; // onChange updates state from e.target.value
    }
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    setValue(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };

  /** Saves both memory prompts through the ordinary config write (confirm-first, like the other settings tabs). */
  const savePrompts = () =>
    requestSave(() => {
      if (!projectId) return;
      void api
        .putAgentConfig(projectId, agentId, {
          config: { memory: { prompt: memoryPrompt, workspacePrompt } },
        })
        .then((res) => {
          setMemoryPrompt(res.config.memory.prompt);
          setWorkspacePrompt(res.config.memory.workspacePrompt);
          toastSuccess(S.common.saved);
          onConfigChanged?.();
        })
        .catch((e: unknown) => toastError(apiErrorText(e)));
    });

  const openView = async (scope: MemoryScopeInfo, file: MemoryFileInfo) => {
    if (!projectId) return;
    try {
      const res = await api.getMemoryFile(projectId, agentId, scope.scopeKey, file.name);
      setSheetSnap("half"); // Every mobile open starts at the browsing height, like the chat panels.
      setViewing({ scope, file: res.file, content: res.content });
      setViewOpen(true);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const memoryFilePath = (scope: MemoryScopeInfo, file: MemoryFileInfo) =>
    `${memoryDir}/${scope.scopeKey}/${file.name}`;

  /** Opens the edit modal (closing the view panel if it is up): requirement field + prompt preview, then the chat jump. */
  const openEditor = (scope: MemoryScopeInfo, file: MemoryFileInfo) => {
    setViewOpen(false);
    setEditRequirement("");
    setEditing({ scope, file });
  };

  const editPrompt = editing
    ? buildMemoryEditPrompt(
        editing.file.title,
        memoryFilePath(editing.scope, editing.file),
        editRequirement,
      )
    : "";

  const copyEditPrompt = () => {
    void navigator.clipboard
      .writeText(editPrompt)
      .then(() => toastSuccess(S.memory.editCopied))
      .catch(() => toastError(S.common.unknownError));
  };

  /**
   * The bridge-to-chat jump shared by edit and import: prefill the draft (merging over what is
   * already cached, clearing a stale `/agent` handoff chip that would forward the prompt to a
   * different Agent), pin this Agent — and for a Workspace scope pin that Workspace too, so the
   * Session reads the very index it is about to change.
   */
  const openChatWithDraft = (text: string, workspacePath: string | undefined) => {
    if (!userId || !projectId) return;
    const key = draftKey(userId, projectId);
    saveDraft(key, {
      ...loadDraft(key),
      agentId,
      text,
      ...(workspacePath !== undefined ? { workspace: workspacePath } : {}),
      skills: [],
      handoffAgentId: undefined,
    });
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, {
      state: {
        agentId,
        ...(workspacePath !== undefined ? { workspace: workspacePath } : {}),
      },
    });
  };

  const openEditChat = () => {
    if (editing) openChatWithDraft(editPrompt, editing.scope.workspacePath);
  };

  /** Opens the import modal for one scope: content empty, actions disabled until it is filled. */
  const openImport = (scope: MemoryScopeInfo) => {
    setImportContent("");
    setImporting(scope);
  };

  const importPrompt = importing
    ? buildMemoryImportPrompt(`${memoryDir}/${importing.scopeKey}`, importContent)
    : "";

  const copyImportPrompt = () => {
    void navigator.clipboard
      .writeText(importPrompt)
      .then(() => toastSuccess(S.memory.editCopied))
      .catch(() => toastError(S.common.unknownError));
  };

  const openImportChat = () => {
    if (importing) openChatWithDraft(importPrompt, importing.workspacePath);
  };

  const confirmRemove = async () => {
    if (!projectId || !removing) return;
    const target = removing;
    setRemoving(null);
    try {
      await api.deleteMemoryFile(projectId, agentId, target.scope.scopeKey, target.file.name);
      toastSuccess(S.memory.deleteDone);
      if (viewing && viewing.file.name === target.file.name) setViewOpen(false);
      await load();
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;

  const scopeTitle = (scope: MemoryScopeInfo): string =>
    scope.kind === "user"
      ? S.memory.userScope
      : (scope.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) ?? scope.scopeKey);

  const rowActions = (scope: MemoryScopeInfo, file: MemoryFileInfo) => (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button size="sm" onClick={() => void openView(scope, file)}>
        {S.memory.view}
      </Button>
      <Button size="sm" onClick={() => openEditor(scope, file)}>
        {S.memory.edit}
      </Button>
      <Button size="sm" variant="danger" onClick={() => setRemoving({ scope, file })}>
        {S.memory.delete}
      </Button>
    </div>
  );

  const fileRow = (scope: MemoryScopeInfo, file: MemoryFileInfo) => (
    <li key={file.name} className="flex items-center gap-3 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[13px] font-medium text-gray-800 dark:text-gray-200">
          {file.title}
        </p>
        {file.description && (
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{file.description}</p>
        )}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
        {file.updatedAt ?? formatRelativeDate(file.modifiedAt, locale)}
      </span>
      {rowActions(scope, file)}
    </li>
  );

  /** Metadata + rendered body of the memory in view, shared by the Drawer and the Sheet. */
  const viewMeta = viewing && (
    <>
      <span className="text-xs text-gray-400 dark:text-gray-500">
        {viewing.file.updatedAt ?? formatRelativeDate(viewing.file.modifiedAt, locale)}
      </span>
      {viewing.file.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{viewing.file.description}</p>
      )}
      <div className="md-body border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
        <Md text={bodyWithoutFrontmatter(viewing.content)} />
      </div>
    </>
  );

  const viewActions = viewing && (
    <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
      <Button size="sm" onClick={() => openEditor(viewing.scope, viewing.file)}>
        {S.memory.edit}
      </Button>
      <Button size="sm" variant="danger" onClick={() => setRemoving(viewing)}>
        {S.memory.delete}
      </Button>
    </div>
  );

  return (
    <div className="space-y-5">
      <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{S.memory.desc}</p>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{S.memory.enable}</p>
        <Switch checked={enabled} onChange={(v) => void toggleEnabled(v)} disabled={switchBusy} />
      </div>

      {!templateHasMemory && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
          <p className="text-xs text-amber-800 dark:text-amber-300">{S.memory.templateMissing}</p>
          <Button size="sm" onClick={() => void insertPlaceholder()}>
            {S.memory.insertPlaceholder}
          </Button>
        </div>
      )}

      {groups === null ? (
        <SkeletonList rows={4} />
      ) : (
        <div className={enabled ? "space-y-5" : "space-y-5 opacity-60"}>
          {groups.map(({ scope, files }) => {
            const open = !collapsed.has(scope.scopeKey);
            return (
              <section
                key={scope.scopeKey}
                className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800"
              >
                {/* Group header (same convention as the skill library groups): the row toggles
                    collapse, with the Import button a sibling — a real <button> cannot nest
                    another, so the header is a flex pair rather than one full-width button. */}
                <div className="flex w-full items-center bg-gray-50 pr-2.5 dark:bg-gray-900/60">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleCollapsed(scope.scopeKey)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800/60"
                  >
                    <span className="shrink-0 text-sm font-semibold text-gray-800 dark:text-gray-200">
                      {scopeTitle(scope)}
                    </span>
                    {scope.kind === "workspace" && scope.workspacePath !== undefined && (
                      <span className="min-w-0 truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">
                        {scope.workspacePath}
                      </span>
                    )}
                    <span className="min-w-0 flex-1" />
                    <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                      {S.memory.itemCount(files.length)}
                    </span>
                    <Chevron open={open} className="text-gray-400" />
                  </button>
                  <Button size="sm" className="ml-2 shrink-0" onClick={() => openImport(scope)}>
                    {S.memory.import}
                  </Button>
                </div>
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                >
                  {/* inert while collapsed: rows at zero height shouldn't still be Tab-focusable or clickable. */}
                  <div className="overflow-hidden" inert={!open}>
                    {files.length === 0 ? (
                      <p className="px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                        {scope.kind === "user" ? S.memory.emptyUserScope : S.memory.emptyScope}
                      </p>
                    ) : (
                      <ul className="divide-y divide-gray-100 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                        {files.map((file) => fileRow(scope, file))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <section className="space-y-2.5 rounded-lg border border-gray-200 p-3.5 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {S.memory.promptSection}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {S.memory.promptSectionHint}
          </p>
        </div>
        <Textarea
          ref={mainPromptRef}
          label={S.memory.promptLabel}
          mono
          size="sm"
          rows={12}
          value={memoryPrompt}
          onFocus={() => setLastPromptField("main")}
          onChange={(e) => setMemoryPrompt(e.target.value)}
        />
        <Textarea
          ref={workspacePromptRef}
          label={S.memory.workspacePromptLabel}
          mono
          size="sm"
          rows={6}
          value={workspacePrompt}
          onFocus={() => setLastPromptField("workspace")}
          onChange={(e) => setWorkspacePrompt(e.target.value)}
        />
        {/* Placeholder reference, the Prompt tab's convention — a chip inserts into whichever field was focused last. */}
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-2 text-xs font-semibold text-gray-500">{S.agent.placeholdersTitle}</p>
          <ul className="space-y-1">
            {S.memory.promptPlaceholders.map(([token, desc]) => (
              <li key={token} className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    lastPromptField === "main"
                      ? insertPromptToken(mainPromptRef, memoryPrompt, setMemoryPrompt, token!)
                      : insertPromptToken(
                          workspacePromptRef,
                          workspacePrompt,
                          setWorkspacePrompt,
                          token!,
                        )
                  }
                  title={S.memory.insertToken}
                  className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono font-semibold text-gray-800 transition-colors duration-150 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-700"
                >
                  {token}
                </button>
                <span className="text-gray-500 dark:text-gray-400">{desc}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="primary" onClick={savePrompts}>
            {S.common.save}
          </Button>
        </div>
      </section>

      {saveConfirm}

      {/* The view: a right Drawer on desktop, a bottom Sheet below the breakpoint (the same split
          as the chat page's panels — Sheet brings the grab handle, snap points and swipe-down).
          Mounted mutually exclusively; the metadata + body block is shared, only the action row's
          placement differs (pinned footer vs. flowing after the content the Sheet scrolls). */}
      {isDesktop ? (
        <Drawer
          open={viewOpen}
          side="right"
          title={viewing?.file.title ?? ""}
          onClose={() => setViewOpen(false)}
          widthClass="max-w-lg"
        >
          {viewing && (
            <div className="flex h-full flex-col">
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">{viewMeta}</div>
              {viewActions}
            </div>
          )}
        </Drawer>
      ) : (
        <Sheet
          open={viewOpen}
          snap={sheetSnap}
          onSnapChange={setSheetSnap}
          title={viewing?.file.title ?? ""}
          onClose={() => setViewOpen(false)}
        >
          {viewing && (
            <>
              <div className="space-y-3 px-4 py-3">{viewMeta}</div>
              {viewActions}
            </>
          )}
        </Sheet>
      )}

      <Modal
        open={editing !== null}
        title={S.memory.editTitle}
        onClose={() => setEditing(null)}
        widthClass="sm:max-w-lg"
      >
        {editing && (
          <div className="space-y-2.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.editWhy}</p>
            <p className="break-all font-mono text-[11px] text-gray-400 dark:text-gray-500">
              {memoryFilePath(editing.scope, editing.file)}
            </p>
            <Textarea
              label={S.memory.editRequirementLabel}
              size="sm"
              rows={2}
              value={editRequirement}
              onChange={(e) => setEditRequirement(e.target.value)}
              placeholder={S.memory.editRequirementPlaceholder}
            />
            <Textarea
              label={S.memory.editPromptLabel}
              size="sm"
              rows={6}
              readOnly
              value={editPrompt}
              className="text-gray-600 dark:text-gray-300"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={copyEditPrompt}>
                {S.memory.editCopyPrompt}
              </Button>
              <Button size="sm" variant="primary" onClick={openEditChat}>
                {S.memory.editOpenChat}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import bridge modal: the edit modal's shape, but the content field is required — the
          prompt is meaningless without it, so both actions stay disabled until it is filled. */}
      <Modal
        open={importing !== null}
        title={S.memory.importTitle}
        onClose={() => setImporting(null)}
        widthClass="sm:max-w-lg"
      >
        {importing && (
          <div className="space-y-2.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.importWhy}</p>
            <p className="break-all font-mono text-[11px] text-gray-400 dark:text-gray-500">
              {`${memoryDir}/${importing.scopeKey}`}
            </p>
            <Textarea
              label={S.memory.importContentLabel}
              size="sm"
              rows={4}
              value={importContent}
              onChange={(e) => setImportContent(e.target.value)}
              placeholder={S.memory.importContentPlaceholder}
            />
            <Textarea
              label={S.memory.editPromptLabel}
              size="sm"
              rows={6}
              readOnly
              value={importPrompt}
              className="text-gray-600 dark:text-gray-300"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={importContent.trim() === ""} onClick={copyImportPrompt}>
                {S.memory.editCopyPrompt}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={importContent.trim() === ""}
                onClick={openImportChat}
              >
                {S.memory.editOpenChat}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={removing !== null}
        tone="danger"
        title={S.memory.deleteTitle}
        confirmLabel={S.memory.delete}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {removing ? S.memory.deleteConfirm(removing.file.title) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
