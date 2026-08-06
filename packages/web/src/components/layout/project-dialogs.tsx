/**
 * Project dialogs: create Project, Project settings
 * (member management and deletion, owner only). Invoked from the sidebar's Project switcher.
 */
import { useEffect, useState } from "react";
import type {
  ApprovalMode,
  ChatDefaultsDto,
  MemberInfo,
  ModelRefDto,
  ModelsResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import {
  PROJECT_ID_MAX_LENGTH,
  PROJECT_SUFFIX_PATTERN,
  SEMANTIC_ID_PATTERN,
} from "../../lib/semantic-id";
import { agentDisplayName, projectDisplayName, useProject } from "../../state/project";
import { useAuth } from "../../state/auth";
import { clearDraftChatDefaults, clearDraftModelRef } from "../../features/chat/draft-cache";
import {
  dispatchChatDefaultsChanged,
  type ChatDefaultsChangedDetail,
} from "../../features/chat/chat-defaults-event";
import { ModelSelect } from "../../features/chat/model-select";
import { SELECTABLE_THINKING_LEVELS } from "../../features/chat/thinking-level";
import { WorkspaceSelect } from "../../features/chat/workspace-select";
import { sameModelRef } from "../../features/models/model-grouping";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { FieldError, FieldHint, FieldLabel } from "../ui/field";
import { toastError } from "../ui/toast";
import { Modal } from "../ui/modal";
import { ConfirmModal } from "../ui/confirm-modal";
import { Badge } from "../ui/badge";

/** Approval modes offered by the new-chat-defaults select, in the composer menu's order. */
const APPROVAL_MODES: readonly ApprovalMode[] = [
  "always-ask",
  "read-only",
  "allow-all",
  "deny-all",
];

export function CreateProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const { user } = useAuth();
  // Non-admin Project ids are forced to have a "<username>-" prefix: the input locks the prefix segment, only the rest is editable.
  const prefix = user && !user.isAdmin ? `${user.userId}-` : "";
  const [idInput, setIdInput] = useState("");
  const [name, setName] = useState("");
  // The id is the only validated field; format problems and the server's rejection (e.g. duplicate id) both land beside it.
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // No draft is kept: the form starts empty every time it opens.
  useEffect(() => {
    if (!open) return;
    setIdInput("");
    setName("");
    setIdError(undefined);
  }, [open]);

  const submit = async () => {
    const id = prefix + idInput.trim();
    if (!idInput.trim()) {
      setIdError(S.common.requiredField);
      return;
    }
    // Non-admin: validate the suffix segment (the hyphen is a reserved separator, appearing only once at the prefix join); admin: validate the whole string.
    const valid = prefix
      ? PROJECT_SUFFIX_PATTERN.test(idInput.trim()) && id.length <= PROJECT_ID_MAX_LENGTH
      : SEMANTIC_ID_PATTERN.test(id);
    if (!valid) {
      setIdError(prefix ? S.project.idPrefixHint : S.project.idHint);
      return;
    }
    setBusy(true);
    setIdError(undefined);
    try {
      const res = await api.createProject({
        projectId: id,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      onCreated(res.project.projectId);
    } catch (e) {
      setIdError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.project.createTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {prefix ? (
          <div>
            <FieldLabel required>{S.project.id}</FieldLabel>
            <div className="flex items-stretch">
              <span className="flex shrink-0 items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-100 px-2 font-mono text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
                {prefix}
              </span>
              <Input
                size="sm"
                className="rounded-l-none"
                value={idInput}
                invalid={Boolean(idError)}
                onChange={(e) => {
                  setIdInput(e.target.value);
                  setIdError(undefined);
                }}
                autoFocus
              />
            </div>
            {idError ? (
              <FieldError>{idError}</FieldError>
            ) : (
              <FieldHint>{S.project.idPrefixHint}</FieldHint>
            )}
          </div>
        ) : (
          <Input
            label={S.project.id}
            required
            size="sm"
            value={idInput}
            error={idError}
            onChange={(e) => {
              setIdInput(e.target.value);
              setIdError(undefined);
            }}
            hint={S.project.idHint}
            autoFocus
          />
        )}
        <Input
          label={S.project.name}
          size="sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/**
 * Project settings dialog: display name (owner-editable), member management (owner) and
 * deletion (owner); members see the name and member list read-only.
 */
export function ProjectSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { currentProject, setCurrentProjectId, projects, reloadProjects } = useProject();
  const [members, setMembers] = useState<MemberInfo[] | null>(null);
  const [newMemberId, setNewMemberId] = useState("");
  // Only the initial member-list load shows inline (in place of the table); action failures pop a toast.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Display-name edit buffer (owner only); saving is explicit, so it stays dirty until Save or reopen. */
  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const projectId = currentProject?.projectId;
  const isOwner = currentProject?.role === "owner";
  /** The saved display name, with the same id fallback the switcher shows. */
  const savedName = currentProject ? projectDisplayName(currentProject) : "";

  useEffect(() => {
    if (!open || !projectId) return;
    setMembers(null);
    setLoadError(null);
    setConfirmDelete(false);
    setName(savedName);
    setNameError(undefined);
    api
      .listMembers(projectId)
      .then((res) => setMembers(res.members))
      .catch((e: unknown) => setLoadError(apiErrorText(e)));
    // savedName is read at open time only: retyping in the field must not be clobbered by a
    // list refresh, and reopening the dialog re-seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  if (!currentProject || !projectId) return null;

  /**
   * Save the display name (owner). The id is immutable, so this is the only editable field of
   * the Project itself. Success needs no toast: the switcher, this dialog's field and every
   * Project list re-render with the new name once reloadProjects settles (#54, one notification
   * per action) — only failures pop one, and the field keeps what was typed so it can be retried.
   */
  const saveName = async () => {
    const next = name.trim();
    if (!next || next === savedName || nameBusy) return;
    setNameBusy(true);
    setNameError(undefined);
    try {
      await api.updateProject(projectId, { name: next });
      await reloadProjects();
    } catch (e) {
      setNameError(apiErrorText(e));
    } finally {
      setNameBusy(false);
    }
  };

  const addMember = async () => {
    if (!newMemberId.trim()) return;
    try {
      await api.addMember(projectId, { userId: newMemberId.trim() });
      setNewMemberId("");
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const doRemove = async (memberId: string) => {
    try {
      await api.removeMember(projectId, memberId);
      const res = await api.listMembers(projectId);
      setMembers(res.members);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  const doDelete = async () => {
    try {
      await api.deleteProject(projectId);
      onClose();
      const next = projects.find((p) => p.projectId !== projectId);
      await reloadProjects();
      if (next) setCurrentProjectId(next.projectId);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  return (
    <Modal open={open} title={S.project.settingsTitle} onClose={onClose}>
      <div className="space-y-4">
        {/* Display name: the Project's only editable field (the id names the directory and every
            stored reference, so it stays immutable and sits below as a muted mono caption).
            Members see the resolved name as plain text. */}
        <div>
          {isOwner ? (
            <>
              <FieldLabel>{S.project.displayName}</FieldLabel>
              <div className="flex items-stretch gap-2">
                <Input
                  size="sm"
                  className="min-w-0 flex-1"
                  value={name}
                  invalid={Boolean(nameError)}
                  maxLength={100}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError) setNameError(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                  }}
                />
                <Button
                  size="sm"
                  disabled={nameBusy || !name.trim() || name.trim() === savedName}
                  onClick={() => void saveName()}
                >
                  {S.common.save}
                </Button>
              </div>
              {nameError !== undefined && <FieldError>{nameError}</FieldError>}
            </>
          ) : (
            <>
              <p className="mb-1 text-xs font-medium text-gray-500">{S.project.switcher}</p>
              <p className="text-sm">{savedName}</p>
            </>
          )}
          <p className="mt-1 font-mono text-xs text-gray-400">{projectId}</p>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">{S.project.members}</p>
          {loadError ? (
            <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
          ) : members === null ? (
            <p className="text-xs text-gray-400">{S.common.loading}</p>
          ) : (
            // Member permission table: username / role / actions; cells never wrap.
            // Last row (owner only) = add member: small username input + add button (new members are always the member role).
            <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400">
                    <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                      {S.common.username}
                    </th>
                    <th className="whitespace-nowrap px-2.5 py-1.5 font-medium">{S.common.role}</th>
                    <th className="w-20 whitespace-nowrap px-2.5 py-1.5 text-right font-medium">
                      {S.common.actions}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td className="whitespace-nowrap px-2.5 py-1.5">{m.userId}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        <Badge tone="gray">{m.role}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1 text-right">
                        {isOwner && m.role !== "owner" && m.userId !== user?.userId && (
                          <Button size="sm" variant="ghost" onClick={() => void doRemove(m.userId)}>
                            {S.project.removeMember}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {isOwner && (
                    <tr>
                      <td className="px-2.5 py-1.5">
                        <Input
                          placeholder={S.common.username}
                          size="sm"
                          value={newMemberId}
                          onChange={(e) => setNewMemberId(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void addMember();
                          }}
                        />
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        <Badge tone="gray">member</Badge>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1 text-right">
                        <Button
                          size="sm"
                          disabled={!newMemberId.trim()}
                          onClick={() => void addMember()}
                        >
                          {S.project.addMember}
                        </Button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ChatDefaultsSection projectId={projectId} isOwner={isOwner} />

        {isOwner && (
          <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
            {projectId === "default_project" ? (
              <p className="text-xs text-gray-400">{S.project.deleteDefaultForbidden}</p>
            ) : projects.length <= 1 ? (
              // Last accessible Project: deleting it would leave the account with no Project to select
              // (the page would get stuck on the skeleton screen), so the frontend hides the entry point outright, matching the server's 409 rejection.
              <p className="text-xs text-gray-400">{S.project.deleteLastForbidden}</p>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                {S.project.deleteProject}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation (shared ConfirmModal, stacked above the settings dialog). */}
      <ConfirmModal
        open={confirmDelete}
        title={S.project.deleteProject}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.project.deleteConfirm}</p>
      </ConfirmModal>
    </Modal>
  );
}

/**
 * "New chat defaults" section of the Project settings dialog (below Members, above the
 * delete zone): the `[default_chat]` block (Agent / Workspace / approval mode / thinking
 * level) plus the Project's default model, laid out as a compact responsive two-column
 * grid. Workspace and model reuse the chat draft's own pickers — WorkspaceSelect (the
 * dir browser) and ModelSelect (the composer's model dropdown) — with their `form`
 * trigger variant, so the controls line up with the dialog's Input/Select while the
 * POPOVER menus stay exactly the composer's.
 * The model default is SINGLE-SOURCED with the models page — the picker renders and writes
 * the same top-level `default_model` (via the narrow PUT /models/default route), never a
 * second key; changing it also releases the draft-cached model pin exactly as the models
 * page does (shared clearDraftModelRef helper). Owner edits with ONE explicit Save for the
 * whole section (dialog convention: failures toast, success is silent — the refreshed
 * values are the confirmation); members see the values read-only. Mounted per dialog open
 * (the Modal unmounts its children when closed), so reopening always refetches.
 */
function ChatDefaultsSection({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const { user } = useAuth();
  const { agents } = useProject();
  /** Saved block (null while loading); edit buffers below use "" for "not set". */
  const [saved, setSaved] = useState<ChatDefaultsDto | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [approval, setApproval] = useState("");
  const [thinking, setThinking] = useState("");
  /** The default-model pick (paired reference; seeded from the models response's defaultModel). */
  const [modelRef, setModelRef] = useState<ModelRefDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getChatDefaults(projectId)
      .then((res) => {
        if (cancelled) return;
        setSaved(res);
        setAgentId(res.agentId ?? "");
        setWorkspace(res.workspace ?? "");
        setApproval(res.approvalMode ?? "");
        setThinking(res.thinkingLevel ?? "");
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    api
      .getModels(projectId)
      .then((res) => {
        if (cancelled) return;
        setModels(res);
        setModelRef(res.defaultModel ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const blockDirty =
    saved !== null &&
    (agentId !== (saved.agentId ?? "") ||
      workspace.trim() !== (saved.workspace ?? "") ||
      approval !== (saved.approvalMode ?? "") ||
      thinking !== (saved.thinkingLevel ?? ""));
  const modelDirty =
    models !== null && modelRef !== null && !sameModelRef(models.defaultModel, modelRef);

  /**
   * One Save persists both writes: the `[default_chat]` block (whole-block PUT — a field
   * left "not set" is simply omitted, which clears it) and, when changed, the default
   * model via the narrow route. Failures toast and keep the edits for retry.
   *
   * Each landed write also resets the saving user's new-conversation draft so new chats
   * pick the change up instead of being shadowed by the values a previous /chat/new visit
   * pinned into the cache: the corresponding cache fields are stripped (typed text and
   * staged skills always survive), and one same-tab event carries the fresh values to any
   * MOUNTED draft view — its component state still holds the old selections and its
   * debounced persist would silently write them right back over the stripped cache.
   */
  const save = async () => {
    if (busy || (!blockDirty && !modelDirty)) return;
    setBusy(true);
    // Collected per landed write, dispatched in `finally`: when the block PUT lands but the
    // model PUT throws, the block change still happened server-side and live views must
    // still reseed from it.
    let changed: ChatDefaultsChangedDetail | null = null;
    try {
      if (blockDirty) {
        const body: ChatDefaultsDto = {
          ...(agentId ? { agentId } : {}),
          ...(workspace.trim() ? { workspace: workspace.trim() } : {}),
          ...(approval ? { approvalMode: approval as ApprovalMode } : {}),
          ...(thinking ? { thinkingLevel: thinking as ChatDefaultsDto["thinkingLevel"] } : {}),
        };
        const stored = await api.putChatDefaults(projectId, body);
        setSaved(stored);
        // Release the draft-cached Agent / Workspace / approval pins so the next
        // /chat/new seeds from the just-saved block. The model pin is deliberately NOT
        // touched here: it is the switch-becomes-default carry-over, released only below
        // when the default model itself changed.
        if (user) clearDraftChatDefaults(user.userId, projectId);
        changed = { projectId, defaults: stored };
      }
      if (modelDirty && modelRef) {
        const res = await api.putDefaultModel(projectId, {
          provider: modelRef.provider,
          modelId: modelRef.modelId,
        });
        setModels((m) => (m ? { ...m, defaultModel: res.defaultModel } : m));
        // Same follow-through as the models page: drop the draft-cached model pin so open
        // drafts pick up the new default.
        if (user) clearDraftModelRef(user.userId, projectId);
        changed = { ...(changed ?? { projectId }), defaultModel: res.defaultModel };
      }
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      if (changed) dispatchChatDefaultsChanged(changed);
      setBusy(false);
    }
  };

  /** Read-only display values (member view). */
  const agentText = saved?.agentId
    ? (() => {
        const a = agents.find((x) => x.agentId === saved.agentId);
        return a ? agentDisplayName(a) : saved.agentId;
      })()
    : S.project.chatDefaultsNotSet;
  const defaultModelInfo = models?.models.find((m) => sameModelRef(m, models.defaultModel));

  return (
    <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
      <p className="text-xs font-medium text-gray-500">{S.project.chatDefaultsTitle}</p>
      <p className="mb-2 mt-0.5 text-xs text-gray-400">{S.project.chatDefaultsHint}</p>
      {loadError ? (
        <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>
      ) : saved === null || models === null ? (
        <p className="text-xs text-gray-400">{S.common.loading}</p>
      ) : isOwner ? (
        <>
          {/* Compact responsive grid: label + control stacked per cell, two columns from sm
              up; the workspace picker spans the full row for path width. Workspace and model
              are the chat draft's own pickers, not plain form controls. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label={S.project.chatDefaultsAgent}
              size="sm"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">{S.project.chatDefaultsNotSet}</option>
              {agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {agentDisplayName(a)}
                </option>
              ))}
            </Select>
            <Select
              label={S.chat.approvalMode}
              size="sm"
              value={approval}
              onChange={(e) => setApproval(e.target.value)}
            >
              <option value="">{S.project.chatDefaultsApprovalNotSet}</option>
              {APPROVAL_MODES.map((m) => (
                <option key={m} value={m}>
                  {S.chat.approvalModeNames[m] ?? m}
                </option>
              ))}
            </Select>
            <Select
              label={S.chat.thinkingLevel}
              size="sm"
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
            >
              <option value="">{S.project.chatDefaultsThinkingNotSet}</option>
              {SELECTABLE_THINKING_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {S.chat.thinkingLevelNames[l] ?? l}
                </option>
              ))}
            </Select>
            <div>
              <FieldLabel>{S.chat.model}</FieldLabel>
              {models.models.length > 0 ? (
                <>
                  {/* The composer's model dropdown (provider logo + name + searchable grouped
                      panel); the default row carries the S.models.default marker. */}
                  <ModelSelect
                    models={models.models}
                    value={modelRef}
                    defaultModel={models.defaultModel}
                    onChange={setModelRef}
                    disabled={busy}
                    variant="form"
                  />
                  <FieldHint>{S.project.chatDefaultsModelHint}</FieldHint>
                </>
              ) : (
                <p className="text-xs text-gray-400">{S.models.empty}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>{S.chat.workspace}</FieldLabel>
              {/* The draft page's dir-browser pill: browse server directories, edit the path
                  inline, or clear back to a temporary workspace. */}
              <WorkspaceSelect
                projectId={projectId}
                workspace={workspace}
                onChange={setWorkspace}
                variant="form"
              />
              <FieldHint>{S.project.chatDefaultsWorkspaceHint}</FieldHint>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              disabled={busy || (!blockDirty && !modelDirty)}
              onClick={() => void save()}
            >
              {S.common.save}
            </Button>
          </div>
        </>
      ) : (
        // Member view: the effective defaults, read-only (same fields, plain text).
        <div className="space-y-1 text-sm">
          {(
            [
              [S.project.chatDefaultsAgent, agentText],
              [S.chat.workspace, saved.workspace ?? S.chat.workspaceAuto],
              [
                S.chat.approvalMode,
                saved.approvalMode
                  ? (S.chat.approvalModeNames[saved.approvalMode] ?? saved.approvalMode)
                  : S.project.chatDefaultsApprovalNotSet,
              ],
              [
                S.chat.thinkingLevel,
                saved.thinkingLevel
                  ? (S.chat.thinkingLevelNames[saved.thinkingLevel] ?? saved.thinkingLevel)
                  : S.project.chatDefaultsThinkingNotSet,
              ],
              [
                S.chat.model,
                defaultModelInfo
                  ? (defaultModelInfo.displayName ?? defaultModelInfo.modelId)
                  : S.project.chatDefaultsNotSet,
              ],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className="w-24 shrink-0 text-xs text-gray-500">{label}</span>
              <span className="min-w-0 flex-1 break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
