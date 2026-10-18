/**
 * One employee's own model, set from either of its two menus: the org chart card's ("Set
 * model", beside "Set thinking level") and the desk row's ("Set model", beside copy and the
 * messaging binding).
 *
 * Saving writes the chart entry — every desk and ticket session opened later uses the model —
 * and moves the current desk onto it at once (the desk-model.ts switch: patch, then renew),
 * so the setting takes effect immediately instead of waiting for the next renewal. With no
 * desk yet, only the chart is written and the desk opens on the model when it is created.
 * Clearing the field writes `model: null`: back to the organization default (then the
 * Project's), renewing the desk the same way a set does.
 *
 * The desk the lists named can move while the dialog is open (another renewal wins the race):
 * the switch then declines to renew a session that is no longer the desk, and the dialog
 * still lands the chart write — it governs every later desk — leaving the current desk alone
 * and saying so, rather than failing a save that half applies.
 */
import { useEffect, useState } from "react";
import type { ModelRefDto, ModelsResponse, OrgEmployeeItem } from "@prismshadow/penguin-server/api";
import {
  Button,
  FieldError,
  Modal,
  discardUnsaved,
  toastError,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { sameModelRef } from "../models/model-grouping";
import { ModelCatalogSelect } from "../chat/model-select";
import { InfoFieldLabel } from "./shared";
import { switchDeskModel } from "./desk-model";

interface EmployeeModelDialogProps {
  open: boolean;
  projectId: string;
  orgId: string;
  employee: OrgEmployeeItem;
  /** The employee's current desk session, when the lists know one; null writes the chart only. */
  deskSessionId: string | null;
  onClose: () => void;
  /** A write went through but the dialog stays open (the renew failed): the chart changed and the page has to re-read it. */
  onChartChanged: () => void;
  /** The save went through and the dialog is done; the new desk session's id, or null when no desk was renewed. */
  onSwitched: (sessionId: string | null) => void;
}

export function EmployeeModelDialog({ open, ...props }: EmployeeModelDialogProps) {
  // Mounted only while open, so the field starts from the stored model every time.
  return open ? <EmployeeModelForm {...props} /> : null;
}

/** The Project's model catalog, loaded once per open; null until it arrives, with the failure kept beside it. */
function useCatalog(projectId: string) {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api
      .getModels(projectId)
      .then((res) => {
        if (!cancelled) setModels(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return { models, error };
}

function EmployeeModelForm({
  projectId,
  orgId,
  employee,
  deskSessionId,
  onClose,
  onChartChanged,
  onSwitched,
}: Omit<EmployeeModelDialogProps, "open">) {
  const form = useFormDraft<ModelRefDto | null>(employee.model ?? null);
  const picked = form.draft;
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  const { models, error: loadError } = useCatalog(projectId);
  const list = models?.models ?? [];
  // Only once the list has actually arrived: an empty list is also what "still loading" and
  // "could not be read" look like, and neither is evidence that the stored model is gone.
  const stale = models !== null && picked !== null && !list.some((m) => sameModelRef(m, picked));
  const loading = models === null && loadError === null;

  /** Done and closing: forget the form now, not at unmount, so the leave guard does not hold the navigation that follows. */
  const done = (sessionId: string | null, notice: string) => {
    toastSuccess(notice);
    discardUnsaved(form.scope);
    onSwitched(sessionId);
  };

  const confirm = async () => {
    if (busy || !form.dirty) return;
    setBusy(true);
    try {
      if (picked === null) {
        await api.patchOrgEmployee(projectId, orgId, employee.agentId, { model: null });
        if (deskSessionId === null) {
          done(null, S.common.saved);
          return;
        }
        const desk = await api.renewOrgDesk(projectId, orgId, employee.agentId);
        done(desk.sessionId, S.common.saved);
        return;
      }
      if (deskSessionId === null) {
        await api.patchOrgEmployee(projectId, orgId, employee.agentId, { model: picked });
        done(null, S.common.saved);
        return;
      }
      const renewed = await switchDeskModel(
        api,
        { projectId, orgId, agentId: employee.agentId, sessionId: deskSessionId },
        picked,
      );
      if (renewed === null) {
        // The desk moved under the dialog: the chart write still lands — it governs every
        // later desk — and the current desk is left alone.
        await api.patchOrgEmployee(projectId, orgId, employee.agentId, { model: picked });
        done(null, S.company.chart.employeeModelDeskMoved);
        return;
      }
      done(renewed, S.common.saved);
    } catch (e) {
      // The chart may be written while the renew failed; the lists re-read and say which.
      toastError(apiErrorText(e));
      onChartChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={S.company.chart.employeeModelTitle(employee.name)}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy || !form.dirty} onClick={() => void confirm()}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <div>
        <InfoFieldLabel label={S.company.modelField} info={S.company.chart.employeeModelInfo} />
        <ModelCatalogSelect
          models={list}
          value={picked}
          onChange={form.setDraft}
          disabled={busy || loading}
          variant="form"
          emptyLabel={loading ? S.common.loading : S.company.chart.employeeModelFollowDefault}
        />
        {loadError !== null ? (
          <FieldError>{S.company.modelsLoadFailed}</FieldError>
        ) : picked === null ? null : (
          <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
            {stale && (
              <span className="text-xs text-gray-500 dark:text-gray-500">{S.company.modelStale}</span>
            )}
            {/* The way back to the organization default, as the action that carries it out. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => form.setDraft(null)}
              className="whitespace-nowrap text-xs text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {S.company.chart.employeeModelClear}
            </button>
          </span>
        )}
      </div>
    </Modal>
  );
}
