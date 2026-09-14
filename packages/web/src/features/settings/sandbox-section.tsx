/**
 * Sandbox options (admin only, server-global): the confinement every agent command spawns
 * under, drawn as the first card of the Settings dialog's Plugins page — what enforces it is a
 * plugin, so it sits with the plugins' own forms and saves the same way: nothing is written
 * until its Save, and Save applies to the next spawn without a restart.
 *
 * What enforces it is a backend, contributed by a plugin. With none mounted the page says so
 * and the modes stay reachable but honest: choosing one confines nothing until a backend for
 * this platform is installed, and pretending otherwise is the one thing a security control
 * must never do.
 */
import { useEffect, useState } from "react";
import type { SandboxSettingsResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/input";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";

type Mode = "read-only" | "workspace-write" | "danger-full-access";

export function SandboxSection() {
  const [server, setServer] = useState<SandboxSettingsResponse | null>(null);
  const [mode, setMode] = useState<Mode>("danger-full-access");
  const [noNetwork, setNoNetwork] = useState(false);
  const [maskPaths, setMaskPaths] = useState("");
  const [busy, setBusy] = useState(false);

  const adopt = (res: SandboxSettingsResponse) => {
    setServer(res);
    setMode(res.settings.mode as Mode);
    setNoNetwork(res.settings.network === "none");
    setMaskPaths((res.settings.maskPaths ?? []).join("\n"));
  };

  useEffect(() => {
    let cancelled = false;
    void api.adminGetSandbox().then(
      (res) => {
        if (!cancelled) adopt(res);
      },
      (e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const paths = maskPaths
    .split("\n")
    .map((p) => p.trim())
    .filter((p) => p !== "");

  const save = async () => {
    if (server === null || busy) return;
    const unchanged =
      mode === server.settings.mode &&
      noNetwork === (server.settings.network === "none") &&
      paths.join("\n") === (server.settings.maskPaths ?? []).join("\n");
    if (unchanged) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(true);
    try {
      adopt(
        await api.adminPutSandbox({
          mode,
          network: noNetwork ? "none" : null,
          maskPaths: paths,
        }),
      );
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const hydrated = server !== null;
  const confining = mode !== "danger-full-access";
  return (
    <section className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-800">
      <div>
        <p className="text-sm font-semibold">{S.settings.sandboxTitle}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{S.settings.sandboxInfo}</p>
      </div>
      <Select
        label={S.settings.sandboxMode}
        size="sm"
        value={mode}
        disabled={!hydrated}
        hint={S.settings.sandboxModeHint}
        onChange={(e) => setMode(e.target.value as Mode)}
      >
        <option value="danger-full-access">{S.settings.sandboxModeOff}</option>
        <option value="workspace-write">{S.settings.sandboxModeWorkspace}</option>
        <option value="read-only">{S.settings.sandboxModeReadOnly}</option>
      </Select>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{S.settings.sandboxNetwork}</span>
        <Switch checked={noNetwork} onChange={setNoNetwork} disabled={!hydrated || !confining} />
      </div>
      <Textarea
        label={S.settings.sandboxMaskPaths}
        rows={4}
        value={maskPaths}
        disabled={!hydrated || !confining}
        hint={S.settings.sandboxMaskPathsHint}
        onChange={(e) => setMaskPaths(e.target.value)}
      />
      {hydrated && (
        <div className="text-xs">
          {server.backends.length === 0 ? (
            <p className={`rounded-md px-3 py-2 ${toneStrip.attention}`}>
              {S.settings.sandboxNoBackend}
            </p>
          ) : (
            <p className="text-gray-500">
              {S.settings.sandboxBackends}:{" "}
              {server.backends.map((b) => `${b.name} (${b.dimensions.join(", ")})`).join(" · ")}
            </p>
          )}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={!hydrated || busy}
          onClick={() => void save()}
        >
          {S.common.save}
        </Button>
      </div>
    </section>
  );
}
