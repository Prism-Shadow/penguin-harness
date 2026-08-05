/**
 * Memory page: Workspace Memory (`agent_state/memory/`) across the Project's Agents.
 *
 * The left directory is a three-level tree — Agent → scope → topic file — following the same
 * shape as trace observability and the evaluation center (lazy fetch on expand, inline
 * loading/empty/error inside the node that owns them). Under each Agent sit the shared index
 * `memory/AGENTS.md`, then the Agent scope, then one node per Workspace: the index covers every
 * scope so it belongs to the Agent, and the Agent scope leads the rest because it is the one
 * every Session reads. A scope is addressed by its directory name throughout, the Agent scope
 * included, so it needs no separate code path here. The right side edits whatever is selected.
 *
 * Unlike the two sibling pages this one writes, so the tree data lives here rather than inside
 * each node: renaming or deleting a topic file also rewrites the index links that pointed at it,
 * which means the Agent's index has to be reachable while one of its files is selected.
 *
 * The Agent-level switch is not here — it is Agent configuration and lives on the Memory tab of
 * the Agent settings page. This page only reports the state, so an edit made while Memory is off
 * doesn't look like it reached the model.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  MemoryFileInfo,
  MemoryOverviewResponse,
  MemoryWorkspaceInfo,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatBytes } from "../../lib/format";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { Truncated } from "../../components/ui/truncated";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import {
  FILE_NAME_PATTERN,
  frontmatterProblem,
  headingOffset,
  indexWithRenamedFile,
  indexWithoutFile,
  newFileTemplate,
  workspaceLabel,
} from "./memory-index";

/** Shared index row (a list of lines, echoing the index's grouped-list shape). */
const INDEX_ICON = "M4 6h16M4 12h16M4 18h10";
/** "New topic file" action on a Workspace row. */
const PLUS_ICON = "M12 5v14M5 12h14";

/** One Agent's tree data. Loaded when its node is first expanded, then kept for the page's lifetime. */
interface AgentMemory {
  /** null while the overview is in flight, and when it failed (`error` then carries why). */
  overview: MemoryOverviewResponse | null;
  error?: string;
  /** Topic files by Workspace key, each loaded when that Workspace node is first expanded. */
  files: ReadonlyMap<string, MemoryFileInfo[]>;
}

const EMPTY_AGENT: AgentMemory = { overview: null, files: new Map() };

/** What the editor on the right is showing: an Agent's shared index, or one Workspace's topic file. */
type Selection =
  | { kind: "index"; agentId: string }
  | { kind: "file"; agentId: string; workspaceKey: string; fileName: string };

/** Expansion key for a Workspace node (Workspace keys are only unique within an Agent). */
function workspaceNodeKey(agentId: string, workspaceKey: string): string {
  return `${agentId}/${workspaceKey}`;
}

/** Row look shared by every selectable tree row, matching the Session rows on the traces page. */
function rowClass(active: boolean, indent: string): string {
  return (
    `flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2.5 ${indent} ` +
    "text-left transition-colors duration-150 " +
    (active ? "bg-gray-200/70 dark:bg-gray-800" : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70")
  );
}

function rowTextClass(active: boolean): string {
  return `min-w-0 flex-1 truncate text-sm ${
    active ? "font-medium text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"
  }`;
}

/** One Workspace and, when expanded, its topic files. */
function WorkspaceNode({
  agentId,
  workspace,
  open,
  files,
  selection,
  onToggle,
  onOpenFile,
  onCreate,
}: {
  agentId: string;
  workspace: MemoryWorkspaceInfo;
  open: boolean;
  /** undefined while the file list is in flight (the node has been expanded but nothing arrived yet). */
  files: MemoryFileInfo[] | undefined;
  selection: Selection | null;
  onToggle: () => void;
  onOpenFile: (fileName: string) => void;
  onCreate: () => void;
}) {
  const label = workspaceLabel(workspace);
  return (
    <li>
      {/* The row is a flex container rather than one button: the create action is a second
          target, and a button inside a button is invalid markup (same split as the Agent
          header's import control on the traces page). */}
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          title={
            workspace.agentScope
              ? S.memory.agentScopeHint
              : (workspace.workspacePath ?? workspace.workspaceKey)
          }
          aria-label={open ? S.nav.collapseGroup : S.nav.expandGroup}
          className={rowClass(false, "pl-2.5")}
        >
          <Chevron open={open} size={12} className="shrink-0 text-gray-400" />
          <Truncated text={label} className={rowTextClass(false)} />
          <span
            className="shrink-0 font-mono text-[11px] text-gray-400"
            title={S.memory.fileCount(workspace.fileCount)}
          >
            {workspace.fileCount}
          </span>
        </button>
        <button
          type="button"
          onClick={onCreate}
          title={S.memory.newFile}
          aria-label={S.memory.newFile}
          className="shrink-0 rounded p-1 text-gray-400 transition-colors duration-150 hover:bg-gray-200/50 hover:text-gray-600 dark:hover:bg-gray-800/50 dark:hover:text-gray-300"
        >
          <GlyphIcon d={PLUS_ICON} size={13} />
        </button>
      </div>
      {open && (
        <ul className="anim-fade space-y-0.5">
          {files === undefined ? (
            <li className="px-2.5 py-1 pl-7 text-xs text-gray-400">{S.common.loading}</li>
          ) : files.length === 0 ? (
            <li className="px-2.5 py-1 pl-7 text-xs text-gray-400 dark:text-gray-600">
              {S.memory.noFiles}
            </li>
          ) : (
            files.map((file) => {
              const active =
                selection?.kind === "file" &&
                selection.agentId === agentId &&
                selection.workspaceKey === workspace.workspaceKey &&
                selection.fileName === file.name;
              return (
                <li key={file.name}>
                  <button
                    type="button"
                    onClick={() => onOpenFile(file.name)}
                    title={file.description || file.name}
                    className={rowClass(active, "pl-7")}
                  >
                    <Truncated text={file.title} className={rowTextClass(active)} />
                    {file.type && (
                      <span className="shrink-0 text-[10px] text-gray-400">
                        {S.memory.types[file.type]}
                      </span>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </li>
  );
}

/** One Agent: the shared index, then its Workspaces. */
function AgentNode({
  agentId,
  name,
  open,
  memory,
  openWorkspaces,
  selection,
  onToggle,
  onOpenIndex,
  onToggleWorkspace,
  onOpenFile,
  onCreate,
}: {
  agentId: string;
  name: string;
  open: boolean;
  /** undefined until the node is first expanded. */
  memory: AgentMemory | undefined;
  openWorkspaces: ReadonlySet<string>;
  selection: Selection | null;
  onToggle: () => void;
  onOpenIndex: () => void;
  onToggleWorkspace: (workspaceKey: string) => void;
  onOpenFile: (workspaceKey: string, fileName: string) => void;
  onCreate: (workspaceKey: string) => void;
}) {
  const overview = memory?.overview ?? null;
  const indexActive = selection?.kind === "index" && selection.agentId === agentId;
  return (
    <li className="pt-2.5">
      <div className="flex items-center px-1 pb-0.5">
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? S.nav.collapseGroup : S.nav.expandGroup}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
        >
          <AgentAvatar id={agentId} name={name} size={18} className="shrink-0 rounded" />
          <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {name}
          </span>
          <Chevron open={open} size={12} className="text-gray-400" />
          <span className="min-w-0 flex-1" />
          {/* Memory that never reaches the model is worth seeing before you open the Agent:
              switched off, or a prompt template predating Memory that has no {{MEMORY}}. */}
          {overview && !overview.enabled && <Badge tone="gray">{S.memory.offBadge}</Badge>}
          {overview?.enabled && !overview.templateInjects && (
            <Badge tone="amber">{S.memory.noPlaceholderBadge}</Badge>
          )}
        </button>
      </div>
      {open && (
        <div className="anim-fade">
          {memory?.error && <p className="px-2.5 py-1 text-xs text-red-500">{memory.error}</p>}
          {!overview && !memory?.error && (
            <p className="px-2.5 py-1 text-xs text-gray-400">{S.common.loading}</p>
          )}
          {overview && (
            <ul className="space-y-0.5">
              {/* The shared index covers every Workspace, so it sits under the Agent, above them. */}
              <li>
                <button
                  type="button"
                  onClick={onOpenIndex}
                  title={S.memory.indexHint}
                  className={rowClass(indexActive, "pl-2.5")}
                >
                  <GlyphIcon d={INDEX_ICON} size={13} className="shrink-0 text-gray-400" />
                  <span className={rowTextClass(indexActive)}>{S.memory.indexRow}</span>
                </button>
              </li>
              {overview.workspaces.map((w) => (
                <WorkspaceNode
                  key={w.workspaceKey}
                  agentId={agentId}
                  workspace={w}
                  open={openWorkspaces.has(workspaceNodeKey(agentId, w.workspaceKey))}
                  files={memory?.files.get(w.workspaceKey)}
                  selection={selection}
                  onToggle={() => onToggleWorkspace(w.workspaceKey)}
                  onOpenFile={(fileName) => onOpenFile(w.workspaceKey, fileName)}
                  onCreate={() => onCreate(w.workspaceKey)}
                />
              ))}
              {/* The Agent scope is always listed, so an empty list is impossible — what is
                  worth saying is that no Session has run in a persistent Workspace yet. */}
              {!overview.workspaces.some((w) => !w.agentScope) && (
                <li className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
                  {S.memory.noWorkspaces}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function MemoryPage() {
  useDocumentTitle(S.nav.memory);
  const { currentProject, agents, agentsLoading } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // ?agentId= deep link (from the Agents page card): only the target Agent is expanded.
  const [searchParams] = useSearchParams();
  const focusAgentId = searchParams.get("agentId");

  const [tree, setTree] = useState<ReadonlyMap<string, AgentMemory>>(new Map());
  const [openAgents, setOpenAgents] = useState<ReadonlySet<string>>(new Set());
  const [openWorkspaces, setOpenWorkspaces] = useState<ReadonlySet<string>>(new Set());

  const [selection, setSelection] = useState<Selection | null>(null);
  /** Editor buffer and the content it was loaded from (their difference is the unsaved change). */
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState("");
  /** Frontmatter problem blocking the current save (cleared as soon as the buffer changes). */
  const [draftError, setDraftError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  /** Workspace a create dialog is open for; the rename dialog reuses the same name input. */
  const [creatingIn, setCreatingIn] = useState<{ agentId: string; workspaceKey: string } | null>(
    null,
  );
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  const patchAgent = useCallback((agentId: string, fn: (prev: AgentMemory) => AgentMemory) => {
    setTree((prev) => {
      const next = new Map(prev);
      next.set(agentId, fn(prev.get(agentId) ?? EMPTY_AGENT));
      return next;
    });
  }, []);

  const loadOverview = useCallback(
    async (agentId: string) => {
      if (!projectId) return;
      patchAgent(agentId, (prev) => ({ ...prev, overview: null, error: undefined }));
      try {
        const overview = await api.getMemoryOverview(projectId, agentId);
        patchAgent(agentId, (prev) => ({ ...prev, overview }));
      } catch (e) {
        patchAgent(agentId, (prev) => ({ ...prev, error: apiErrorText(e) }));
      }
    },
    [projectId, patchAgent],
  );

  const loadFiles = useCallback(
    async (agentId: string, workspaceKey: string): Promise<MemoryFileInfo[]> => {
      if (!projectId) return [];
      const res = await api.getMemoryFiles(projectId, agentId, workspaceKey);
      patchAgent(agentId, (prev) => ({
        ...prev,
        files: new Map(prev.files).set(workspaceKey, res.files),
      }));
      return res.files;
    },
    [projectId, patchAgent],
  );

  // Switching Project drops everything: the tree, the expansion and whatever was being edited.
  useEffect(() => {
    setTree(new Map());
    setOpenAgents(new Set());
    setOpenWorkspaces(new Set());
    setSelection(null);
    setDraft("");
    setLoaded("");
    setDraftError(undefined);
  }, [projectId]);

  // Initial expansion, applied once per Project: every Agent, or only the deep-link target.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || agents.length === 0 || seeded.current === projectId) return;
    seeded.current = projectId;
    const ids = agents
      .filter((a) => focusAgentId === null || focusAgentId === a.agentId)
      .map((a) => a.agentId);
    setOpenAgents(new Set(ids));
    for (const id of ids) void loadOverview(id);
  }, [projectId, agents, focusAgentId, loadOverview]);

  const dirty = draft !== loaded;
  const current = selection ? (tree.get(selection.agentId) ?? EMPTY_AGENT) : null;
  const overview = current?.overview ?? null;

  const toggleAgent = (agentId: string) => {
    const wasOpen = openAgents.has(agentId);
    const next = new Set(openAgents);
    if (wasOpen) next.delete(agentId);
    else next.add(agentId);
    setOpenAgents(next);
    if (!wasOpen && !tree.has(agentId)) void loadOverview(agentId);
  };

  const toggleWorkspace = (agentId: string, workspaceKey: string) => {
    const nodeKey = workspaceNodeKey(agentId, workspaceKey);
    const wasOpen = openWorkspaces.has(nodeKey);
    const next = new Set(openWorkspaces);
    if (wasOpen) next.delete(nodeKey);
    else next.add(nodeKey);
    setOpenWorkspaces(next);
    if (!wasOpen && !tree.get(agentId)?.files.has(workspaceKey)) {
      loadFiles(agentId, workspaceKey).catch((e: unknown) => toastError(apiErrorText(e)));
    }
  };

  /**
   * Opens an Agent's shared index, parking the caret on a Workspace's group heading when the
   * click came from somewhere inside that Workspace (so the group you were just in is what
   * you land on, since one index holds every group).
   */
  const openIndex = (agentId: string, content: string, workspaceKey: string | null) => {
    setSelection({ kind: "index", agentId });
    setDraft(content);
    setLoaded(content);
    setDraftError(undefined);
    const at = workspaceKey ? headingOffset(content, workspaceKey) : -1;
    if (at < 0) return;
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(at, at);
      // Approximate scroll: put the heading near the top of the visible area.
      const lineHeight = el.scrollHeight / Math.max(1, el.value.split("\n").length);
      el.scrollTop = content.slice(0, at).split("\n").length * lineHeight - lineHeight * 2;
    });
  };

  const openFile = async (agentId: string, workspaceKey: string, fileName: string) => {
    if (!projectId) return;
    try {
      const res = await api.getMemoryFile(projectId, agentId, workspaceKey, fileName);
      setSelection({ kind: "file", agentId, workspaceKey, fileName });
      setDraft(res.content);
      setLoaded(res.content);
      setDraftError(undefined);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /** Writes an Agent's index and keeps the tree's copy in step (the tree is what rename/delete read). */
  const persistIndex = async (agentId: string, content: string): Promise<void> => {
    if (!projectId) return;
    await api.putMemoryIndex(projectId, agentId, content);
    patchAgent(agentId, (prev) => ({
      ...prev,
      overview: prev.overview ? { ...prev.overview, index: content } : prev.overview,
    }));
  };

  const save = async () => {
    if (!projectId || !selection) return;
    if (!dirty) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    // A topic file must stay listable: the index is what the model reads, and it is built from
    // these fields. The shared index itself carries no frontmatter and is exempt.
    const problem = selection.kind === "file" ? frontmatterProblem(draft) : undefined;
    setDraftError(problem);
    if (problem) return;
    setBusy(true);
    try {
      if (selection.kind === "index") {
        await persistIndex(selection.agentId, draft);
      } else {
        await api.putMemoryFile(
          projectId,
          selection.agentId,
          selection.workspaceKey,
          selection.fileName,
          draft,
        );
        await loadFiles(selection.agentId, selection.workspaceKey);
      }
      setLoaded(draft);
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Validates a topic file name for the create / rename dialogs; returns the error, or undefined when valid. */
  const nameProblem = (name: string, agentId: string, workspaceKey: string): string | undefined => {
    if (!name) return S.common.requiredField;
    if (!FILE_NAME_PATTERN.test(name)) return S.memory.fileNameInvalid;
    if (
      tree
        .get(agentId)
        ?.files.get(workspaceKey)
        ?.some((f) => f.name === name)
    ) {
      return S.memory.fileNameTaken;
    }
    return undefined;
  };

  const createFile = async () => {
    if (!projectId || !creatingIn) return;
    const { agentId, workspaceKey } = creatingIn;
    const name = nameInput.trim();
    const problem = nameProblem(name, agentId, workspaceKey);
    if (problem) {
      setNameError(problem);
      return;
    }
    setBusy(true);
    try {
      const content = newFileTemplate(name);
      await api.putMemoryFile(projectId, agentId, workspaceKey, name, content);
      await loadFiles(agentId, workspaceKey);
      // A file created into a collapsed Workspace would otherwise be selected but invisible.
      setOpenWorkspaces((prev) => new Set(prev).add(workspaceNodeKey(agentId, workspaceKey)));
      setSelection({ kind: "file", agentId, workspaceKey, fileName: name });
      setDraft(content);
      setLoaded(content);
      setDraftError(undefined);
      setCreatingIn(null);
      toastSuccess(S.common.saved);
    } catch (e) {
      setNameError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const renameFile = async () => {
    if (!projectId || selection?.kind !== "file") return;
    const { agentId, workspaceKey, fileName } = selection;
    const next = nameInput.trim();
    const problem = nameProblem(next, agentId, workspaceKey);
    if (problem) {
      setNameError(problem);
      return;
    }
    setBusy(true);
    try {
      await api.renameMemoryFile(projectId, agentId, workspaceKey, fileName, next);
      // Keep the index pointing at the file under its new name.
      const index = tree.get(agentId)?.overview?.index ?? "";
      const rewritten = indexWithRenamedFile(index, workspaceKey, fileName, next);
      if (rewritten !== index) await persistIndex(agentId, rewritten);
      await loadFiles(agentId, workspaceKey);
      setSelection({ kind: "file", agentId, workspaceKey, fileName: next });
      setRenaming(false);
      toastSuccess(S.common.saved);
    } catch (e) {
      setNameError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!projectId || selection?.kind !== "file") return;
    const { agentId, workspaceKey, fileName } = selection;
    setBusy(true);
    try {
      await api.deleteMemoryFile(projectId, agentId, workspaceKey, fileName);
      // Drop the index entries that pointed at it, so the index never lists a missing file.
      const index = tree.get(agentId)?.overview?.index ?? "";
      const rewritten = indexWithoutFile(index, workspaceKey, fileName);
      if (rewritten !== index) await persistIndex(agentId, rewritten);
      const remaining = await loadFiles(agentId, workspaceKey);
      // The deleted file was what the editor held: fall back to the index, on its group.
      openIndex(agentId, rewritten, workspaceKey);
      setDeleting(false);
      toastSuccess(S.memory.deleteDone);
      if (remaining.length === 0) toastInfo(S.memory.noFiles);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) return null;

  const selectedFile =
    selection?.kind === "file"
      ? (current?.files.get(selection.workspaceKey)?.find((f) => f.name === selection.fileName) ??
        null)
      : null;

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Directory tree: Agent → index + Workspace → topic file (≥md left column; <md top
          collapsible area). relative: a scroller is its own containing block — the invariant
          and the failure it prevents are documented in styles.css. */}
      <aside className="relative max-h-52 shrink-0 overflow-y-auto border-b border-gray-200 bg-gray-50 px-1 py-2 md:max-h-none md:w-72 md:border-b-0 md:border-r dark:border-gray-800 dark:bg-gray-900">
        <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-gray-500">
          {S.nav.memory}
        </p>
        {agentsLoading ? (
          <SkeletonList rows={4} />
        ) : (
          <ul>
            {agents.map((a) => (
              <AgentNode
                key={a.agentId}
                agentId={a.agentId}
                name={agentDisplayName(a)}
                open={openAgents.has(a.agentId)}
                memory={tree.get(a.agentId)}
                openWorkspaces={openWorkspaces}
                selection={selection}
                onToggle={() => toggleAgent(a.agentId)}
                onOpenIndex={() => {
                  const content = tree.get(a.agentId)?.overview?.index ?? "";
                  const from =
                    selection?.kind === "file" && selection.agentId === a.agentId
                      ? selection.workspaceKey
                      : null;
                  openIndex(a.agentId, content, from);
                }}
                onToggleWorkspace={(workspaceKey) => toggleWorkspace(a.agentId, workspaceKey)}
                onOpenFile={(workspaceKey, fileName) =>
                  void openFile(a.agentId, workspaceKey, fileName)
                }
                onCreate={(workspaceKey) => {
                  setNameInput("");
                  setNameError(undefined);
                  setCreatingIn({ agentId: a.agentId, workspaceKey });
                }}
              />
            ))}
          </ul>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 md:p-4">
        {selection ? (
          <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h1 className="min-w-0 truncate text-lg font-semibold">
                    {selection.kind === "index"
                      ? S.memory.indexFile
                      : (selectedFile?.title ?? selection.fileName)}
                  </h1>
                  {selectedFile?.type && (
                    <Badge tone="gray">{S.memory.types[selectedFile.type]}</Badge>
                  )}
                </div>
                {/* The index's subtitle is a sentence and the file's is a path: only the path
                    gets the monospace-and-truncate treatment, or the sentence loses its tail. */}
                {selection.kind === "index" ? (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {S.memory.indexHint}
                  </p>
                ) : (
                  <p
                    className="mt-0.5 truncate font-mono text-xs text-gray-400"
                    title={`${selection.workspaceKey}/${selection.fileName}`}
                  >
                    {`${selection.workspaceKey}/${selection.fileName}`}
                    {selectedFile && ` · ${formatBytes(selectedFile.size)}`}
                    {selectedFile?.updatedAt && ` · ${selectedFile.updatedAt}`}
                  </p>
                )}
              </div>
              {selection.kind === "file" && (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setNameInput(selection.fileName);
                      setNameError(undefined);
                      setRenaming(true);
                    }}
                  >
                    {S.memory.rename}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => setDeleting(true)}>
                    {S.memory.delete}
                  </Button>
                </div>
              )}
            </div>

            {/* Memory that doesn't reach the model: say so here, where the editing happens, and
                point at the Agent setting that governs it rather than duplicating the switch. */}
            {overview && (!overview.enabled || !overview.templateInjects) && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                {overview.enabled ? S.memory.templateMissingHint : S.memory.disabledHint}{" "}
                <Link
                  to={`/agents/${encodeURIComponent(selection.agentId)}`}
                  className="font-medium underline underline-offset-2"
                >
                  {S.memory.openSettings}
                </Link>
              </p>
            )}

            {draftError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {draftError}
              </p>
            )}
            <Textarea
              ref={editorRef}
              mono
              size="sm"
              invalid={Boolean(draftError)}
              className="min-h-64 flex-1 resize-none"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError(undefined);
              }}
            />
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !dirty}
                onClick={() => void save()}
              >
                {S.common.save}
              </Button>
              {/* A data-root path is long enough to push past the pane and get clipped by the
                  viewport: it truncates, and the full path stays available on hover. */}
              <span
                className="min-w-0 truncate font-mono text-xs text-gray-400"
                title={overview?.memoryDir ?? ""}
              >
                {overview?.memoryDir ?? ""}
              </span>
            </div>
          </div>
        ) : (
          // Constrained: the description is a paragraph, and EmptyState centers its text —
          // across the full pane width that reads as a banner rather than a hint.
          <div className="m-auto max-w-md">
            <EmptyState title={S.memory.selectFile} description={S.memory.desc} />
          </div>
        )}
      </section>

      <Modal
        open={creatingIn !== null || renaming}
        title={creatingIn ? S.memory.newFileTitle : S.memory.renameTitle}
        onClose={() => {
          setCreatingIn(null);
          setRenaming(false);
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setCreatingIn(null);
                setRenaming(false);
              }}
            >
              {S.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void (creatingIn ? createFile() : renameFile())}
            >
              {creatingIn ? S.memory.newFile : S.memory.rename}
            </Button>
          </>
        }
      >
        <Input
          size="sm"
          label={S.memory.fileName}
          required
          hint={S.memory.fileNameHint}
          error={nameError}
          value={nameInput}
          onChange={(e) => {
            setNameInput(e.target.value);
            setNameError(undefined);
          }}
          className="font-mono"
          placeholder="project_release.md"
          autoComplete="off"
        />
      </Modal>

      <ConfirmModal
        open={deleting}
        title={S.memory.deleteTitle}
        busy={busy}
        onClose={() => setDeleting(false)}
        onConfirm={() => void confirmDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {selection?.kind === "file" ? S.memory.deleteConfirm(selection.fileName) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
