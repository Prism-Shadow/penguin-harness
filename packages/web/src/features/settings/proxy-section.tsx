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
 *
 * The reachability test is the one thing here that is not part of the form: it asks the server
 * to measure its own outbound path to the four provider hosts and reports each one's outcome
 * and round trip. It therefore carries its own busy flag rather than borrowing Save's — a
 * measurement is not an unsaved edit, and it must neither block Save nor be blocked by it.
 *
 * What it measures is the SAVED configuration: only a PUT moves the server's outbound
 * dispatcher, so a typed-but-unsaved address is not in the path. Rather than disabling the
 * button whenever the form is dirty — which reads as a broken control while the user is still
 * deciding about an unrelated switch — the answer names the configuration it travelled, and a
 * save clears results that now describe a superseded one.
 */
import { useEffect, useState } from "react";
import type {
  ProxyProbeProvider,
  ProxyProbeResponse,
  ServerSettings,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";

/** Brand names: identical in every locale, so they are keyed off the server's provider id rather than doubled into both dictionaries. */
const PROVIDER_LABEL: Record<ProxyProbeProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

/** How the measured configuration reads: the saved address, or the two states that have none. */
function measuredLabel(result: ProxyProbeResponse): string {
  if (!result.proxyForApp) return S.settings.proxyProbeDirect;
  return result.proxyUrl ?? S.settings.proxyProbeEnvProxy;
}

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
  /** The last measurement, and its own busy flag — deliberately not Save's (see the header). */
  const [probe, setProbe] = useState<ProxyProbeResponse | null>(null);
  const [probing, setProbing] = useState(false);

  /** Adopt server-side truth: the baseline and the drafts move together. */
  const adopt = (next: ServerSettings) => {
    setSettings(next);
    setProxyForApp(next.proxyForApp);
    setProxyForAgent(next.proxyForAgent);
    setProxyUrl(next.proxyUrl ?? "");
    // Results describe the configuration they travelled; a save may have replaced it.
    setProbe(null);
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

  const runProbe = async () => {
    if (settings === null || probing) return;
    setProbing(true);
    try {
      // Every outcome, reachable or not, comes back inside the response; only the request
      // itself failing (a lost session, a dead server) lands here as a toast.
      setProbe(await api.adminProbeProxy());
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setProbing(false);
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
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{S.settings.proxyProbe}</span>
          <Button
            size="sm"
            disabled={!hydrated || probing}
            aria-busy={probing}
            onClick={() => void runProbe()}
          >
            {probing ? S.settings.proxyProbeRunning : S.settings.proxyProbeRun}
          </Button>
        </div>
        {probe !== null && (
          <>
            <ul className="space-y-1">
              {probe.probes.map((p) => (
                <li key={p.provider} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-gray-600 dark:text-gray-400">
                    {PROVIDER_LABEL[p.provider]}
                  </span>
                  {/* The outcome is spelled out in words; the tone only reinforces it. */}
                  <span
                    className={`tabular-nums ${p.outcome === "reachable" ? toneInk.success : toneInk.danger}`}
                  >
                    {p.outcome === "reachable"
                      ? S.settings.proxyProbeReachable(p.ms)
                      : S.settings.proxyProbeFailure[p.outcome]}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs break-all text-gray-500 dark:text-gray-400">
              {S.settings.proxyProbeMeasured(measuredLabel(probe))}
            </p>
          </>
        )}
      </div>
    </SectionShell>
  );
}
