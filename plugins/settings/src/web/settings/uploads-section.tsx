import * as api from "@prismshadow/penguin-web/internal";
import { ApiError } from "@prismshadow/penguin-web/internal";
import { S } from "@prismshadow/penguin-web/internal";
import { apiErrorText } from "@prismshadow/penguin-web/internal";
import { SETTINGS_SCOPE } from "@prismshadow/penguin-web/internal";
import { useAuth } from "@prismshadow/penguin-web/internal";


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
        if (!cancelled) toastApiError(e);
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
        toastApiError(e);
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
