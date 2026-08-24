/**
 * Proxy options (admin only, server-global). A form, not a live surface: two switches —
 * "Application uses the proxy" (the server's own outbound dispatcher) and "Agent environment
 * uses the proxy" (command subprocess environments) — share one proxy address, and nothing is
 * written until Save, which applies everything atomically via a single PUT. The server
 * validates and normalizes the address (bare "host:port" is stored as "http://host:port"); a
 * rejected address renders inline under the input and the atomic PUT writes nothing. Save with
 * no modifications sends no request and toasts "no changes"; a successful save takes effect
 * without a restart.
 *
 * Settings hydrate when the section mounts — which is every time it is navigated to — and the
 * controls and Save stay disabled until they arrive. The saved response is adopted as the new
 * baseline, including the address in the exact form the server stored, so the page reflects
 * what is on the server rather than what was typed at it.
 */
import { useEffect, useState } from "react";
import type { ServerSettings } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";

export function ProxySection() {
  /** Stored settings as hydrated on mount (null until then) — the no-change baseline. */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  // Form drafts; the pre-hydration values mirror the server defaults (on, on, empty).
  const [proxyForApp, setProxyForApp] = useState(true);
  const [proxyForAgent, setProxyForAgent] = useState(true);
  const [proxyUrl, setProxyUrl] = useState("");
  /** Inline error under the address input (the server's invalid_proxy_url rejection). */
  const [addressError, setAddressError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Adopt server-side truth: the baseline and the drafts move together. */
  const adopt = (next: ServerSettings) => {
    setSettings(next);
    setProxyForApp(next.proxyForApp);
    setProxyForAgent(next.proxyForAgent);
    setProxyUrl(next.proxyUrl ?? "");
  };

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (!cancelled) adopt(res.settings);
      })
      .catch((e: unknown) => {
        // Controls stay disabled; leaving and returning to the section retries the fetch.
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const res = await api.adminPutSettings({ proxyForApp, proxyForAgent, proxyUrl });
      adopt(res.settings);
      toastSuccess(S.common.saved);
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
    <SectionShell
      actions={
        <Button variant="primary" disabled={!hydrated || busy} onClick={() => void save()}>
          {S.common.save}
        </Button>
      }
    >
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
    </SectionShell>
  );
}
