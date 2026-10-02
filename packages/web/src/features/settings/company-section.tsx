/**
 * Company mode (admin only, server-global): one switch that applies the moment it is flipped —
 * a single PUT to /api/admin/settings, no Save button, and so no draft state to lose. The switch
 * is off on a server nobody has turned it on, which is why the pre-hydration state below is off
 * rather than on; it stays disabled until the stored value arrives and again while a write is in
 * flight, so a second flip cannot race the first. Off stops the organization scheduler, 404s
 * every organization route and hides the mode switch for everyone; on again resumes without
 * backfilling what was missed, and only brings the mode switch back — nobody's shell moves into
 * company mode by it (state/company.tsx). A write that fails puts the switch back on the stored
 * value and names the reason on a line under it (a toast would leave the switch and the message
 * on separate surfaces). The auth context is refreshed afterwards because the shell reads the
 * flag from /api/me, not from this page. The mode is a beta; the line under the switch says so
 * wherever the switch stands. Turning it off asks first — it stops every organization on the
 * server at once — and the knob stays on until the answer is yes; turning it on does not ask.
 */
import { useEffect, useState } from "react";
import {
  ConfirmModal,
  SettingsGroup,
  SettingsSection,
  ToggleRow,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { writeCompanyMode } from "./company-mode-write";

export function CompanySection() {
  const { refresh } = useAuth();
  /** The last value the server confirmed; null until the settings load. */
  const [stored, setStored] = useState<boolean | null>(null);
  /** What the switch shows: the stored value, or the pending one while a write is in flight. */
  const [companyMode, setCompanyMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (cancelled) return;
        setStored(res.settings.companyMode);
        setCompanyMode(res.settings.companyMode);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    if (stored === null || busy) return;
    // Optimistic: the knob moves with the click, and only a failure moves it back.
    setCompanyMode(next);
    setError(undefined);
    setBusy(true);
    const result = await writeCompanyMode(next, stored, {
      put: api.adminPutSettings,
      describeError: apiErrorText,
    });
    if (result.status === "applied") {
      setStored(result.companyMode);
      setCompanyMode(result.companyMode);
      // The shell decides whether to draw the mode switch from /api/me; re-pull it so this
      // tab follows its own change without a reload.
      await refresh().catch(() => {});
    } else {
      setCompanyMode(result.revertTo);
      setError(result.error);
    }
    setBusy(false);
  };

  const hydrated = stored !== null;
  return (
    <SettingsSection>
      <div>
        <SettingsGroup>
          {/* The mode is a beta, and this switch signs a whole server up for it: the warning
              stands under it unconditionally, as the row's hint, rather than behind the page's
              "?", which is a click away and is read once. */}
          <ToggleRow
            label={S.settings.companyModeServer}
            hint={S.company.betaNotice}
            checked={companyMode}
            onChange={(next) => {
              if (next) void toggle(true);
              else setConfirmOff(true);
            }}
            disabled={!hydrated || busy}
          />
        </SettingsGroup>
        {/* The reason the switch went back, under the row it went back on. */}
        {error !== undefined && <p className={`mt-2 text-xs ${toneInk.danger}`}>{error}</p>}
      </div>
      <ConfirmModal
        open={confirmOff}
        title={S.settings.companyModeOffTitle}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => {
          setConfirmOff(false);
          void toggle(false);
        }}
        confirmLabel={S.settings.companyModeOff}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.settings.companyModeOffBody}</p>
      </ConfirmModal>
    </SettingsSection>
  );
}
