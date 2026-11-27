import { useEffect, useState } from "react";
import { DEFAULT_BROWSER_LIMIT, DEFAULT_TERMINAL_LIMIT } from "../resource-limits";
import type { ServerSettings } from "@prismshadow/penguin-server/api";
import {
  Button,
  Input,
  SettingsSection,
  useFormDraft,
  useSaving,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import {
  adminGetSettings,
  adminPutSettings,
  S,
  toastApiError,
} from "@prismshadow/penguin-web/internal";
import { SETTINGS_SCOPE } from "./lib/unsaved/scopes";

const fields = ["terminalMaxOpen", "browserMaxOpen"] as const;
type Limits = Pick<ServerSettings, (typeof fields)[number]>;
const defaults: Limits = {
  terminalMaxOpen: DEFAULT_TERMINAL_LIMIT,
  browserMaxOpen: DEFAULT_BROWSER_LIMIT,
};

function asText(settings: Limits | null) {
  return {
    terminalMaxOpen: settings ? String(settings.terminalMaxOpen) : "",
    browserMaxOpen: settings ? String(settings.browserMaxOpen) : "",
  };
}

function positiveInteger(value: string) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export function ResourceLimitsSection() {
  const [stored, setStored] = useState<Limits | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const form = useFormDraft(asText(stored), {
    scope: SETTINGS_SCOPE,
    normalize: (draft) => ({
      terminalMaxOpen: positiveInteger(draft.terminalMaxOpen) ?? draft.terminalMaxOpen,
      browserMaxOpen: positiveInteger(draft.browserMaxOpen) ?? draft.browserMaxOpen,
    }),
  });
  useSaving(busy, SETTINGS_SCOPE);
  function adopt(settings: Limits) {
    setStored(settings);
    form.adopt(asText(settings));
  }
  useEffect(() => {
    let current = true;
    setFailed(false);
    void adminGetSettings()
      .then(({ settings }) => {
        if (current) adopt(settings);
      })
      .catch((err: unknown) => {
        if (current) {
          setFailed(true);
          toastApiError(err);
        }
      });
    return () => {
      current = false;
    };
  }, [retry]);
  const valid = fields.every((field) => positiveInteger(form.draft[field]) !== null);
  async function save() {
    if (!stored || !valid || busy || !form.dirty) return;
    const changes: Partial<Limits> = {};
    for (const field of fields) {
      const value = positiveInteger(form.draft[field]);
      if (value !== null && value !== stored[field]) changes[field] = value;
    }
    setBusy(true);
    try {
      const { settings } = await adminPutSettings(changes);
      adopt(settings);
      toastSuccess(S.common.saved);
    } catch (err) {
      toastApiError(err);
    } finally {
      setBusy(false);
    }
  }
  const words = S.settings.resourceLimits;
  return (
    <SettingsSection
      actions={
        <>
          {failed && (
            <Button size="sm" onClick={() => setRetry((attempt) => attempt + 1)}>
              {S.common.retry}
            </Button>
          )}
          <Button
            size="sm"
            disabled={
              !stored ||
              busy ||
              fields.every((field) => positiveInteger(form.draft[field]) === defaults[field])
            }
            onClick={() => form.patch(asText(defaults))}
          >
            {words.restore}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!stored || !valid || !form.dirty || busy}
            onClick={() => void save()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      {fields.map((field) => (
        <Input
          key={field}
          label={words[field]}
          size="sm"
          type="number"
          inputMode="numeric"
          required
          min={1}
          step={1}
          disabled={!stored || busy}
          value={form.draft[field]}
          {...(stored && positiveInteger(form.draft[field]) === null
            ? { error: words.invalid }
            : {})}
          onChange={(event) => form.patch({ [field]: event.target.value })}
        />
      ))}
    </SettingsSection>
  );
}
