/**
 * Organization dialogs, invoked from the sidebar's organization switcher (and the empty
 * landing): create an organization — id, display name, one-sentence mission, the Project it
 * belongs to when the user has several — and an organization's settings: name, mission,
 * timezone, approval mode, pause / resume, and (Project owner only) deletion behind the
 * shared confirmation, whose copy says what stays: the employee Agents and every session.
 */
import { useEffect, useState } from "react";
import type {
  OrgApprovalMode,
  OrganizationDetail,
  OrganizationPatchRequest,
  OrganizationSettings,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SEMANTIC_ID_PATTERN } from "../../lib/semantic-id";
import { projectDisplayName, useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { FieldLabel } from "../../components/ui/field";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { Badge } from "../../components/ui/badge";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { ICON_GAP } from "../../lib/icon-scale";

const APPROVAL_MODES: readonly OrgApprovalMode[] = ["allow-all", "read-only", "deny-all"];

export function CreateOrganizationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (detail: OrganizationDetail) => void;
}) {
  const { projects, currentProject } = useProject();
  const [projectId, setProjectId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [idError, setIdError] = useState<string | undefined>(undefined);
  const [missionError, setMissionError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // No draft is kept: the form starts empty every time it opens, in the current Project.
  useEffect(() => {
    if (!open) return;
    setProjectId(currentProject?.projectId ?? projects[0]?.projectId ?? "");
    setOrgId("");
    setName("");
    setMission("");
    setIdError(undefined);
    setMissionError(undefined);
  }, [open, currentProject, projects]);

  const submit = async () => {
    const id = orgId.trim();
    let bad = false;
    if (!id) {
      setIdError(S.common.requiredField);
      bad = true;
    } else if (!SEMANTIC_ID_PATTERN.test(id)) {
      setIdError(S.company.orgIdHint);
      bad = true;
    }
    if (!mission.trim()) {
      setMissionError(S.common.requiredField);
      bad = true;
    }
    if (bad || !projectId) return;
    setBusy(true);
    try {
      const detail = await api.createOrganization(projectId, {
        orgId: id,
        mission: mission.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      toastSuccess(S.company.createdOpeningCeo);
      onCreated(detail);
    } catch (e) {
      setIdError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={S.company.createTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {S.common.create}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {projects.length > 1 && (
          <Select
            size="sm"
            label={S.project.switcher}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {projectDisplayName(p)}
              </option>
            ))}
          </Select>
        )}
        <Input
          label={S.company.orgId}
          required
          size="sm"
          value={orgId}
          error={idError}
          hint={S.company.orgIdHint}
          className="font-mono"
          autoFocus
          onChange={(e) => {
            setOrgId(e.target.value);
            setIdError(undefined);
          }}
        />
        <Input
          label={S.company.displayName}
          size="sm"
          value={name}
          hint={S.company.displayNameHint}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label={S.company.mission}
          required
          size="sm"
          rows={3}
          value={mission}
          error={missionError}
          hint={S.company.missionHint}
          placeholder={S.company.missionPlaceholder}
          onChange={(e) => {
            setMission(e.target.value);
            setMissionError(undefined);
          }}
        />
      </div>
    </Modal>
  );
}

export function OrganizationSettingsDialog({
  open,
  projectId,
  orgId,
  onClose,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  projectId: string;
  orgId: string;
  onClose: () => void;
  /** Settings were written (name, mission, status …): the caller refreshes the list. */
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { currentProject } = useProject();
  const isOwner = currentProject?.projectId === projectId && currentProject.role === "owner";
  /** Stored settings as loaded on open (null until then) — the no-change baseline. */
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [timezone, setTimezone] = useState("");
  const [approvalMode, setApprovalMode] = useState<OrgApprovalMode>("allow-all");
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const adopt = (next: OrganizationSettings) => {
    setSettings(next);
    setName(next.name);
    setMission(next.mission);
    setTimezone(next.timezone);
    setApprovalMode(next.approvalMode);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSettings(null);
    void api
      .getOrganization(projectId, orgId)
      .then((detail) => {
        if (!cancelled) adopt(detail.settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, orgId]);

  const patch = async (body: OrganizationPatchRequest) => {
    setBusy(true);
    try {
      adopt(await api.patchOrganization(projectId, orgId, body));
      toastSuccess(S.common.saved);
      onChanged();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (settings === null) return;
    const body: OrganizationPatchRequest = {};
    if (name.trim() && name.trim() !== settings.name) body.name = name.trim();
    if (mission.trim() && mission.trim() !== settings.mission) body.mission = mission.trim();
    if (timezone.trim() && timezone.trim() !== settings.timezone) body.timezone = timezone.trim();
    if (approvalMode !== settings.approvalMode) body.approvalMode = approvalMode;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    void patch(body).then(onClose);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteOrganization(projectId, orgId);
      toastSuccess(S.company.deleted);
      setDeleteOpen(false);
      onDeleted();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const hydrated = settings !== null;
  const paused = settings?.status === "paused";
  return (
    <>
      <Modal
        open={open}
        title={S.company.settingsTitle}
        onClose={onClose}
        footer={
          <>
            {isOwner && (
              <Button
                variant="danger"
                disabled={!hydrated || busy}
                onClick={() => setDeleteOpen(true)}
                className="mr-auto"
              >
                {S.company.deleteOrg}
              </Button>
            )}
            <Button onClick={onClose} disabled={busy}>
              {S.common.cancel}
            </Button>
            <Button variant="primary" disabled={!hydrated || busy} onClick={save}>
              {S.common.save}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Status row: the pause / resume is immediate (its own PATCH), not part of Save —
              stopping an organization is a decision, not a draft. */}
          <div className="flex items-center justify-between gap-3">
            <span
              className={`flex items-center ${ICON_GAP.row} text-xs font-semibold text-gray-600 dark:text-gray-400`}
            >
              {S.company.status}
              <InfoPopover label={S.company.status}>{S.company.pauseInfo}</InfoPopover>
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={paused ? "amber" : "green"}>
                {paused ? S.company.statusPaused : S.company.statusActive}
              </Badge>
              <Button
                size="sm"
                disabled={!hydrated || busy}
                onClick={() => void patch({ status: paused ? "active" : "paused" })}
              >
                {paused ? S.company.resume : S.company.pause}
              </Button>
            </span>
          </div>
          <Input
            label={S.company.displayName}
            size="sm"
            value={name}
            disabled={!hydrated}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            label={S.company.mission}
            size="sm"
            rows={3}
            value={mission}
            disabled={!hydrated}
            hint={S.company.missionHint}
            onChange={(e) => setMission(e.target.value)}
          />
          <Input
            label={S.company.timezone}
            size="sm"
            value={timezone}
            disabled={!hydrated}
            hint={S.company.timezoneHint}
            className="font-mono"
            onChange={(e) => setTimezone(e.target.value)}
          />
          <div>
            {/* The "?" sits beside the field's own title (Select carries no info slot). */}
            <span className="mb-1 flex items-center gap-1">
              <FieldLabel block={false}>{S.company.approvalMode}</FieldLabel>
              <InfoPopover label={S.company.approvalMode}>{S.company.approvalModeInfo}</InfoPopover>
            </span>
            <Select
              size="sm"
              aria-label={S.company.approvalMode}
              value={approvalMode}
              disabled={!hydrated}
              onChange={(e) => setApprovalMode(e.target.value as OrgApprovalMode)}
            >
              {APPROVAL_MODES.map((m) => (
                <option key={m} value={m}>
                  {S.company.approvalModes[m] ?? m}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Modal>
      <ConfirmModal
        open={deleteOpen}
        title={S.company.deleteOrg}
        confirmLabel={S.common.delete}
        busy={busy}
        onClose={() => (busy ? undefined : setDeleteOpen(false))}
        onConfirm={() => void remove()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.deleteOrgConfirm(settings?.name ?? orgId)}
        </p>
      </ConfirmModal>
    </>
  );
}
