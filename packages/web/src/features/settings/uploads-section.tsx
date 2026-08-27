/**
 * Uploads (admin only, server-global), modelled on the proxy section beside it: a switch and a
 * number, written together by a single PUT to /api/admin/settings, so a rejected value writes
 * nothing.
 *
 * The bounds quoted under the field come from the server (`/api/me` uploadPolicy) rather than
 * from constants here — the range is the server's statement about where the setting stops
 * meaning anything, and a second copy of it in the browser would be a copy that goes stale. A
 * value outside it is refused with `invalid_image_compression` and rendered inline under the
 * field, the same way the proxy section handles a bad address.
 *
 * Saving takes effect immediately: a composer reads the policy from `/api/me`, which reads the
 * setting per request, so there is nothing to restart and nothing to warn about.
 */
import { useEffect, useState } from "react";
import type { ServerSettings } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useAuth } from "../../state/auth";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";

export function UploadsSection() {
  const { uploadPolicy, refresh } = useAuth();
  /** Stored settings as hydrated on mount (null until then) — the no-change baseline. */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [compression, setCompression] = useState(false);
  // Kept as a string: a number input that clears to NaN cannot be typed into (backspacing the
  // last digit would snap the field back to a value the user is in the middle of replacing).
  const [overMb, setOverMb] = useState("");
  /** Inline error under the threshold field: the local shape check's, or the server's verdict. */
  const [limitError, setLimitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Adopt server-side truth: the baseline and the drafts move together. */
  const adopt = (next: ServerSettings) => {
    setSettings(next);
    setCompression(next.imageCompression);
    setOverMb(String(next.imageCompressionOverMb));
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
    const parsed = Number(overMb.trim());
    // Shape-check locally so an empty or non-numeric field never becomes a NaN in the request
    // body; the RANGE is left to the server, which owns it (this form only reports its verdict).
    if (overMb.trim() === "" || !Number.isInteger(parsed)) {
      setLimitError(S.errors.byCode.invalid_image_compression);
      return;
    }
    if (compression === settings.imageCompression && parsed === settings.imageCompressionOverMb) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(true);
    setLimitError(null);
    try {
      const res = await api.adminPutSettings({
        imageCompression: compression,
        imageCompressionOverMb: parsed,
      });
      adopt(res.settings);
      // The composer reads the policy from /api/me, so re-pull it: without this the tab that
      // just changed the threshold would keep applying the old one until the next reload.
      await refresh().catch(() => {});
      toastSuccess(S.common.saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_image_compression") {
        setLimitError(apiErrorText(e));
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
        <span className="text-sm font-medium">{S.settings.imageCompression}</span>
        <Switch checked={compression} onChange={setCompression} disabled={!hydrated} />
      </div>
      <Input
        label={S.settings.imageCompressionOverMb}
        required
        size="sm"
        type="number"
        inputMode="numeric"
        min={uploadPolicy.imageCompressionMinMb}
        max={uploadPolicy.imageCompressionMaxMb}
        hint={S.settings.imageCompressionOverMbHint(
          uploadPolicy.imageCompressionMinMb,
          uploadPolicy.imageCompressionMaxMb,
        )}
        value={overMb}
        // Editable while the switch is off — the threshold is what the switch turns on, and a
        // field that greys out on toggle would make setting the two in one pass awkward.
        disabled={!hydrated}
        {...(limitError !== null ? { error: limitError } : {})}
        onChange={(e) => {
          setOverMb(e.target.value);
          if (limitError !== null) setLimitError(null);
        }}
      />
    </SectionShell>
  );
}
