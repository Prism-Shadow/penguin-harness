/**
 * Agent settings page "Memory" tab: the switch, then every memory the Agent keeps, grouped by
 * scope — user memory first (read by every Session), then one group per Workspace (labeled by
 * its `.workspace` path, newest activity first).
 *
 * A memory's content is the model's document, so per-file editing stays out of the tab: both
 * "edit" and each scope header's "add" open a bridge modal first — a text field and a live
 * preview of the generated prompt, the same shape as the skill import modal — and then jump to
 * a new chat with this Agent and the prompt as the prefilled draft (the same draft-cache
 * route). For a Workspace scope the draft also pins that Workspace, so the Session is injected
 * with the very index it is about to change. Deleting confirms first and also drops the file's
 * MEMORY.md index lines (server-side).
 *
 * A whole group moves in one piece, though: each header carries export and import, following
 * the Agent State snapshot's split — any member may download a group, only the owner may write
 * one back. Import defaults to the mode that loses nothing, and the two that do not are held
 * behind a confirmation naming the memories at stake.
 *
 * The switch writes immediately rather than joining a tab-level Save, so turning Memory off
 * never drags an unrelated half-finished edit along with it. Off keeps every file and this tab
 * fully usable; it only stops Memory from entering the context and from preparing directories
 * for new Sessions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import { useNavigate } from "react-router";
import type {
  MemoryFileInfo,
  MemoryImportMode,
  MemoryScopeExport,
  MemoryScopeInfo,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatRelativeDate } from "../../lib/format";
import { toneStrip } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { CopiedStatus, CopyCheckGlyph, useCopied } from "../../components/ui/copy-button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { InfoPopover } from "../../components/ui/info-popover";
import { HelpFold } from "../../components/ui/help-fold";
import { Modal } from "../../components/ui/modal";
import { Textarea } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Chevron } from "../../components/ui/chevron";
import { DownloadIcon, UploadIcon } from "../../components/ui/icons";
import { HiddenFileInput } from "../../components/ui/hidden-file-input";
import { Drawer } from "../../components/ui/drawer";
import { Sheet, type SheetSnap } from "../../components/ui/sheet";
import { ConfirmModal, useSaveConfirm } from "../../components/ui/confirm-modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Md } from "../chat/md";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { buildMemoryAddPrompt, buildMemoryEditPrompt } from "./memory-chat-prompts";
import {
  MemoryDocumentError,
  memoryDocumentFileName,
  parseMemoryScopeDocument,
  planMemoryImport,
} from "./memory-transfer";
import type { MemoryImportPlan } from "./memory-transfer";

import { bodyWithoutFrontmatter } from "../../lib/frontmatter";

/** Same breakpoint as the chat page's panels: \u22651024px the view opens as a side Drawer, below it as a bottom Sheet. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/** Row-action glyphs (icon-only buttons, the skills tab's affordance): view = the agents page's eye, edit = the shared pencil-line, delete = the shared trash can. */
const EYE_ICON =
  "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z";
const PENCIL_ICON = "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z";
const TRASH_ICON =
  "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7m4 4v6m4-6v6";
/** "Add" plus glyph on the group headers, matching the models page's per-group add entry. */
const PLUS_ICON = "M12 5v14M5 12h14";

/**
 * The small ghost button's look on a `<label>`: the Button component only renders a `<button>`,
 * and the import control has to wrap a file input (the Agent State section's transfer label does
 * the same for its own size). Mirrors Button's `ghost` variant at `sm`, icon + text.
 */
const GHOST_LABEL_CLASS =
  "inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-transparent " +
  "px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 " +
  "focus-within:ring-2 focus-within:ring-gray-400/30 " +
  "dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";

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
  const { currentProject, setCurrentAgentId, reloadAgents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // Import writes a whole group at once, so it follows the Agent State snapshot's owner gate;
  // the server enforces it either way, this only keeps the control out of a member's reach.
  const isOwner = currentProject?.role === "owner";

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
  const [adding, setAdding] = useState<MemoryScopeInfo | null>(null);
  const [addContent, setAddContent] = useState("");
  // A picked document waiting for its mode, then the plan the user is being asked to confirm.
  const [importing, setImporting] = useState<{
    scope: MemoryScopeInfo;
    fileName: string;
    doc: MemoryScopeExport;
  } | null>(null);
  const [importMode, setImportMode] = useState<MemoryImportMode>("skip");
  const [importPlan, setImportPlan] = useState<MemoryImportPlan | null>(null);
  const [importBusy, setImportBusy] = useState(false);
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

  const editPrompt = editing ? buildMemoryEditPrompt(editing.file.title, editRequirement) : "";
  // Copy feedback lives at the button (the shared copy convention): its glyph flips to
  // the check while copied — no toast, and the button label never changes.
  const editCopy = useCopied();

  /**
   * The bridge-to-chat jump shared by edit and add: prefill the draft (merging over what is
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

  /** Opens the add modal for one scope: content empty, actions disabled until it is filled. */
  const openAdd = (scope: MemoryScopeInfo) => {
    setAddContent("");
    setAdding(scope);
  };

  const addPrompt = adding ? buildMemoryAddPrompt(adding.kind, addContent) : "";
  const addCopy = useCopied();

  const openAddChat = () => {
    if (adding) openChatWithDraft(addPrompt, adding.workspacePath);
  };

  /**
   * Downloads one group as a transfer document. Fetched as JSON and saved through an object URL
   * rather than followed as a link, so a failed request becomes a toast instead of an error body
   * saved to disk (the skills tab's export made the same call).
   */
  const exportScope = async (scope: MemoryScopeInfo) => {
    if (!projectId) return;
    try {
      const doc = await api.exportMemoryScope(projectId, agentId, scope.scopeKey);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = memoryDocumentFileName(agentId, scope.scopeKey, doc.exportedAt);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /** Reads the picked file and opens the import modal; a file that is not a document never gets that far. */
  const pickImport = async (scope: MemoryScopeInfo, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again still fires a change event.
    event.target.value = "";
    if (!file) return;
    try {
      const doc = parseMemoryScopeDocument(await file.text());
      setImportMode("skip");
      setImporting({ scope, fileName: file.name, doc });
    } catch (e) {
      toastError(e instanceof MemoryDocumentError ? e.message : S.memory.importInvalidFile);
    }
  };

  const runImport = async (confirm: boolean) => {
    if (!projectId || !importing) return;
    setImportBusy(true);
    try {
      const res = await api.importMemoryScope(projectId, agentId, importing.scope.scopeKey, {
        mode: importMode,
        confirm,
        payload: importing.doc,
      });
      const touched = res.added.length + res.overwritten.length + res.removed.length;
      if (touched === 0) toastSuccess(S.memory.importNothingNew);
      else
        toastSuccess(
          S.memory.importDone(res.added.length, res.overwritten.length, res.removed.length),
        );
      setImportPlan(null);
      setImporting(null);
      await load();
      // The agent card's memory count changed; refresh the list provider too.
      void reloadAgents();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setImportBusy(false);
    }
  };

  /** Import's first click: straight through when nothing would be lost, otherwise into the confirmation. */
  const submitImport = () => {
    if (!importing) return;
    const group = groups?.find((g) => g.scope.scopeKey === importing.scope.scopeKey);
    const plan = planMemoryImport(
      importing.doc,
      { names: group?.files.map((f) => f.name) ?? [], hasIndex: importing.scope.hasIndex },
      importMode,
    );
    if (plan.destroys) setImportPlan(plan);
    else void runImport(false);
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
      // The agent card's memory count changed; refresh the list provider too.
      void reloadAgents();
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;

  const scopeTitle = (scope: MemoryScopeInfo): string =>
    scope.kind === "user"
      ? S.memory.userScope
      : (scope.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) ?? scope.scopeKey);

  // Icon-only row actions (the skills tab's affordance: neutral bordered icons, danger
  // variant with red text/hover for delete); the tooltip + aria-label carry the wording.
  const rowActions = (scope: MemoryScopeInfo, file: MemoryFileInfo) => (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        size="icon"
        title={S.memory.view}
        aria-label={`${S.memory.view} ${file.title}`}
        onClick={() => void openView(scope, file)}
      >
        <GlyphIcon d={EYE_ICON} size={14} className="text-gray-600 dark:text-gray-300" />
      </Button>
      <Button
        size="icon"
        title={S.memory.edit}
        aria-label={`${S.memory.edit} ${file.title}`}
        onClick={() => openEditor(scope, file)}
      >
        <GlyphIcon d={PENCIL_ICON} size={14} className="text-gray-600 dark:text-gray-300" />
      </Button>
      <Button
        size="icon"
        variant="danger"
        title={S.memory.delete}
        aria-label={`${S.memory.delete} ${file.title}`}
        onClick={() => setRemoving({ scope, file })}
      >
        <GlyphIcon d={TRASH_ICON} size={14} />
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
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabMemory}>{S.memory.desc}</HelpFold>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{S.memory.enable}</p>
        <Switch checked={enabled} onChange={(v) => void toggleEnabled(v)} disabled={switchBusy} />
      </div>

      {!templateHasMemory && (
        <div
          className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${toneStrip.attention}`}
        >
          <p className="text-xs">{S.memory.templateMissing}</p>
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
                {/* Group header (the models page's group convention): the collapse button fills
                    the row, the group's own actions sit between it and the chevron — a real
                    <button> cannot nest another, so the actions are siblings, with the hover
                    highlight on the whole header so it reads as a single unit. */}
                <div className="flex items-center gap-2 bg-gray-50 pr-2 transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-800/60">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggleCollapsed(scope.scopeKey)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-2.5 text-left"
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
                  </button>
                  {/* Whole-group transfer, icon + label (the labels are what say which way a
                      transfer goes): export for any member, import for the owner. The tooltip
                      carries what the label cannot — that the whole group travels. */}
                  <span className="shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      title={S.memory.exportScopeHint}
                      aria-label={S.memory.exportScopeLabel(scopeTitle(scope))}
                      onClick={() => void exportScope(scope)}
                    >
                      <DownloadIcon size={13} />
                      {S.memory.exportScope}
                    </Button>
                  </span>
                  {isOwner && (
                    <label
                      className={`${GHOST_LABEL_CLASS} shrink-0`}
                      title={S.memory.importScopeHint}
                      aria-label={S.memory.importScopeLabel(scopeTitle(scope))}
                    >
                      <HiddenFileInput
                        accept=".json,application/json"
                        onChange={(e) => void pickImport(scope, e)}
                      />
                      <UploadIcon size={13} />
                      {S.memory.importScope}
                    </label>
                  )}
                  <span className="shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => openAdd(scope)}>
                      <GlyphIcon d={PLUS_ICON} size={13} />
                      {S.memory.add}
                    </Button>
                  </span>
                  {/* Collapse arrow sits at the far right of the header (after the add entry); it too can be clicked to collapse. */}
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={scopeTitle(scope)}
                    onClick={() => toggleCollapsed(scope.scopeKey)}
                    className="shrink-0 p-1.5"
                  >
                    <Chevron open={open} className="text-gray-400" />
                  </button>
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
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200">
          {S.memory.promptSection}
          <InfoPopover label={S.memory.promptSection}>{S.memory.promptSectionHint}</InfoPopover>
        </h3>
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
              <Button size="sm" onClick={() => editCopy.flash(editPrompt)}>
                <CopyCheckGlyph copied={editCopy.copied} size={12} />
                {S.memory.editCopyPrompt}
              </Button>
              <CopiedStatus copied={editCopy.copied} />
              <Button size="sm" variant="primary" onClick={openEditChat}>
                {S.memory.editOpenChat}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add bridge modal: the edit modal's shape, but the content field is required — the
          prompt is meaningless without it, so both actions stay disabled until it is filled. */}
      <Modal
        open={adding !== null}
        title={S.memory.addTitle}
        onClose={() => setAdding(null)}
        widthClass="sm:max-w-lg"
      >
        {adding && (
          <div className="space-y-2.5">
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.addWhy}</p>
            <p className="break-all font-mono text-[11px] text-gray-400 dark:text-gray-500">
              {`${memoryDir}/${adding.scopeKey}`}
            </p>
            <Textarea
              label={S.memory.addContentLabel}
              required
              size="sm"
              rows={4}
              value={addContent}
              onChange={(e) => setAddContent(e.target.value)}
              placeholder={S.memory.addContentPlaceholder}
            />
            <Textarea
              label={S.memory.editPromptLabel}
              size="sm"
              rows={6}
              readOnly
              value={addPrompt}
              className="text-gray-600 dark:text-gray-300"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={addContent.trim() === ""}
                onClick={() => addCopy.flash(addPrompt)}
              >
                <CopyCheckGlyph copied={addCopy.copied} size={12} />
                {S.memory.editCopyPrompt}
              </Button>
              <CopiedStatus copied={addCopy.copied} />
              <Button
                size="sm"
                variant="primary"
                disabled={addContent.trim() === ""}
                onClick={openAddChat}
              >
                {S.memory.editOpenChat}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import modal: the file that was picked, then the one consequential choice — what to do
          with a name this group already has. The default loses nothing; the other two are held
          behind the confirmation below. */}
      <Modal
        open={importing !== null}
        title={S.memory.importTitle}
        onClose={() => setImporting(null)}
        widthClass="sm:max-w-lg"
      >
        {importing && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.importWhy}</p>
            <p className="break-all font-mono text-[11px] text-gray-500 dark:text-gray-400">
              {S.memory.importFile(importing.fileName, importing.doc.files.length)}
            </p>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                {S.memory.importModeLabel}
              </legend>
              {(
                [
                  ["skip", S.memory.importModeSkip, S.memory.importModeSkipHint],
                  ["overwrite", S.memory.importModeOverwrite, S.memory.importModeOverwriteHint],
                  ["replace", S.memory.importModeReplace, S.memory.importModeReplaceHint],
                ] as [MemoryImportMode, string, string][]
              ).map(([mode, label, hint]) => (
                <label key={mode} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="memory-import-mode"
                    className="mt-1 shrink-0"
                    checked={importMode === mode}
                    onChange={() => setImportMode(mode)}
                  />
                  <span className="min-w-0">
                    <span className="text-gray-800 dark:text-gray-200">{label}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end">
              <Button size="sm" variant="primary" disabled={importBusy} onClick={submitImport}>
                {S.memory.importAction}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* What the chosen mode costs, memory by memory, before it runs. The import modal stays
          underneath (the skills tab's overwrite confirmation does the same), so cancelling comes
          back to the mode choice rather than to an empty tab. */}
      <ConfirmModal
        open={importPlan !== null}
        tone="danger"
        title={S.memory.importConfirmTitle}
        confirmLabel={S.memory.importAction}
        busy={importBusy}
        onClose={() => setImportPlan(null)}
        onConfirm={() => void runImport(true)}
      >
        <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
          {importPlan && importPlan.overwritten.length > 0 && (
            <p className="break-words">{S.memory.importWillOverwrite(importPlan.overwritten)}</p>
          )}
          {importPlan && importPlan.removed.length > 0 && (
            <p className="break-words">{S.memory.importWillRemove(importPlan.removed)}</p>
          )}
          {importPlan?.replacesIndex && <p>{S.memory.importWillReplaceIndex}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.importIrreversible}</p>
        </div>
      </ConfirmModal>

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
