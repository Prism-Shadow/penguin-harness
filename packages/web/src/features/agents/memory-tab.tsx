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
 * A memory may keep files — the scripts it describes — in a folder of its name. Its row counts
 * them, and its view shows them under the Markdown, each opening read-only as code with line
 * numbers and deletable on its own; deleting the memory deletes its folder. A file is the Agent's
 * code, so it has no edit bridge: the Agent changes it in a chat like any other file. Files in a
 * folder no memory keeps are listed apart, under a note, so nothing on disk is hidden.
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
 *
 * The two prompts are one typed form (the settings commit model): Save is live only while one
 * of them differs from the stored text, Reset puts the stored text back, and leaving the tab
 * with unsaved edits asks first. A reload of the tab's data moves what they are compared with
 * and keeps what is being typed.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";

import type {
  MemoryFileInfo,
  MemoryFolderFile,
  MemoryImportMode,
  MemoryScopeInfo,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Card,
  CodeSurface,
  CollapsibleSection,
  ConfirmModal,
  CopiedStatus,
  CopyCheckGlyph,
  DownloadIcon,
  Drawer,
  GlyphIcon,
  HelpFold,
  HiddenFileInput,
  ICONS,
  ICON_SIZE,
  IconButton,
  InfoPopover,
  ListRow,
  Md,
  Modal,
  Notice,
  RadioGroup,
  Sheet,
  SkeletonList,
  Textarea,
  ToggleRow,
  UploadIcon,
  bodyWithoutFrontmatter,
  buttonClass,
  languageForFileName,
  toastError,
  toastSuccess,
  useCopied,
  useFormDraft,
  type SheetSnap,
} from "@prismshadow/penguin-ui";

import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatBytes, formatRelativeDate } from "../../lib/format";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { useProject } from "../../state/project";
import { agentKey, useAgentLocation } from "../../lib/agent-location";
import { useAiBridge } from "../ai-create";
import { buildMemoryAddPrompt, buildMemoryEditPrompt } from "./memory-chat-prompts";
import {
  MemoryDocumentError,
  importConfirmPlan,
  memoryUploadOf,
  type MemoryImportPlan,
  type MemoryUpload,
} from "./memory-transfer";
import { toastApiError } from "../../lib/toast-api-error";
import { downloadArchive } from "../../lib/archive-download";

/** Same breakpoint as the chat page's panels: \u22651024px the view opens as a side Drawer, below it as a bottom Sheet. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * The small ghost button's look on a `<label>`: the Button component only renders a `<button>`,
 * and the import control has to wrap a file input (the Agent State section's transfer label does
 * the same for its own size). Mirrors Button's `ghost` variant at `sm`, icon + text.
 */
const GHOST_LABEL_CLASS = buttonClass("ghost", "sm");

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
  /** Files in folders no memory keeps. */
  orphanFiles: MemoryFolderFile[];
}

/** The two memory prompts as one draft: the always-injected half and the Workspace addendum. */
interface MemoryPrompts {
  prompt: string;
  workspace: string;
}

/** The prompts' baseline until the stored ones arrive. */
const NO_PROMPTS: MemoryPrompts = { prompt: "", workspace: "" };

/** A memory selected for an action (edit modal). */
interface Selected {
  scope: MemoryScopeInfo;
  file: MemoryFileInfo;
}

/** A file kept in a folder, with the memory that keeps it (null for a folder no memory keeps). */
interface SelectedFile {
  scope: MemoryScopeInfo;
  file: MemoryFolderFile;
  topic: MemoryFileInfo | null;
}

/** What the view panel shows, and what a delete confirmation is about: a memory, or one kept file. */
type Target = ({ kind: "topic" } & Selected) | ({ kind: "file" } & SelectedFile);

export function MemoryTab({
  agentId,
  onConfigChanged,
}: {
  agentId: string;
  /** Config writes happen here directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them (e.g. the inserted placeholder). */
  onConfigChanged?: () => void;
}) {
  const { openAiChat } = useAiBridge();
  const { locale } = useLocale();
  const userId = useAuth().user?.userId ?? null;
  const { currentProject, reloadAgents: reloadHere } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** The machine the Agent lives on, where its memory is; null for this server. */
  const machineId = useAgentLocation();
  /** This server's Agent list carries the counts a write here moves; a machine's is read where it is shown. */
  const reloadAgents = () => (machineId === null ? reloadHere() : Promise.resolve());
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
  const collapseKey =
    userId && projectId ? collapsedStoreKey(userId, projectId, agentKey(machineId, agentId)) : null;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsedScopes(collapseKey));
  /** The prompts as last loaded or saved: what the draft below is compared with. */
  const [storedPrompts, setStoredPrompts] = useState<MemoryPrompts | null>(null);
  // Compared exactly: whitespace is part of a prompt.
  const prompts = useFormDraft(storedPrompts ?? NO_PROMPTS);
  const [savingPrompts, setSavingPrompts] = useState(false);
  const mainPromptRef = useRef<HTMLTextAreaElement>(null);
  const workspacePromptRef = useRef<HTMLTextAreaElement>(null);
  // Chip clicks steal focus, so track the last-focused prompt field instead of the current one.
  const [lastPromptField, setLastPromptField] = useState<"main" | "workspace">("main");
  // Open flag and content are separate: the Sheet animates out on close, and nulling the
  // content with it would empty the panel mid-exit. The stale content is simply kept.
  const [viewOpen, setViewOpen] = useState(false);
  const [viewing, setViewing] = useState<(Target & { content: string }) | null>(null);
  const [editing, setEditing] = useState<Selected | null>(null);
  const [editRequirement, setEditRequirement] = useState("");
  const [adding, setAdding] = useState<MemoryScopeInfo | null>(null);
  const [addContent, setAddContent] = useState("");
  // A picked document waiting for its mode, then the plan the user is being asked to confirm.
  const [importing, setImporting] = useState<{
    scope: MemoryScopeInfo;
    fileName: string;
    upload: MemoryUpload;
  } | null>(null);
  const [importMode, setImportMode] = useState<MemoryImportMode>("skip");
  const [importPlan, setImportPlan] = useState<MemoryImportPlan | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [removing, setRemoving] = useState<Target | null>(null);
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
        api.getMemoryOverview(projectId, agentId, machineId),
        api.getAgentConfig(projectId, agentId, machineId),
      ]);
      // A clean draft follows the stored prompts; one being typed keeps its text.
      setStoredPrompts({
        prompt: configView.config.memory.prompt,
        workspace: configView.config.memory.workspacePrompt,
      });
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
              const listed = await api.getMemoryFiles(
                projectId,
                agentId,
                scope.scopeKey,
                machineId,
              );
              return { scope, files: listed.files, orphanFiles: listed.orphanFiles };
            } catch {
              // One unreadable scope (bad hand-made directory name, raced delete) must not
              // blank the whole tab; it lists as an empty group instead.
              return { scope, files: [], orphanFiles: [] };
            }
          }),
        ),
      );
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId, machineId, collapseKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleEnabled = async (next: boolean) => {
    if (!projectId) return;
    setSwitchBusy(true);
    try {
      const res = await api.putAgentConfig(
        projectId,
        agentId,
        { config: { memory: { enabled: next } } },
        machineId,
      );
      setEnabled(res.config.memory.enabled);
      toastSuccess(S.agent.savedTakesEffect);
      onConfigChanged?.();
    } catch (e) {
      toastApiError(e);
    } finally {
      setSwitchBusy(false);
    }
  };

  /** The explicit adoption path for an agent whose template predates Memory: one idempotent config write. */
  const insertPlaceholder = async () => {
    if (!projectId) return;
    try {
      const overview = await api.insertMemoryPlaceholder(projectId, agentId, machineId);
      setTemplateHasMemory(overview.templateHasMemory);
      toastSuccess(S.memory.insertPlaceholderDone);
      onConfigChanged?.();
    } catch (e) {
      toastApiError(e);
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

  /** Saves both memory prompts through the ordinary config write; a refusal keeps them as typed. */
  const savePrompts = async () => {
    if (!projectId || !prompts.dirty || savingPrompts) return;
    setSavingPrompts(true);
    try {
      const res = await api.putAgentConfig(
        projectId,
        agentId,
        {
          config: {
            memory: { prompt: prompts.draft.prompt, workspacePrompt: prompts.draft.workspace },
          },
        },
        machineId,
      );
      const stored = {
        prompt: res.config.memory.prompt,
        workspace: res.config.memory.workspacePrompt,
      };
      setStoredPrompts(stored);
      prompts.adopt(stored);
      toastSuccess(S.agent.savedTakesEffect);
      onConfigChanged?.();
    } catch (e) {
      toastApiError(e);
    } finally {
      setSavingPrompts(false);
    }
  };

  const openView = async (scope: MemoryScopeInfo, file: MemoryFileInfo) => {
    if (!projectId) return;
    try {
      const res = await api.getMemoryFile(projectId, agentId, scope.scopeKey, file.name, machineId);
      setSheetSnap("half"); // Every mobile open starts at the browsing height, like the chat panels.
      setViewing({ kind: "topic", scope, file: res.file, content: res.content });
      setViewOpen(true);
    } catch (e) {
      toastApiError(e);
    }
  };

  /** Opens one kept file as code, in the same panel; from a memory's view, Back returns to it. */
  const openFileView = async (
    scope: MemoryScopeInfo,
    file: MemoryFolderFile,
    topic: MemoryFileInfo | null,
  ) => {
    if (!projectId) return;
    try {
      // The one file route answers a kept file's path as well as a topic's name.
      const res = await api.getMemoryFile(projectId, agentId, scope.scopeKey, file.path, machineId);
      if (!viewOpen) setSheetSnap("half");
      const read = { path: file.path, size: res.file.size, modifiedAt: res.file.modifiedAt };
      setViewing({ kind: "file", scope, file: read, topic, content: res.content });
      setViewOpen(true);
    } catch (e) {
      toastApiError(e);
    }
  };

  /** Absolute path of a memory or of a file it keeps: `name` for a memory, `path` for a kept file. */
  const memoryFilePath = (scope: MemoryScopeInfo, scopePath: string) =>
    `${memoryDir}/${scope.scopeKey}/${scopePath}`;

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
   * The bridge-to-chat jump shared by edit and add: the AI bridge prefills the draft with the
   * prompt and pins this Agent — and for a Workspace scope pins that Workspace too, so the
   * Session reads the very index it is about to change.
   */
  const openChatWithDraft = (text: string, workspacePath: string | undefined) => {
    openAiChat({
      agentId,
      text,
      ...(workspacePath !== undefined ? { workspace: workspacePath } : {}),
      machineId,
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

  /** Downloads one group's folder as a zip (the shared archive download: a failure is a toast, never a saved error body). */
  const exportScope = async (scope: MemoryScopeInfo) => {
    if (!projectId) return;
    try {
      await downloadArchive(
        api.memoryScopeArchiveUrl(projectId, agentId, scope.scopeKey, machineId),
        `${agentId}-${scope.scopeKey}-memory`,
      );
    } catch (e) {
      toastApiError(e);
    }
  };

  /** Reads the picked file and opens the import modal; a file that is neither a zip nor a document never gets that far. */
  const pickImport = async (scope: MemoryScopeInfo, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again still fires a change event.
    event.target.value = "";
    if (!file) return;
    try {
      const upload = memoryUploadOf(new Uint8Array(await file.arrayBuffer()));
      setImportMode("skip");
      setImporting({ scope, fileName: file.name, upload });
    } catch (e) {
      toastError(e instanceof MemoryDocumentError ? e.message : S.memory.importInvalidFile);
    }
  };

  /**
   * Sends the import. Without `confirm`, one that would destroy something comes back refused,
   * naming what is at stake: that opens the confirmation, whose button sends it again confirmed.
   */
  const runImport = async (confirm: boolean) => {
    if (!projectId || !importing) return;
    setImportBusy(true);
    try {
      const res = await api.importMemoryScope(
        projectId,
        agentId,
        importing.scope.scopeKey,
        { mode: importMode, confirm, ...importing.upload },
        machineId,
      );
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
      const plan = confirm ? null : importConfirmPlan(e);
      if (plan !== null) setImportPlan(plan);
      else toastApiError(e);
    } finally {
      setImportBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!projectId || !removing) return;
    const target = removing;
    setRemoving(null);
    try {
      if (target.kind === "topic") {
        await api.deleteMemoryFile(
          projectId,
          agentId,
          target.scope.scopeKey,
          target.file.name,
          machineId,
        );
      } else {
        await api.deleteMemoryFile(
          projectId,
          agentId,
          target.scope.scopeKey,
          target.file.path,
          machineId,
        );
      }
      toastSuccess(S.memory.deleteDone);
      if (viewing !== null && viewOpen) {
        if (target.kind === "topic") {
          // The memory took its folder along: neither it nor a file it kept is left to show.
          const shown = viewing.kind === "topic" ? viewing.file : viewing.topic;
          if (shown?.name === target.file.name) setViewOpen(false);
        } else if (viewing.kind === "file" && viewing.file.path === target.file.path) {
          // Back to the memory that kept it, whose file list just lost a row.
          if (viewing.topic) void openView(viewing.scope, viewing.topic);
          else setViewOpen(false);
        } else if (viewing.kind === "topic" && target.topic?.name === viewing.file.name) {
          void openView(viewing.scope, viewing.file);
        }
      }
      await load();
      // The agent card's memory count changed; refresh the list provider too.
      void reloadAgents();
    } catch (e) {
      toastApiError(e);
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
      <IconButton
        label={`${S.memory.view} ${file.title}`}
        title={S.memory.view}
        onClick={() => void openView(scope, file)}
      >
        <GlyphIcon d={ICONS.eye} size={14} className="text-gray-600 dark:text-gray-300" />
      </IconButton>
      <IconButton
        label={`${S.memory.edit} ${file.title}`}
        title={S.memory.edit}
        onClick={() => openEditor(scope, file)}
      >
        <GlyphIcon d={ICONS.penLine} size={14} className="text-gray-600 dark:text-gray-300" />
      </IconButton>
      <IconButton
        variant="danger"
        label={`${S.memory.delete} ${file.title}`}
        title={S.memory.delete}
        onClick={() => setRemoving({ kind: "topic", scope, file })}
      >
        <GlyphIcon d={ICONS.trash} size={14} />
      </IconButton>
    </div>
  );

  // A memory's title is its file's identifier, so it keeps the data face on the code rung. A
  // memory that keeps files says how many beside its date — the glyph and the number, the
  // wording in the tooltip and the accessible name.
  const fileRow = (scope: MemoryScopeInfo, file: MemoryFileInfo) => (
    <ListRow
      key={file.name}
      as="li"
      title={<span className="font-mono text-[length:var(--ui-text-code-size)]">{file.title}</span>}
      description={file.description ? file.description : undefined}
      meta={
        <span className="flex items-center gap-2 tabular-nums">
          {file.files.length > 0 && (
            <span
              data-tooltip={S.memory.fileCount(file.files.length)}
              className="flex items-center gap-1"
            >
              <GlyphIcon d={ICONS.paperclip} size={ICON_SIZE.inlineGlyph} />
              <span aria-hidden="true">{file.files.length}</span>
              <span className="sr-only">{S.memory.fileCount(file.files.length)}</span>
            </span>
          )}
          {file.updatedAt ?? formatRelativeDate(file.modifiedAt, locale)}
        </span>
      }
      trailing={rowActions(scope, file)}
    />
  );

  /** One kept file's row: its path, size and date, then View and Delete — no Edit, it is the Agent's code. */
  const keptRow = (
    scope: MemoryScopeInfo,
    file: MemoryFolderFile,
    topic: MemoryFileInfo | null,
  ) => (
    <ListRow
      key={file.path}
      as="li"
      title={<span className="font-mono text-[length:var(--ui-text-code-size)]">{file.path}</span>}
      meta={
        <span className="flex items-center gap-2 tabular-nums">
          <span>{formatBytes(file.size)}</span>
          <span>{formatRelativeDate(file.modifiedAt, locale)}</span>
        </span>
      }
      trailing={
        <div className="flex shrink-0 items-center gap-1.5">
          <IconButton
            label={`${S.memory.view} ${file.path}`}
            title={S.memory.view}
            onClick={() => void openFileView(scope, file, topic)}
          >
            <GlyphIcon d={ICONS.eye} size={14} className="text-gray-600 dark:text-gray-300" />
          </IconButton>
          <IconButton
            variant="danger"
            label={`${S.memory.delete} ${file.path}`}
            title={S.memory.delete}
            onClick={() => setRemoving({ kind: "file", scope, file, topic })}
          >
            <GlyphIcon d={ICONS.trash} size={14} />
          </IconButton>
        </div>
      }
    />
  );

  /** A group's files that no memory keeps, ruled off under a note that says where they come from. */
  const orphanSection = (scope: MemoryScopeInfo, files: MemoryFolderFile[], ruled: boolean) =>
    files.length === 0 ? null : (
      <section className={ruled ? "border-t border-line-muted" : ""}>
        <h4 className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-xs font-medium text-fg-muted">
          {S.memory.orphanFiles}
          <InfoPopover label={S.memory.orphanFiles}>{S.memory.orphanFilesHint}</InfoPopover>
        </h4>
        <ul>{files.map((file) => keptRow(scope, file, null))}</ul>
      </section>
    );

  /**
   * Metadata + body of what is in view, shared by the Drawer and the Sheet: a memory's Markdown
   * with its frontmatter stripped, then the files it keeps; or one kept file's code with line
   * numbers under its absolute path.
   */
  const viewMeta =
    viewing &&
    (viewing.kind === "topic" ? (
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
        {viewing.file.files.length > 0 && (
          <section className="-mx-3 border-t border-line-muted">
            <h4 className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-xs font-medium text-fg-muted">
              {S.memory.keptFiles}
              <InfoPopover label={S.memory.keptFiles}>{S.memory.keptFilesHint}</InfoPopover>
              <span className="ml-auto tabular-nums text-fg-subtle">
                {S.memory.fileCount(viewing.file.files.length)}
              </span>
            </h4>
            <ul>{viewing.file.files.map((file) => keptRow(viewing.scope, file, viewing.file))}</ul>
          </section>
        )}
      </>
    ) : (
      <>
        <span className="flex gap-2 text-xs tabular-nums text-gray-400 dark:text-gray-500">
          <span>{formatBytes(viewing.file.size)}</span>
          <span>{formatRelativeDate(viewing.file.modifiedAt, locale)}</span>
        </span>
        <p className="break-all font-mono text-xs text-gray-400 dark:text-gray-500">
          {memoryFilePath(viewing.scope, viewing.file.path)}
        </p>
        <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
          <CodeSurface
            language={languageForFileName(viewing.file.path)}
            code={viewing.content}
            highlight
            lineNumbers
            wrap
            className="text-xs leading-relaxed"
          />
        </div>
      </>
    ));

  const viewActions = viewing && (
    <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
      {viewing.kind === "topic" ? (
        <Button size="sm" onClick={() => openEditor(viewing.scope, viewing.file)}>
          {S.memory.edit}
        </Button>
      ) : (
        viewing.topic && (
          <Button
            size="sm"
            className="mr-auto"
            onClick={() => viewing.topic && void openView(viewing.scope, viewing.topic)}
          >
            {S.memory.backToMemory(viewing.topic.title)}
          </Button>
        )
      )}
      <Button size="sm" variant="danger" onClick={() => setRemoving(viewing)}>
        {S.memory.delete}
      </Button>
    </div>
  );

  /** The view panel's title: a memory's frontmatter name, or a kept file's path. */
  const viewTitle =
    viewing === null ? "" : viewing.kind === "topic" ? viewing.file.title : viewing.file.path;

  return (
    <div className="space-y-4">
      {/* Tab-level description: no title in the panel to anchor a "?" to (see help-fold.tsx). */}
      <HelpFold label={S.agent.tabMemory}>{S.memory.desc}</HelpFold>

      <ToggleRow
        variant="card"
        label={S.memory.enable}
        checked={enabled}
        onChange={(v) => void toggleEnabled(v)}
        disabled={switchBusy}
      />

      {!templateHasMemory && (
        <Notice
          tone="attention"
          variant="callout"
          action={{ label: S.memory.insertPlaceholder, onClick: () => void insertPlaceholder() }}
        >
          {S.memory.templateMissing}
        </Notice>
      )}

      {groups === null ? (
        <SkeletonList rows={4} />
      ) : (
        <div className={enabled ? "space-y-4" : "space-y-4 opacity-60"}>
          {groups.map(({ scope, files, orphanFiles }) => {
            const open = !collapsed.has(scope.scopeKey);
            return (
              /* One collapsible section per scope: the head strip folds the group; the group's
                 own actions sit after the toggle, outside it, since a button cannot hold
                 another. The section is a size container, not a viewport breakpoint: the
                 settings panel narrows independently of the window. Below @md the three action
                 labels drop and only their icons remain — 28rem is where the English labels
                 plus the count stop fitting beside the title, and rem tracks the user's font
                 tier (state/theme.tsx), so the threshold scales with the labels it measures. No
                 action is hidden at any width; each keeps its icon, an aria-label and a
                 tooltip. */
              <CollapsibleSection
                key={scope.scopeKey}
                className="@container"
                title={
                  scope.kind === "workspace" && scope.workspacePath !== undefined ? (
                    <>
                      {scopeTitle(scope)}
                      <span className="ml-2 font-mono text-xs font-normal text-gray-400 dark:text-gray-500">
                        {scope.workspacePath}
                      </span>
                    </>
                  ) : (
                    scopeTitle(scope)
                  )
                }
                meta={S.memory.itemCount(files.length)}
                open={open}
                onOpenChange={() => toggleCollapsed(scope.scopeKey)}
                actions={
                  /* Whole-group transfer, icon + label (the labels are what say which way a
                     transfer goes, wherever the row is wide enough to keep them): export for any
                     member, import for the owner. The tooltip carries what the label cannot —
                     that the whole group travels — and on a narrow row, where the label is gone,
                     it carries the direction too, alongside the aria-label. */
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={S.memory.exportScopeHint}
                      data-tooltip-extra
                      aria-label={S.memory.exportScopeLabel(scopeTitle(scope))}
                      onClick={() => void exportScope(scope)}
                    >
                      <DownloadIcon size={13} />
                      <span className="hidden @md:inline">{S.memory.exportScope}</span>
                    </Button>
                    {isOwner && (
                      <label
                        className={`${GHOST_LABEL_CLASS} shrink-0`}
                        data-tooltip={S.memory.importScopeHint}
                        data-tooltip-extra
                        aria-label={S.memory.importScopeLabel(scopeTitle(scope))}
                      >
                        <HiddenFileInput
                          accept=".zip,application/zip,.json,application/json"
                          onChange={(e) => void pickImport(scope, e)}
                        />
                        <UploadIcon size={13} />
                        <span className="hidden @md:inline">{S.memory.importScope}</span>
                      </label>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      title={S.memory.add}
                      aria-label={S.memory.addScopeLabel(scopeTitle(scope))}
                      onClick={() => openAdd(scope)}
                    >
                      <GlyphIcon d={ICONS.plus} size={13} />
                      <span className="hidden @md:inline">{S.memory.add}</span>
                    </Button>
                  </>
                }
              >
                {files.length === 0 && orphanFiles.length === 0 ? (
                  <p className="px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                    {scope.kind === "user" ? S.memory.emptyUserScope : S.memory.emptyScope}
                  </p>
                ) : (
                  <>
                    {files.length > 0 && <ul>{files.map((file) => fileRow(scope, file))}</ul>}
                    {orphanSection(scope, orphanFiles, files.length > 0)}
                  </>
                )}
              </CollapsibleSection>
            );
          })}
        </div>
      )}

      <Card as="section" padding="md" className="space-y-3">
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
          value={prompts.draft.prompt}
          onFocus={() => setLastPromptField("main")}
          onChange={(e) => prompts.patch({ prompt: e.target.value })}
        />
        <Textarea
          ref={workspacePromptRef}
          label={S.memory.workspacePromptLabel}
          mono
          size="sm"
          rows={6}
          value={prompts.draft.workspace}
          onFocus={() => setLastPromptField("workspace")}
          onChange={(e) => prompts.patch({ workspace: e.target.value })}
        />
        {/* Placeholder reference, the Prompt tab's convention — a chip inserts into whichever field was focused last.
            Inside the card it takes the step below the card's radius. */}
        <div className="rounded-sm border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-2 text-xs font-semibold text-gray-500">{S.agent.placeholdersTitle}</p>
          <ul className="space-y-1">
            {S.memory.promptPlaceholders.map(([token, desc]) => (
              <li key={token} className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    lastPromptField === "main"
                      ? insertPromptToken(
                          mainPromptRef,
                          prompts.draft.prompt,
                          (prompt) => prompts.patch({ prompt }),
                          token!,
                        )
                      : insertPromptToken(
                          workspacePromptRef,
                          prompts.draft.workspace,
                          (workspace) => prompts.patch({ workspace }),
                          token!,
                        )
                  }
                  data-tooltip={S.memory.insertToken}
                  data-tooltip-extra
                  className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono font-semibold text-gray-800 transition-colors duration-150 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-700"
                >
                  {token}
                </button>
                <span className="text-gray-500 dark:text-gray-400">{desc}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={!prompts.dirty || savingPrompts} onClick={prompts.reset}>
            {S.common.reset}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={storedPrompts === null || !prompts.dirty || savingPrompts}
            onClick={() => void savePrompts()}
          >
            {S.common.save}
          </Button>
        </div>
      </Card>

      {/* The view: a right Drawer on desktop, a bottom Sheet below the breakpoint (the same split
          as the chat page's panels — Sheet brings the grab handle, snap points and swipe-down).
          Mounted mutually exclusively; the metadata + body block is shared, only the action row's
          placement differs (pinned footer vs. flowing after the content the Sheet scrolls). */}
      {isDesktop ? (
        <Drawer
          open={viewOpen}
          side="right"
          title={viewTitle}
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
          title={viewTitle}
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
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.editWhy}</p>
            <p className="break-all font-mono text-xs text-gray-400 dark:text-gray-500">
              {memoryFilePath(editing.scope, editing.file.name)}
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
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.addWhy}</p>
            <p className="break-all font-mono text-xs text-gray-400 dark:text-gray-500">
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
            <p className="break-all font-mono text-xs text-gray-500 dark:text-gray-400">
              {importing.fileName}
            </p>
            <RadioGroup
              label={S.memory.importModeLabel}
              name="memory-import-mode"
              value={importMode}
              onChange={setImportMode}
              options={[
                {
                  value: "skip",
                  label: S.memory.importModeSkip,
                  hint: S.memory.importModeSkipHint,
                },
                {
                  value: "overwrite",
                  label: S.memory.importModeOverwrite,
                  hint: S.memory.importModeOverwriteHint,
                },
                {
                  value: "replace",
                  label: S.memory.importModeReplace,
                  hint: S.memory.importModeReplaceHint,
                },
              ]}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="primary"
                disabled={importBusy}
                onClick={() => void runImport(false)}
              >
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
        cancelLabel={S.common.cancel}
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
        title={removing?.kind === "file" ? S.memory.deleteFileTitle : S.memory.deleteTitle}
        confirmLabel={S.memory.delete}
        cancelLabel={S.common.cancel}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {removing === null
            ? ""
            : removing.kind === "file"
              ? S.memory.deleteFileConfirm(removing.file.path)
              : removing.file.files.length > 0
                ? S.memory.deleteWithFilesConfirm(removing.file.title, removing.file.files.length)
                : S.memory.deleteConfirm(removing.file.title)}
        </p>
      </ConfirmModal>
    </div>
  );
}
