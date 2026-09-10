/**
 * Company mode (admin only, server-global), modelled on the proxy section: one switch written
 * by a single PUT to /api/admin/settings. Off stops the organization scheduler, 404s every
 * organization route and hides the mode switch for everyone; on again resumes without
 * backfilling what was missed. Same form contract as the neighbouring pages — the control and
 * Save stay disabled until the stored value arrives, an unchanged save sends nothing, and the
 * saved response is the new baseline. The auth context is refreshed afterwards because the
 * shell reads the flag from /api/me, not from this page.
 */
import { useEffect, useState } from "react";
import type { ServerSettings, ServerSettingsUpdateRequest } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";

export function CompanySection() {
  const { refresh } = useAuth();
  /** Stored settings as hydrated on mount (null until then) — the no-change baseline. */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [companyMode, setCompanyMode] = useState(true);
  const [busy, setBusy] = useState(false);

  const adopt = (next: ServerSettings) => {
    setSettings(next);
    setCompanyMode(next.companyMode);
  };

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (!cancelled) adopt(res.settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (settings === null || busy) return;
    if (companyMode === settings.companyMode) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(true);
    try {
      const body: ServerSettingsUpdateRequest = { companyMode };
      const res = await api.adminPutSettings(body);
      adopt(res.settings);
      // The shell decides whether to draw the mode switch from /api/me; re-pull it so this
      // tab follows its own change without a reload.
      await refresh().catch(() => {});
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const hydrated = settings !== null;
  return (
    <SectionShell
      actions={
        <Button variant="primary" disabled={!hydrated || busy} onClick={() => void save()}>
          {S.common.save}
        </Button>
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{S.settings.companyModeServer}</span>
        <Switch
          checked={companyMode}
          onChange={setCompanyMode}
          disabled={!hydrated}
          aria-label={S.settings.companyModeServer}
        />
      </div>
    </SectionShell>
  );
}
