import {
  ConfirmModal,
  SettingsGroup,
  SettingsSection,
  ToggleRow,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { apiErrorText } from "@prismshadow/penguin-web/internal";
import { toneInk } from "@prismshadow/penguin-web/internal";
import { useAuth } from "@prismshadow/penguin-web/internal";

import { writeCompanyMode } from "./company-mode-write";
import { toastApiError } from "../../lib/toast-api-error";

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
        if (!cancelled) toastApiError(e);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const write = async (next: boolean) => {
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
  /** On applies at once; off stops every organization, so it runs only from its confirmation. */
  const switchOnCompanyMode = () => void write(true);
  const switchOffCompanyMode = () => void write(false);

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
              if (next) switchOnCompanyMode();
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
          switchOffCompanyMode();
        }}
        confirmLabel={S.settings.companyModeOff}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.settings.companyModeOffBody}</p>
      </ConfirmModal>
    </SettingsSection>
  );
}
