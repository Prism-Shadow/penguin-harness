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
 * The two controls are a typed form (the settings commit model): Save is live only while a
 * value differs from the stored one and the box holds a whole number — a box left empty or
 * holding anything else is marked inline, with Save held, rather than refused after the click —
 * and Reset puts the stored values back. Leaving the page, or the dialog, with unsaved values
 * asks first (settings-dialog.tsx), and the dialog does not close while Save is in flight.
 * Saving takes effect immediately: a composer reads the policy from `/api/me`, which reads the
 * setting per request, so there is nothing to restart and nothing to warn about.
 */
import { useEffect, useState } from "react";
import type { ServerSettings } from "@prismshadow/penguin-server/api";
import {
  Button,
  Input,
  SettingsSection,
  Switch,
  toastError,
  toastSuccess,
  useFormDraft,
  useSaving,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { SETTINGS_SCOPE } from "../../lib/unsaved/scopes";
import { useAuth } from "../../state/auth";

/** The form as typed. Kept as a string: a number input that clears to NaN cannot be typed into. */
interface CompressionDraft {
  /** The compression switch, and the threshold box under it: same form, same draft. */
  compression: boolean;
  overMb: string;
}

/** A box's value as Save would send it: the whole number, or the text itself when it is not one. */
function limitOf(text: string): number | string {
  const trimmed = text.trim();
  const n = Number(trimmed);
  return trimmed !== "" && Number.isInteger(n) ? n : trimmed;
}

const compressionOf = (draft: CompressionDraft) => ({
  compression: draft.compression,
  overMb: limitOf(draft.overMb),
});

export function UploadsSection() {
  const { uploadPolicy, refresh } = useAuth();
  /** Stored settings as hydrated on mount (null until then). */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const stored = (next: ServerSettings | null): CompressionDraft =>
    next === null
      ? { compression: false, overMb: "" }
      : { compression: next.imageCompression, overMb: String(next.imageCompressionOverMb) };
  const form = useFormDraft(stored(settings), { scope: SETTINGS_SCOPE, normalize: compressionOf });
  /**
   * The server's `invalid_image_compression` (a threshold outside the range it owns). Cleared
   * by the next keystroke.
   */
  const [compressionRangeError, setCompressionRangeError] = useState<string | null>(null);
  /** Save is in flight, which holds the dialog's close until it answers. */
  const [busy, setBusy] = useState(false);
  useSaving(busy, SETTINGS_SCOPE);

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
  const compression = compressionOf(form.draft);
  const overBad = typeof compression.overMb !== "number";
  /** The compression box's inline error: its own shape, its own server code, its own field. */
  const compressionError =
    form.dirty && overBad ? S.errors.byCode.invalid_image_compression : compressionRangeError;

  const save = async () => {
    if (settings === null || busy || !form.dirty) return;
    if (typeof compression.overMb !== "number") return;
    setBusy(true);
    setCompressionRangeError(null);
    try {
      const res = await api.adminPutSettings({
        imageCompression: compression.compression,
        imageCompressionOverMb: compression.overMb,
      });
      adopt(res.settings);
      // The composer reads the policy from /api/me, so re-pull it: without this the tab that
      // just changed the threshold would keep applying the old one until the next reload.
      await refresh().catch(() => {});
      toastSuccess(S.common.saved);
    } catch (e) {
      if (e instanceof ApiError && e.code === "invalid_image_compression") {
        setCompressionRangeError(apiErrorText(e));
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
              setCompressionRangeError(null);
            }}
          >
            {S.common.reset}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!hydrated || !form.dirty || overBad || busy}
            onClick={() => void save()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{S.settings.imageCompression}</span>
        <Switch
          checked={form.draft.compression}
          onChange={(next) => form.patch({ compression: next })}
          disabled={!hydrated}
        />
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
        value={form.draft.overMb}
        // Editable while the switch is off — the threshold is what the switch turns on, and a
        // field that greys out on toggle would make setting the two in one pass awkward.
        disabled={!hydrated}
        {...(compressionError !== null ? { error: compressionError } : {})}
        onChange={(e) => {
          form.patch({ overMb: e.target.value });
          setCompressionRangeError(null);
        }}
      />
    </SettingsSection>
  );
}
