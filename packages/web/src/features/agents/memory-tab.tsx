/**
 * Agent settings page "Memory" tab: the switch, then every memory the Agent keeps, grouped by
 * scope — user memory first (read by every Session), then one group per Workspace (labeled by
 * its `.workspace` path, newest activity first).
 *
 * The tab is read + delete only, matching the API: a memory's content is the model's document,
 * so "edit" jumps to a new chat with this Agent and a prefilled draft naming the file (the same
 * draft-cache route the skill import flow uses); for a Workspace memory the draft also pins
 * that Workspace, so the editing Session is injected with the very index it is about to change.
 * Deleting confirms first and also drops the file's MEMORY.md index lines (server-side).
 *
 * The switch writes immediately rather than joining a tab-level Save, so turning Memory off
 * never drags an unrelated half-finished edit along with it. Off keeps every file and this tab
 * fully usable; it only stops Memory from entering the context and from preparing directories
 * for new Sessions.
 */
import { useCallback, useEffect, useState } from "react";
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
import { Switch } from "../../components/ui/switch";
import { Badge, type BadgeTone } from "../../components/ui/badge";
import { Drawer } from "../../components/ui/drawer";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { EmptyState } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Md } from "../chat/md";
import { DRAFT_SESSION_ID } from "../chat/chat-page";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { buildMemoryEditPrompt } from "./memory-edit-source";

/** The body without its frontmatter block: the drawer's metadata header already shows those fields, so rendering the raw YAML too would only repeat them. */
function bodyWithoutFrontmatter(content: string): string {
  return content.replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/** Badge tone per topic type (unknown/missing types render no badge at all). */
const TYPE_TONES: Record<NonNullable<MemoryFileInfo["type"]>, BadgeTone> = {
  user: "brand",
  feedback: "amber",
  project: "gray",
  reference: "green",
};

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

export function MemoryTab({ agentId }: { agentId: string }) {
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
  const [viewing, setViewing] = useState<(Selected & { content: string }) | null>(null);
  const [removing, setRemoving] = useState<Selected | null>(null);

  const load = useCallback(async () => {
    if (!projectId || !agentId) return;
    setGroups(null);
    setError(null);
    try {
      const overview = await api.getMemoryOverview(projectId, agentId);
      setEnabled(overview.enabled);
      setTemplateHasMemory(overview.templateHasMemory);
      setMemoryDir(overview.memoryDir);
      // Files are the source of truth and each scope is one request; fetch them in parallel.
      setGroups(
        await Promise.all(
          overview.scopes.map(async (scope) => ({
            scope,
            files: (await api.getMemoryFiles(projectId, agentId, scope.scopeKey)).files,
          })),
        ),
      );
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, agentId]);

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
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSwitchBusy(false);
    }
  };

  /** The explicit adoption path for an agent whose template predates Memory: one idempotent config write. */
  const insertSection = async () => {
    if (!projectId) return;
    try {
      const overview = await api.insertMemoryTemplateSection(projectId, agentId);
      setTemplateHasMemory(overview.templateHasMemory);
      toastSuccess(S.memory.insertSectionDone);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const openView = async (scope: MemoryScopeInfo, file: MemoryFileInfo) => {
    if (!projectId) return;
    try {
      const res = await api.getMemoryFile(projectId, agentId, scope.scopeKey, file.name);
      setViewing({ scope, file: res.file, content: res.content });
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /**
   * The edit-via-chat jump: prefill the draft (merging over what is already cached, clearing a
   * stale `/agent` handoff chip that would forward the prompt to a different Agent), pin this
   * Agent — and for a Workspace memory pin that Workspace too, so the editing Session reads the
   * index it is editing.
   */
  const openEdit = (scope: MemoryScopeInfo, file: MemoryFileInfo) => {
    if (!userId || !projectId) return;
    const key = draftKey(userId, projectId);
    saveDraft(key, {
      ...loadDraft(key),
      agentId,
      text: buildMemoryEditPrompt(file.title, `${memoryDir}/${scope.scopeKey}/${file.name}`),
      ...(scope.workspacePath !== undefined ? { workspace: scope.workspacePath } : {}),
      skills: [],
      handoffAgentId: undefined,
    });
    setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, {
      state: {
        agentId,
        ...(scope.workspacePath !== undefined ? { workspace: scope.workspacePath } : {}),
      },
    });
  };

  const confirmRemove = async () => {
    if (!projectId || !removing) return;
    const target = removing;
    setRemoving(null);
    try {
      await api.deleteMemoryFile(projectId, agentId, target.scope.scopeKey, target.file.name);
      toastSuccess(S.memory.deleteDone);
      if (viewing && viewing.file.name === target.file.name) setViewing(null);
      await load();
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;

  const scopeTitle = (scope: MemoryScopeInfo): string =>
    scope.kind === "user"
      ? S.memory.userScope
      : S.memory.workspaceScope(
          scope.workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) ?? scope.scopeKey,
        );

  const rowActions = (scope: MemoryScopeInfo, file: MemoryFileInfo) => (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button size="sm" onClick={() => void openView(scope, file)}>
        {S.memory.view}
      </Button>
      <Button size="sm" variant="primary" onClick={() => openEdit(scope, file)}>
        {S.memory.edit}
      </Button>
      <Button size="sm" variant="danger" onClick={() => setRemoving({ scope, file })}>
        {S.memory.delete}
      </Button>
    </div>
  );

  const fileRow = (scope: MemoryScopeInfo, file: MemoryFileInfo) => (
    <li key={file.name} className="flex items-center gap-3 px-3.5 py-2.5">
      {file.type !== undefined && (
        <Badge tone={TYPE_TONES[file.type]}>{S.memory.types[file.type]}</Badge>
      )}
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
          <Button size="sm" onClick={() => void insertSection()}>
            {S.memory.insertSection}
          </Button>
        </div>
      )}

      {groups === null ? (
        <SkeletonList rows={4} />
      ) : (
        <div className={enabled ? "space-y-5" : "space-y-5 opacity-60"}>
          {groups.map(({ scope, files }) => (
            <section key={scope.scopeKey}>
              <div className="mb-1.5 flex items-baseline gap-2.5">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {scopeTitle(scope)}
                </h3>
                {scope.kind === "workspace" && scope.workspacePath !== undefined && (
                  <span className="min-w-0 truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">
                    {scope.workspacePath}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-gray-400 dark:text-gray-500">
                  {S.memory.itemCount(files.length)}
                </span>
              </div>
              {files.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-4 py-4 text-center text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
                  {scope.kind === "user" ? S.memory.emptyUserScope : S.memory.emptyScope}
                </p>
              ) : (
                <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                  {files.map((file) => fileRow(scope, file))}
                </ul>
              )}
            </section>
          ))}
          {groups.every((g) => g.files.length === 0) && (
            <EmptyState title={S.memory.emptyUserScope} />
          )}
        </div>
      )}

      <Drawer
        open={viewing !== null}
        side="right"
        title={viewing?.file.title ?? ""}
        onClose={() => setViewing(null)}
        widthClass="max-w-lg"
      >
        {viewing && (
          <div className="flex h-full flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              <div className="flex items-center gap-2.5">
                {viewing.file.type !== undefined && (
                  <Badge tone={TYPE_TONES[viewing.file.type]}>
                    {S.memory.types[viewing.file.type]}
                  </Badge>
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {viewing.file.updatedAt ?? formatRelativeDate(viewing.file.modifiedAt, locale)}
                </span>
              </div>
              {viewing.file.description && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {viewing.file.description}
                </p>
              )}
              <div className="md-body border-t border-gray-100 pt-3 text-sm dark:border-gray-800">
                <Md text={bodyWithoutFrontmatter(viewing.content)} />
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
              <Button
                size="sm"
                variant="primary"
                onClick={() => openEdit(viewing.scope, viewing.file)}
              >
                {S.memory.edit}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setRemoving(viewing)}>
                {S.memory.delete}
              </Button>
            </div>
          </div>
        )}
      </Drawer>

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
