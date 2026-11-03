/**
 * Settings › Server › Chrome extension (admin only): "Allow Chrome extension connections", the
 * server-wide switch over the agents driving users' own Chromes (`browserExtensionsEnabled` in
 * /api/admin/settings, on by default).
 *
 * The switch applies on the flip, like company mode's. Turning it on writes at once. Turning it
 * off asks first, in the danger tone — every user's extension disconnects at once and no agent on
 * the server can use a Chrome — and the knob stays on until the answer is yes. Pairings survive
 * either way. A write that fails puts the knob back on the stored value and says why under it.
 */
import { useEffect, useState } from "react";
import type { ServerSettingsResponse } from "@prismshadow/penguin-server/api";
import {
  ConfirmModal,
  SettingsGroup,
  SettingsSection,
  ToggleRow,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";

/** Turns the switch off on the server. Reached only through the confirm. */
const switchOffExtensions = (): Promise<ServerSettingsResponse> =>
  api.adminPutSettings({ browserExtensionsEnabled: false });

/**
 * The question before the switch goes off: the danger tone and what follows. Answered yes, it
 * says the write began, writes the switch off, and hands the outcome on: the stored value, or
 * the failure.
 */
export function ExtensionsOffConfirm({
  open,
  onClose,
  onWriting,
  onSettled,
}: {
  open: boolean;
  onClose: () => void;
  onWriting: () => void;
  onSettled: (outcome: { enabled: boolean } | { error: unknown }) => void;
}) {
  return (
    <ConfirmModal
      open={open}
      title={S.browserSettings.offTitle}
      onClose={onClose}
      onConfirm={() => {
        onClose();
        onWriting();
        switchOffExtensions().then(
          (res) => onSettled({ enabled: res.settings.browserExtensionsEnabled }),
          (error: unknown) => onSettled({ error }),
        );
      }}
      confirmLabel={S.browserSettings.off}
      cancelLabel={S.common.cancel}
    >
      <p className="text-sm text-fg-muted">{S.browserSettings.offBody}</p>
    </ConfirmModal>
  );
}

export function ChromeExtensionSection() {
  /** The last value the server confirmed; null until the settings load. */
  const [stored, setStored] = useState<boolean | null>(null);
  /** What the switch shows: the stored value, or the pending one while a write is in flight. */
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmOff, setConfirmOff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (cancelled) return;
        setStored(res.settings.browserExtensionsEnabled);
        setEnabled(res.settings.browserExtensionsEnabled);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Where a write landed: the stored value, or back to the last one with the reason. */
  const settle = (outcome: { enabled: boolean } | { error: unknown }, previous: boolean) => {
    if ("enabled" in outcome) {
      setStored(outcome.enabled);
      setEnabled(outcome.enabled);
    } else {
      setEnabled(previous);
      setError(apiErrorText(outcome.error));
    }
    setBusy(false);
  };

  const turnOn = () => {
    if (stored === null || busy) return;
    setEnabled(true);
    setError(undefined);
    setBusy(true);
    api.adminPutSettings({ browserExtensionsEnabled: true }).then(
      (res) => settle({ enabled: res.settings.browserExtensionsEnabled }, stored),
      (err: unknown) => settle({ error: err }, stored),
    );
  };

  return (
    <SettingsSection>
      <div>
        <SettingsGroup>
          <ToggleRow
            label={S.browserSettings.allow}
            checked={enabled}
            onChange={(next) => {
              if (next) turnOn();
              else setConfirmOff(true);
            }}
            disabled={stored === null || busy}
          />
        </SettingsGroup>
        {error !== undefined && <p className={`mt-2 text-xs ${toneInk.danger}`}>{error}</p>}
      </div>
      <ExtensionsOffConfirm
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onWriting={() => {
          setEnabled(false);
          setError(undefined);
          setBusy(true);
        }}
        onSettled={(outcome) => settle(outcome, stored ?? true)}
      />
    </SettingsSection>
  );
}
