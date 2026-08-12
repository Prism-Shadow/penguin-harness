/**
 * Admin proxy options dialog (server-global), opened from
 * the sidebar user menu. A form, not a live surface: two switches — "Application uses
 * the proxy" (the server's own outbound dispatcher) and "Agent environment uses the
 * proxy" (command subprocess environments) — share one proxy address, and nothing is
 * written until Save, which applies everything atomically via a single PUT. The server
 * validates and normalizes the address (bare "host:port" is stored as
 * "http://host:port"); a rejected address renders inline under the input (models-dialog
 * convention) and the atomic PUT writes nothing. Save with no modifications sends no
 * request and toasts "no changes" (the app's form convention); success
 * toasts and closes. Settings hydrate fresh on every open; the controls and Save stay
 * disabled until they arrive, and Cancel/Esc discards edits.
 */
import { useEffect, useState } from "react";
import type { ServerSettings } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";
import { Switch } from "../ui/switch";
import { toastError, toastInfo, toastSuccess } from "../ui/toast";

export function ProxySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  /** Stored settings as hydrated on open (null until then) — the no-change baseline. */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  // Form drafts; the pre-hydration values mirror the server defaults (on, on, empty).
  const [proxyForApp, setProxyForApp] = useState(true);
  const [proxyForAgent, setProxyForAgent] = useState(true);
  const [proxyUrl, setProxyUrl] = useState("");
  /** Inline error under the address input (the server's invalid_proxy_url rejection). */
  const [addressError, setAddressError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSettings(null);
    setAddressError(null);
    setBusy(false);
    void api
      .adminGetSettings()
      .then((res) => {
        if (cancelled) return;
        setSettings(res.settings);
        setProxyForApp(res.settings.proxyForApp);
        setProxyForAgent(res.settings.proxyForAgent);
        setProxyUrl(res.settings.proxyUrl ?? "");
      })
      .catch((e: unknown) => {
        // Controls stay disabled; closing and reopening retries the fetch.
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const save = async () => {
    if (settings === null || busy) return;
    const unchanged =
      proxyForApp === settings.proxyForApp &&
      proxyForAgent === settings.proxyForAgent &&
      proxyUrl.trim() === (settings.proxyUrl ?? "");
    if (unchanged) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(true);
    setAddressError(null);
    try {
      await api.adminPutSettings({ proxyForApp, proxyForAgent, proxyUrl });
      toastSuccess(S.common.saved);
      onClose();
    } catch (e) {
      // The address is the only validated field: its rejection renders inline;
      // anything else (auth, network) is a generic failure toast.
      if (e instanceof ApiError && e.code === "invalid_proxy_url") {
        setAddressError(apiErrorText(e));
      } else {
        toastError(apiErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const hydrated = settings !== null;
  return (
    <Modal
      open={open}
      title={S.settings.proxyDialogTitle}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant="primary" disabled={!hydrated || busy} onClick={() => void save()}>
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{S.settings.proxyForApp}</span>
          <Switch checked={proxyForApp} onChange={setProxyForApp} disabled={!hydrated} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{S.settings.proxyForAgent}</span>
          <Switch checked={proxyForAgent} onChange={setProxyForAgent} disabled={!hydrated} />
        </div>
        <Input
          label={S.settings.proxyAddress}
          size="sm"
          value={proxyUrl}
          placeholder={S.settings.proxyAddressPlaceholder}
          disabled={!hydrated}
          {...(addressError !== null ? { error: addressError } : {})}
          onChange={(e) => {
            setProxyUrl(e.target.value);
            if (addressError !== null) setAddressError(null);
          }}
        />
      </div>
    </Modal>
  );
}
