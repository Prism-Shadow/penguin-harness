/**
 * Upload limits (admin only, server-global), modelled on the proxy section beside it. Two
 * whole-MB numbers — the per-file attachment cap and the per-message total — written together
 * by a single PUT to /api/admin/settings, so a rejected value writes nothing.
 *
 * The bounds quoted under each field, and the fixed limits the page's "?" names, come from the
 * server (`/api/me` uploadLimits) rather than from constants here: the range is a statement
 * about what the server can survive, and a second copy of it in the browser would be a copy
 * that goes stale. A value outside it is refused by the server with `invalid_attachment_limit`
 * and rendered inline under the field, the same way the proxy section handles a bad address.
 *
 * The two boxes are a typed form (the settings commit model): Save is live only while a value
 * differs from the stored one and both are whole numbers — a box left empty or holding anything
 * else is marked inline, with Save held, rather than refused after the click — and Reset puts
 * the stored values back. Leaving the page, or the dialog, with unsaved values asks first
 * (settings-dialog.tsx). Saving takes effect immediately — the attachment validators and the
 * request body cap both read the setting per request — so there is nothing to restart and
 * nothing to warn about.
 */
import { useEffect, useState } from "react";
import type { ServerSettings } from "@prismshadow/penguin-server/api";
import {
  Button,
  Input,
  SettingsSection,
  toastError,
  toastSuccess,
  useFormDraft,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SETTINGS_SCOPE } from "../../lib/unsaved/scopes";
import { useAuth } from "../../state/auth";

/** The two boxes as typed. Kept as strings: a number input that clears to NaN cannot be typed into. */
interface LimitsDraft {
  max: string;
  total: string;
}

/** A box's value as Save would send it: the whole number, or the text itself when it is not one. */
function limitOf(text: string): number | string {
  const trimmed = text.trim();
  const n = Number(trimmed);
  return trimmed !== "" && Number.isInteger(n) ? n : trimmed;
}

const limitsOf = (draft: LimitsDraft) => ({ max: limitOf(draft.max), total: limitOf(draft.total) });

export function UploadsSection() {
  const { uploadLimits, refresh } = useAuth();
  /** Stored settings as hydrated on mount (null until then). */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const stored = (next: ServerSettings | null): LimitsDraft =>
    next === null
      ? { max: "", total: "" }
      : { max: String(next.attachmentMaxMb), total: String(next.attachmentTotalMb) };
  const form = useFormDraft(stored(settings), { scope: SETTINGS_SCOPE, normalize: limitsOf });
  /**
   * The server's `invalid_attachment_limit` (a value outside the range it owns): a statement
   * about the pair, so it marks both boxes. Cleared by the next keystroke.
   */
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const adopt = (next: ServerSettings) => {
    setSettings(next);
    form.adopt(stored(next));
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

  // The shape is checked here, so an empty or non-numeric box never becomes a NaN in the request
  // body; the RANGE is left to the server, which owns it (this form only reports its verdict).
  const limits = limitsOf(form.draft);
  const maxBad = typeof limits.max !== "number";
  const totalBad = typeof limits.total !== "number";
  const shapeError = S.errors.byCode.invalid_attachment_limit;
  // Only an edit is judged: the boxes are empty, and clean, until the stored values arrive.
  const limitError =
    form.dirty && (maxBad || totalBad)
      ? { text: shapeError, max: maxBad, total: totalBad }
      : rangeError !== null
        ? { text: rangeError, max: true, total: true }
        : null;

  const save = async () => {
    if (settings === null || busy || !form.dirty) return;
    if (typeof limits.max !== "number" || typeof limits.total !== "number") return;
    setBusy(true);
    setRangeError(null);
    try {
      const res = await api.adminPutSettings({
        attachmentMaxMb: limits.max,
        attachmentTotalMb: limits.total,
      });
      adopt(res.settings);
      // The composer reads the limits from /api/me, so re-pull them: without this the tab that
      // just raised the cap would keep refusing files at the old number until the next reload.
      await refresh().catch(() => {});
      toastSuccess(S.common.saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_attachment_limit") {
        setRangeError(apiErrorText(e));
      } else {
        toastError(apiErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const hydrated = settings !== null;
  return (
    <SettingsSection
      actions={
        <>
          <Button
            size="sm"
            disabled={!form.dirty || busy}
            onClick={() => {
              form.reset();
              setRangeError(null);
            }}
          >
            {S.common.reset}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!hydrated || !form.dirty || maxBad || totalBad || busy}
            onClick={() => void save()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <Input
        label={S.settings.attachmentMaxMb}
        required
        size="sm"
        type="number"
        inputMode="numeric"
        min={uploadLimits.attachmentLimitMinMb}
        max={uploadLimits.attachmentLimitMaxMb}
        hint={S.settings.attachmentMaxMbHint(
          uploadLimits.attachmentLimitMinMb,
          uploadLimits.attachmentLimitMaxMb,
        )}
        value={form.draft.max}
        disabled={!hydrated}
        {...(limitError?.max === true ? { error: limitError.text } : {})}
        onChange={(e) => {
          form.patch({ max: e.target.value });
          setRangeError(null);
        }}
      />
      <Input
        label={S.settings.attachmentTotalMb}
        required
        size="sm"
        type="number"
        inputMode="numeric"
        min={uploadLimits.attachmentLimitMinMb}
        max={uploadLimits.attachmentLimitMaxMb}
        hint={S.settings.attachmentTotalMbHint(
          uploadLimits.attachmentLimitMinMb,
          uploadLimits.attachmentLimitMaxMb,
        )}
        value={form.draft.total}
        disabled={!hydrated}
        {...(limitError?.total === true
          ? // The message renders once, on the first field at fault; a second faulty field is
            // marked without repeating the sentence.
            limitError.max
            ? { invalid: true }
            : { error: limitError.text }
          : {})}
        onChange={(e) => {
          form.patch({ total: e.target.value });
          setRangeError(null);
        }}
      />
    </SettingsSection>
  );
}
