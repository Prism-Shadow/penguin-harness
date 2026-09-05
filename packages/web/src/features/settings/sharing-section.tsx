/**
 * Sharing (admin only, server-global): the GitHub token the server publishes Agent packages
 * with. Write-only by design — the server reports whether one is stored, never the value —
 * so the form shows that state and takes a new token, or clears it. Reading a public gist
 * to install an Agent needs no token; this one is only for publishing.
 */
import { useEffect, useState } from "react";
import type { ServerSettings } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { SectionShell } from "./section-shell";

export function SharingSection() {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (!cancelled) setSettings(res.settings);
      })
      .catch((e: unknown) => {
        if (!cancelled) toastError(apiErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const write = async (value: string) => {
    if (settings === null || busy) return;
    setBusy(true);
    try {
      const res = await api.adminPutSettings({ githubToken: value });
      setSettings(res.settings);
      setToken("");
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const hydrated = settings !== null;
  const stored = settings?.githubTokenSet === true;
  return (
    <SectionShell
      actions={
        <>
          {stored && (
            <Button variant="danger" disabled={!hydrated || busy} onClick={() => void write("")}>
              {S.settings.githubTokenClear}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!hydrated || busy}
            onClick={() => {
              if (token.trim() === "") toastInfo(S.common.noChangesToSave);
              else void write(token.trim());
            }}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">{S.settings.sharingDesc}</p>
      <p className={`text-sm ${stored ? toneInk.success : "text-gray-500"}`}>
        {stored ? S.settings.githubTokenStored : S.settings.githubTokenMissing}
      </p>
      <Input
        label={S.settings.githubToken}
        size="sm"
        type="password"
        autoComplete="off"
        value={token}
        placeholder={stored ? S.settings.githubTokenReplace : "ghp_…"}
        hint={S.settings.githubTokenHint}
        disabled={!hydrated}
        onChange={(e) => setToken(e.target.value)}
      />
    </SectionShell>
  );
}
