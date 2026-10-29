import { useState } from "react";
import {
  Button,
  ConfirmModal,
  FieldError,
  Input,
  SettingRow,
  toastError,
  useFormDraft,
  useSaving,
} from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { projectDisplayName, useProject } from "../../../state/project";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

export function GeneralSection({
  projectId,
  isOwner,
  onClose,
}: {
  projectId: string;
  isOwner: boolean;
  onClose: () => void;
}) {
  const { currentProject, setCurrentProjectId, projects, reloadProjects } = useProject();
  /** The saved display name, with the same id fallback the switcher shows. */
  const savedName = currentProject ? projectDisplayName(currentProject) : "";
  /** Display-name edit buffer (owner only); saving is explicit, so it stays dirty until Save. */
  const form = useFormDraft(savedName, {
    scope: PROJECT_SETTINGS_SCOPE,
    normalize: (value) => value.trim(),
  });
  const name = form.draft;
  const [nameBusy, setNameBusy] = useState(false);
  useSaving(nameBusy, PROJECT_SETTINGS_SCOPE);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saveName = async () => {
    const next = name.trim();
    if (!next || !form.dirty || nameBusy) return;
    setNameBusy(true);
    setNameError(undefined);
    try {
      await api.updateProject(projectId, { name: next });
      form.adopt(next);
      await reloadProjects();
    } catch (e) {
      setNameError(apiErrorText(e));
    } finally {
      setNameBusy(false);
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
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <SettingRow title={S.project.displayName}>
        {isOwner ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-stretch gap-2">
              {/* The width sits on a box around the field: the control's own `w-full` outranks
                  a width passed to it, and a field as wide as the row leaves the button
                  beside it no room. Narrower on a phone, where the row's title needs the room. */}
              <div className="w-32 sm:w-44">
                <Input
                  size="sm"
                  aria-label={S.project.displayName}
                  value={name}
                  invalid={Boolean(nameError)}
                  maxLength={100}
                  onChange={(e) => {
                    form.setDraft(e.target.value);
                    if (nameError) setNameError(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                  }}
                />
              </div>
              <Button
                size="sm"
                disabled={nameBusy || !name.trim() || !form.dirty}
                onClick={() => void saveName()}
              >
                {S.common.save}
              </Button>
            </div>
            {nameError !== undefined && <FieldError>{nameError}</FieldError>}
          </div>
        ) : (
          <span className="text-sm">{savedName}</span>
        )}
      </SettingRow>
      <SettingRow title={S.project.projectIdLabel}>
        <span className="font-mono text-xs text-gray-400">{projectId}</span>
      </SettingRow>
      {isOwner &&
        (projectId === "default_project" ? (
          <SettingRow
            title={S.project.deleteProject}
            description={S.project.deleteDefaultForbidden}
          />
        ) : projects.length <= 1 ? (
          // Last accessible Project: deleting it would leave the account with no Project to
          // select (the page would get stuck on the skeleton screen), so the entry point is
          // hidden outright, matching the server's 409 rejection.
          <SettingRow title={S.project.deleteProject} description={S.project.deleteLastForbidden} />
        ) : (
          <SettingRow title={S.project.deleteProject} description={S.project.deleteProjectDesc}>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
              {S.common.delete}
            </Button>
          </SettingRow>
        ))}

      {/* Delete confirmation (shared ConfirmModal, stacked above the settings dialog). */}
      <ConfirmModal
        open={confirmDelete}
        title={S.project.deleteProject}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.project.deleteConfirm}</p>
      </ConfirmModal>
    </div>
  );
}
