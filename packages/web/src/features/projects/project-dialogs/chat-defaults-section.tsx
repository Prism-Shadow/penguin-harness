import { useEffect, useState } from "react";
import type {
  ApprovalMode,
  ChatDefaultsDto,
  ModelRefDto,
  ModelsResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  FieldLabel,
  InfoPopover,
  Select,
  toastError,
  toastSuccess,
  useFormDraft,
  useSaving,
} from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { agentDisplayName, useProject } from "../../../state/project";
import { useAuth } from "../../../state/auth";
import {
  clearDraftChatDefaults,
  clearDraftModelRef,
  dispatchChatDefaultsChanged,
  ModelCatalogSelect,
  modelLabel,
  SELECTABLE_THINKING_LEVELS,
  WorkspaceSelect,
  type ChatDefaultsChangedDetail,
} from "../../chat";

import { sameModelRef } from "../../models";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

export const APPROVAL_MODES: readonly ApprovalMode[] = [
  "always-ask",
  "read-only",
  "allow-all",
  "deny-all",
];

export function ChatDefaultsSection({
  projectId,
  isOwner,
}: {
  projectId: string;
  isOwner: boolean;
}) {
  const { user } = useAuth();
  const { agents } = useProject();
  /** Saved block (null while loading); the draft uses "" for "not set". */
  const [saved, setSaved] = useState<ChatDefaultsDto | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useSaving(busy, PROJECT_SETTINGS_SCOPE);
  // The selects are fields of this form (they save with it), and the default-model pick is a
  // paired reference seeded from the models response's defaultModel.
  const form = useFormDraft(chatDefaultsDraft(saved, models?.defaultModel ?? null), {
    scope: PROJECT_SETTINGS_SCOPE,
    normalize: (d) => ({
      ...d,
      workspace: d.workspace.trim(),
      modelRef:
        d.modelRef === null ? null : { provider: d.modelRef.provider, modelId: d.modelRef.modelId },
    }),
  });
  const { agentId, workspace, approval, thinking, modelRef } = form.draft;

  useEffect(() => {
    let cancelled = false;
    api
      .getChatDefaults(projectId)
      .then((res) => {
        if (!cancelled) setSaved(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    api
      .getModels(projectId)
      .then((res) => {
        if (!cancelled) setModels(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const stored = form.baseline;
  const blockDirty =
    saved !== null &&
    (agentId !== stored.agentId ||
      workspace.trim() !== stored.workspace ||
      approval !== stored.approval ||
      thinking !== stored.thinking);
  const modelDirty =
    models !== null && modelRef !== null && !sameModelRef(stored.modelRef, modelRef);

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
    let landed = stored;
    try {
      if (blockDirty) {
        const body: ChatDefaultsDto = {
          ...(agentId ? { agentId } : {}),
          ...(workspace.trim() ? { workspace: workspace.trim() } : {}),
          ...(approval ? { approvalMode: approval as ApprovalMode } : {}),
          ...(thinking ? { thinkingLevel: thinking as ChatDefaultsDto["thinkingLevel"] } : {}),
        };
        const block = await api.putChatDefaults(projectId, body);
        setSaved(block);
        landed = chatDefaultsDraft(block, landed.modelRef);
        // Release the draft-cached Agent / Workspace / approval pins so the next
        // /chat/new seeds from the just-saved block. The model pin is deliberately NOT
        // touched here: it is the switch-becomes-default carry-over, released only below
        // when the default model itself changed.
        if (user) clearDraftChatDefaults(user.userId, projectId);
        changed = { projectId, defaults: block };
      }
      if (modelDirty && modelRef) {
        const res = await api.putDefaultModel(projectId, {
          provider: modelRef.provider,
          modelId: modelRef.modelId,
        });
        setModels((m) => (m ? { ...m, defaultModel: res.defaultModel } : m));
        landed = { ...landed, modelRef: res.defaultModel ?? null };
        // Same follow-through as the models page: drop the draft-cached model pin so open
        // drafts pick up the new default.
        if (user) clearDraftModelRef(user.userId, projectId);
        changed = { ...(changed ?? { projectId }), defaultModel: res.defaultModel };
      }
      // Both writes landed (the try didn't throw): what the server stored is the form now, and
      // a toast says so — the dialog stays open, so without one a successful save is silent.
      // `changed` is non-null whenever anything was actually written (the early-return above
      // guards the no-op case). A write that failed leaves the draft as typed.
      form.adopt(landed);
      if (changed) toastSuccess(S.common.saved);
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
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-500">
        {S.project.chatDefaultsTitle}
        <InfoPopover label={S.project.chatDefaultsTitle}>{S.project.chatDefaultsHint}</InfoPopover>
      </p>
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
              onChange={(e) => form.patch({ agentId: e.target.value })}
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
              onChange={(e) => form.patch({ approval: e.target.value })}
            >
              <option value="">{S.project.chatDefaultsApprovalNotSet}</option>
              {APPROVAL_MODES.map((m) => (
                <option key={m} value={m}>
                  {S.chat.approvalModeNames[m] ?? m}
                </option>
              ))}
            </Select>
            {/* Plain tier names, not the composer dropdown's annotated variant: a Select
                shows the picked option's own text on its closed trigger, so
                annotating the rows here would also put "(xhigh)" on what is, once closed,
                a trigger. Matches the approval-mode select directly above, whose options
                are plain localized names too. */}
            <Select
              label={S.chat.thinkingLevel}
              size="sm"
              value={thinking}
              onChange={(e) => form.patch({ thinking: e.target.value })}
            >
              <option value="">{S.project.chatDefaultsThinkingNotSet}</option>
              {SELECTABLE_THINKING_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {S.chat.thinkingLevelNames[l] ?? l}
                </option>
              ))}
            </Select>
            <div>
              <span className="mb-1 flex items-center gap-1">
                <FieldLabel block={false}>{S.chat.model}</FieldLabel>
                <InfoPopover label={S.chat.model}>{S.project.chatDefaultsModelHint}</InfoPopover>
              </span>
              {models.models.length > 0 ? (
                <>
                  {/* The composer's model picker (provider logo + name, opening the model-picker
                      dialog); the default row carries the S.models.default marker. */}
                  <ModelCatalogSelect
                    models={models.models}
                    value={modelRef}
                    defaultModel={models.defaultModel}
                    onChange={(next) => form.patch({ modelRef: next })}
                    disabled={busy}
                    variant="form"
                  />
                </>
              ) : (
                <p className="text-xs text-gray-400">{S.models.empty}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>{S.chat.workspace}</FieldLabel>
              {/* The draft page's folder finder: browse server directories, go to a typed
                  path, or start in a temporary workspace. That one would belong to the
                  default Agent when one is set, so the finder can show where. */}
              <WorkspaceSelect
                projectId={projectId}
                workspace={workspace}
                onChange={(next) => form.patch({ workspace: next })}
                {...(agentId ? { agentId } : {})}
                variant="form"
              />
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
                defaultModelInfo ? modelLabel(defaultModelInfo) : S.project.chatDefaultsNotSet,
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

export interface ChatDefaultsDraft {
  agentId: string;
  workspace: string;
  approval: string;
  thinking: string;
  modelRef: ModelRefDto | null;
}

export function chatDefaultsDraft(
  saved: ChatDefaultsDto | null,
  modelRef: ModelRefDto | null,
): ChatDefaultsDraft {
  return {
    agentId: saved?.agentId ?? "",
    workspace: saved?.workspace ?? "",
    approval: saved?.approvalMode ?? "",
    thinking: saved?.thinkingLevel ?? "",
    modelRef,
  };
}
