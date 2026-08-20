/**
 * Upload limits (admin only, server-global), modelled on the proxy section beside it. Two
 * whole-MB numbers — the per-file attachment cap and the per-message total — written together
 * by a single PUT to /api/admin/settings, so a rejected value writes nothing.
 *
 * The bounds and the fixed limits quoted in the hint come from the server (`/api/me`
 * uploadLimits) rather than from constants here: the range is a statement about what the
 * server can survive, and a second copy of it in the browser would be a copy that goes stale.
 * A value outside it is refused by the server with `invalid_attachment_limit` and rendered
 * inline under the field, the same way the proxy section handles a bad address.
 *
 * Saving takes effect immediately — the attachment validators and the request body cap both
 * read the setting per request — so there is nothing to restart and nothing to warn about.
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
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { SectionShell } from "./section-shell";

export function UploadsSection() {
  const { uploadLimits, refresh } = useAuth();
  /** Stored settings as hydrated on mount (null until then) — the no-change baseline. */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  // Kept as strings: a number input that clears to NaN cannot be typed into (backspacing the
  // last digit would snap the field back to a value the user is in the middle of replacing).
  const [maxMb, setMaxMb] = useState("");
  const [totalMb, setTotalMb] = useState("");
  /** Inline error under whichever field the server rejected. */
  const [limitError, setLimitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Adopt server-side truth: the baseline and the drafts move together. */
  const adopt = (next: ServerSettings) => {
    setSettings(next);
    setMaxMb(String(next.attachmentMaxMb));
    setTotalMb(String(next.attachmentTotalMb));
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
    const parsedMax = Number(maxMb.trim());
    const parsedTotal = Number(totalMb.trim());
    // Shape-check locally so an empty or non-numeric field never becomes a NaN in the request
    // body; the RANGE is left to the server, which owns it (this form only reports its verdict).
    if (
      maxMb.trim() === "" ||
      totalMb.trim() === "" ||
      !Number.isInteger(parsedMax) ||
      !Number.isInteger(parsedTotal)
    ) {
      setLimitError(S.errors.byCode.invalid_attachment_limit);
      return;
    }
    if (parsedMax === settings.attachmentMaxMb && parsedTotal === settings.attachmentTotalMb) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setBusy(true);
    setLimitError(null);
    try {
      const res = await api.adminPutSettings({
        attachmentMaxMb: parsedMax,
        attachmentTotalMb: parsedTotal,
      });
      adopt(res.settings);
      // The composer reads the limits from /api/me, so re-pull them: without this the tab that
      // just raised the cap would keep refusing files at the old number until the next reload.
      await refresh().catch(() => {});
      toastSuccess(S.common.saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_attachment_limit") {
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
      title={S.settings.uploadLimitsTitle}
      actions={
        <Button variant="primary" disabled={!hydrated || busy} onClick={() => void save()}>
          {S.common.save}
        </Button>
      }
    >
      <Input
        label={S.settings.attachmentMaxMb}
        size="sm"
        type="number"
        inputMode="numeric"
        min={uploadLimits.attachmentLimitMinMb}
        max={uploadLimits.attachmentLimitMaxMb}
        value={maxMb}
        disabled={!hydrated}
        onChange={(e) => {
          setMaxMb(e.target.value);
          if (limitError !== null) setLimitError(null);
        }}
      />
      <Input
        label={S.settings.attachmentTotalMb}
        size="sm"
        type="number"
        inputMode="numeric"
        min={uploadLimits.attachmentLimitMinMb}
        max={uploadLimits.attachmentLimitMaxMb}
        value={totalMb}
        disabled={!hydrated}
        {...(limitError !== null ? { error: limitError } : {})}
        onChange={(e) => {
          setTotalMb(e.target.value);
          if (limitError !== null) setLimitError(null);
        }}
      />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {S.settings.uploadLimitsHint(
          uploadLimits.attachmentLimitMinMb,
          uploadLimits.attachmentLimitMaxMb,
          uploadLimits.attachmentMaxCount,
          uploadLimits.imageMaxMb,
        )}
      </p>
    </SectionShell>
  );
}
