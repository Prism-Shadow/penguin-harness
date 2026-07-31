/**
 * Agent settings page "Memory" tab: Workspace Memory (agent_state/memory/) — the Agent-level
 * switch, a Workspace selector, that Workspace's topic files, and a Markdown editor.
 *
 * The shared index (`memory/AGENTS.md`) is pinned above the topic files and opens with the
 * caret parked on the selected Workspace's heading, since one index covers every Workspace.
 * Renaming or deleting a topic file also rewrites the index links that pointed at it — the
 * link form is exact (`](<workspaceKey>/<file>)`), so this stays a mechanical edit and never
 * rewrites prose the model wrote.
 *
 * Turning Memory off keeps every file and leaves this page fully usable; it only stops Memory
 * from entering the Agent's context and from preparing directories for new Sessions.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MemoryFileInfo,
  MemoryOverviewResponse,
  MemoryWorkspaceInfo,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";

/** Topic file names, matching the server's rule (a Markdown file, no path, no leading dot). */
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

/** The pinned index entry is selected as `null`; a string selects that topic file. */
type Selection = { kind: "index" } | { kind: "file"; name: string };

const INDEX_SELECTION: Selection = { kind: "index" };

/** Frontmatter skeleton for a new topic file, so a hand-created file starts out listable. */
function newFileTemplate(fileName: string): string {
  const title = fileName.replace(/\.md$/, "").replace(/[_-]+/g, " ");
  const today = new Date().toISOString().slice(0, 10);
  return `---\nname: ${title}\ndescription: \ntype: project\nupdated_at: ${today}\n---\n\n`;
}

/** Topic types a file may declare (mirrors core's MEMORY_TOPIC_TYPES; `user` is deliberately not one). */
const TOPIC_TYPES = ["feedback", "project", "reference"] as const;

/**
 * Checks a topic file's frontmatter before it is saved (exported for unit tests), so the file stays listable — a file
 * whose `name` or `type` is missing shows up in the list as a bare file name with no type, and
 * is that much harder for the model to judge from the index. Returns the problem to show next
 * to the editor, or undefined when the frontmatter is complete. The shared index is exempt:
 * it is not a topic file and carries no frontmatter.
 */
export function frontmatterProblem(content: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^﻿/, ""));
  if (!match) return S.memory.frontmatterMissing;
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  if (!fields.get("name")) return S.memory.frontmatterNameRequired;
  const type = fields.get("type");
  if (!type || !(TOPIC_TYPES as readonly string[]).includes(type)) {
    return S.memory.frontmatterTypeInvalid;
  }
  return undefined;
}

/** Index links to one topic file are exactly `](<workspaceKey>/<file>)`; used to keep the index in step with a rename or delete. */
function indexLink(workspaceKey: string, fileName: string): string {
  return `](${workspaceKey}/${fileName})`;
}

/** Drops every index line pointing at a deleted topic file (exported for unit tests). */
export function indexWithoutFile(index: string, workspaceKey: string, fileName: string): string {
  const link = indexLink(workspaceKey, fileName);
  return index
    .split("\n")
    .filter((line) => !line.includes(link))
    .join("\n");
}

/** Repoints every index link from an old topic file name to its new one (exported for unit tests). */
export function indexWithRenamedFile(
  index: string,
  workspaceKey: string,
  fileName: string,
  nextName: string,
): string {
  return index.split(indexLink(workspaceKey, fileName)).join(indexLink(workspaceKey, nextName));
}

/** Offset of a Workspace's group heading in the index, so opening the index lands on the right group; -1 when the index has no heading for it yet (exported for unit tests). */
export function headingOffset(index: string, workspaceKey: string): number {
  const match = new RegExp(`^#{1,6}\\s+${workspaceKey}\\s*$`, "m").exec(index);
  return match ? match.index : -1;
}

/**
 * What the file list shows below the pinned index (exported for unit tests).
 *
 * `none` is the case the loading state cannot cover: with no Workspace selected there is no
 * request in flight and never will be, so `files` stays null forever — rendering the skeleton
 * on a null `files` alone would spin indefinitely for an agent that has no Workspace Memory
 * directory yet. Topic files belong to a Workspace, so with none selected the list holds the
 * Agent-level index and nothing else.
 */
export type FileListState = "none" | "loading" | "empty" | "files";

export function fileListState(
  workspaceKey: string | null,
  files: MemoryFileInfo[] | null,
): FileListState {
  if (workspaceKey === null) return "none";
  if (files === null) return "loading";
  return files.length === 0 ? "empty" : "files";
}

export function MemoryTab({ agentId }: { agentId: string }) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [overview, setOverview] = useState<MemoryOverviewResponse | null>(null);
  // Tab-level error is the initial load failure only; every later action reports via toast.
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [workspaceKey, setWorkspaceKey] = useState<string | null>(null);
  const [files, setFiles] = useState<MemoryFileInfo[] | null>(null);
  const [selection, setSelection] = useState<Selection>(INDEX_SELECTION);
  /** Editor buffer and the content it was loaded from (their difference is the unsaved change). */
  const [draft, setDraft] = useState("");
  /** Frontmatter problem blocking the current save (cleared as soon as the buffer changes). */
  const [draftError, setDraftError] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const [creating, setCreating] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setOverview(null);
    setError(null);
    try {
      const res = await api.getMemoryOverview(projectId, agentId);
      setOverview(res);
      setWorkspaceKey(res.workspaces[0]?.workspaceKey ?? null);
      setSelection(INDEX_SELECTION);
      setDraft(res.index);
      setLoaded(res.index);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Workspace switch: reload its topic files (the pinned index stays selected).
  useEffect(() => {
    if (!projectId || !agentId || workspaceKey === null) {
      setFiles(null);
      return;
    }
    let cancelled = false;
    setFiles(null);
    api
      .getMemoryFiles(projectId, agentId, workspaceKey)
      .then((res) => {
        if (!cancelled) setFiles(res.files);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId, workspaceKey]);

  const dirty = draft !== loaded;

  /** Opens the shared index, parking the caret on the selected Workspace's group heading. */
  const openIndex = (content: string) => {
    setSelection(INDEX_SELECTION);
    setDraft(content);
    setLoaded(content);
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

  const openFile = async (name: string) => {
    if (!projectId || !workspaceKey) return;
    try {
      const res = await api.getMemoryFile(projectId, agentId, workspaceKey, name);
      setSelection({ kind: "file", name });
      setDraft(res.content);
      setLoaded(res.content);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /** Refreshes the current Workspace's file list (after a create / rename / delete). */
  const reloadFiles = async (): Promise<MemoryFileInfo[]> => {
    if (!projectId || !workspaceKey) return [];
    const res = await api.getMemoryFiles(projectId, agentId, workspaceKey);
    setFiles(res.files);
    return res.files;
  };

  /** Writes the index and keeps the local copy in step (the overview caches it for the pinned entry). */
  const persistIndex = async (content: string): Promise<void> => {
    if (!projectId) return;
    await api.putMemoryIndex(projectId, agentId, content);
    setOverview((prev) => (prev ? { ...prev, index: content } : prev));
  };

  const save = async () => {
    if (!projectId || !dirty) {
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
        await persistIndex(draft);
      } else {
        if (!workspaceKey) return;
        await api.putMemoryFile(projectId, agentId, workspaceKey, selection.name, draft);
        await reloadFiles();
      }
      setLoaded(draft);
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Validates a topic file name for the create / rename dialogs; returns the error message, or undefined when valid. */
  const nameProblem = (name: string): string | undefined => {
    if (!name) return S.common.requiredField;
    if (!FILE_NAME_PATTERN.test(name)) return S.memory.fileNameInvalid;
    if (files?.some((f) => f.name === name)) return S.memory.fileNameTaken;
    return undefined;
  };

  const createFile = async () => {
    const name = nameInput.trim();
    const problem = nameProblem(name);
    if (problem || !projectId || !workspaceKey) {
      setNameError(problem);
      return;
    }
    setBusy(true);
    try {
      const content = newFileTemplate(name);
      await api.putMemoryFile(projectId, agentId, workspaceKey, name, content);
      await reloadFiles();
      setSelection({ kind: "file", name });
      setDraft(content);
      setLoaded(content);
      setCreating(false);
      toastSuccess(S.common.saved);
    } catch (e) {
      setNameError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const renameFile = async () => {
    const next = nameInput.trim();
    const problem = nameProblem(next);
    if (problem || !projectId || !workspaceKey || selection.kind !== "file") {
      setNameError(problem);
      return;
    }
    const from = selection.name;
    setBusy(true);
    try {
      await api.renameMemoryFile(projectId, agentId, workspaceKey, from, next);
      // Keep the index pointing at the file under its new name.
      const index = overview?.index ?? "";
      const rewritten = indexWithRenamedFile(index, workspaceKey, from, next);
      if (rewritten !== index) await persistIndex(rewritten);
      await reloadFiles();
      setSelection({ kind: "file", name: next });
      setRenaming(false);
      toastSuccess(S.common.saved);
    } catch (e) {
      setNameError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!projectId || !workspaceKey || deleting === null) return;
    setBusy(true);
    try {
      await api.deleteMemoryFile(projectId, agentId, workspaceKey, deleting);
      // Drop the index entries that pointed at it, so the index never lists a missing file.
      const index = overview?.index ?? "";
      const rewritten = indexWithoutFile(index, workspaceKey, deleting);
      if (rewritten !== index) await persistIndex(rewritten);
      const remaining = await reloadFiles();
      if (selection.kind === "file" && selection.name === deleting) {
        openIndex(rewritten);
      }
      setDeleting(null);
      toastSuccess(S.memory.deleteDone);
      if (remaining.length === 0) toastInfo(S.memory.noFiles);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.putAgentConfig(projectId, agentId, {
        config: { memory: { enabled: next } },
      });
      setOverview((prev) => (prev ? { ...prev, enabled: res.config.memory.enabled } : prev));
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) return null;
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!overview) return <SkeletonList rows={5} />;

  const workspace = overview.workspaces.find((w) => w.workspaceKey === workspaceKey) ?? null;
  const listState = fileListState(workspaceKey, files);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.memory.desc}</p>

      {/* Agent-level switch: content management below stays available either way. */}
      <div className="flex items-start justify-between gap-4 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <p className="text-sm font-medium">{S.memory.enable}</p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {overview.enabled ? S.memory.enabledHint : S.memory.disabledHint}
          </p>
          {overview.enabled && !overview.templateInjects && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {S.memory.templateMissingHint}
            </p>
          )}
        </div>
        <Switch
          checked={overview.enabled}
          disabled={busy}
          onChange={(next) => void toggleEnabled(next)}
          aria-label={S.memory.enable}
        />
      </div>

      <p className="font-mono text-xs text-gray-400 dark:text-gray-500">{overview.memoryDir}</p>

      {overview.workspaces.length === 0 ? (
        <p className="py-2 text-xs text-gray-400 dark:text-gray-500">{S.memory.noWorkspaces}</p>
      ) : (
        <Select
          size="sm"
          label={S.memory.workspace}
          value={workspaceKey ?? ""}
          onChange={(e) => setWorkspaceKey(e.target.value)}
        >
          {overview.workspaces.map((w) => (
            <option key={w.workspaceKey} value={w.workspaceKey}>
              {workspaceLabel(w)}
            </option>
          ))}
        </Select>
      )}

      {/* File list: the shared index pinned on top, then the selected Workspace's topic files
          (the index stands alone when there is no Workspace — see fileListState). */}
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <button
          type="button"
          onClick={() => openIndex(overview.index)}
          className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left transition-colors duration-150 last:border-b-0 dark:border-gray-800/60 ${
            selection.kind === "index"
              ? "bg-gray-100 dark:bg-gray-800/60"
              : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
          }`}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{S.memory.indexFile}</span>
            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
              {S.memory.indexHint}
            </span>
          </span>
          <span className="shrink-0 font-mono text-[11px] text-gray-400">AGENTS.md</span>
        </button>

        {listState === "none" ? null : listState === "loading" ? (
          <div className="p-3">
            <SkeletonList rows={3} />
          </div>
        ) : listState === "empty" ? (
          <p className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500">{S.memory.noFiles}</p>
        ) : (
          (files ?? []).map((file) => (
            <button
              key={file.name}
              type="button"
              onClick={() => void openFile(file.name)}
              className={`flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-left transition-colors duration-150 last:border-b-0 dark:border-gray-800/60 ${
                selection.kind === "file" && selection.name === file.name
                  ? "bg-gray-100 dark:bg-gray-800/60"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
              }`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{file.title}</span>
                  {file.type && <Badge tone="gray">{S.memory.types[file.type]}</Badge>}
                </span>
                <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                  {file.description || file.name}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-gray-400">
                {file.updatedAt ?? file.modifiedAt.slice(0, 10)}
              </span>
            </button>
          ))
        )}
      </div>

      {workspace && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setNameInput("");
              setNameError(undefined);
              setCreating(true);
            }}
          >
            {S.memory.newFile}
          </Button>
          {selection.kind === "file" && (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setNameInput(selection.name);
                  setNameError(undefined);
                  setRenaming(true);
                }}
              >
                {S.memory.rename}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => setDeleting(selection.name)}>
                {S.memory.delete}
              </Button>
            </>
          )}
        </div>
      )}

      <Textarea
        ref={editorRef}
        label={selection.kind === "index" ? S.memory.indexFile : selection.name}
        mono
        size="sm"
        rows={18}
        value={draft}
        error={draftError}
        onChange={(e) => {
          setDraft(e.target.value);
          setDraftError(undefined);
        }}
      />
      <Button size="sm" variant="primary" disabled={busy || !dirty} onClick={() => void save()}>
        {S.common.save}
      </Button>

      <Modal
        open={creating || renaming}
        title={creating ? S.memory.newFileTitle : S.memory.renameTitle}
        onClose={() => {
          setCreating(false);
          setRenaming(false);
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setCreating(false);
                setRenaming(false);
              }}
            >
              {S.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void (creating ? createFile() : renameFile())}
            >
              {creating ? S.memory.newFile : S.memory.rename}
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
        open={deleting !== null}
        title={S.memory.deleteTitle}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.memory.deleteConfirm(deleting) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}

/** Workspace option label: the recorded path when the directory has a marker, otherwise the key alone. */
function workspaceLabel(w: MemoryWorkspaceInfo): string {
  const files = S.memory.fileCount(w.fileCount);
  return w.workspacePath ? `${w.workspacePath} — ${files}` : `${w.workspaceKey} — ${files}`;
}
