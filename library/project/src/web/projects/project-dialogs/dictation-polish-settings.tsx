import { useEffect, useId, useState } from "react";
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import {
  Button,
  Chevron,
  ICON_GAP,
  ICON_SIZE,
  SettingsGroup,
  Spinner,
  Textarea,
  ToggleRow,
  toastError,
  toastSuccess,
  useFormDraft,
  useSaving,
} from "@prismshadow/penguin-ui";
import {
  getVoicePolish,
  patchVoicePolish,
  type VoicePolishSettings,
  type VoicePolishUpdate,
  apiErrorText,
  S,
} from "@prismshadow/penguin-web/internal";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

/**
 * Dictation's polish, under the operation rows — the multimodal tools plugin's transcript editing
 * (`…/multimodal-tools/voice-polish/settings`): the switch (it commits on click) with the text
 * generation model it uses as its hint — polishing shares that binding's model rather than
 * choosing one of its own — and the instructions, folded, which save with their own button.
 * Read again when the bindings change (`refreshKey`), since the model in the hint is one of them.
 */
export function DictationPolishSettings({
  projectId,
  owner,
  refreshKey,
  labelOf,
}: {
  projectId: string;
  owner: boolean;
  refreshKey?: unknown;
  /** A model's name as the pickers above show it. */
  labelOf: (model: ModelRefDto) => string;
}) {
  const [settings, setSettings] = useState<VoicePolishSettings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const job = new AbortController();
    getVoicePolish(projectId, null, job.signal).then(setSettings, (e: unknown) => {
      if (!job.signal.aborted) toastError(apiErrorText(e));
    });
    return () => job.abort();
  }, [projectId, refreshKey]);
  const save = async (patch: VoicePolishUpdate): Promise<boolean> => {
    setBusy(true);
    try {
      setSettings(await patchVoicePolish(projectId, patch));
      return true;
    } catch (e) {
      toastError(apiErrorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!settings) return <Spinner label={S.common.loading} />;
  return (
    <PolishForm settings={settings} owner={owner} busy={busy} labelOf={labelOf} onSave={save} />
  );
}

/**
 * The form over loaded settings. The fold follows the disclosure pattern: a real button with
 * `aria-expanded`, its panel kept in the DOM and `hidden` while closed.
 */
function PolishForm({
  settings,
  owner,
  busy,
  labelOf,
  onSave,
}: {
  settings: VoicePolishSettings;
  owner: boolean;
  busy: boolean;
  labelOf: (model: ModelRefDto) => string;
  onSave: (patch: VoicePolishUpdate) => Promise<boolean>;
}) {
  const { enabled, prompt, defaultPrompt, model } = settings;
  const form = useFormDraft(prompt, { scope: PROJECT_SETTINGS_SCOPE });
  useSaving(busy, PROJECT_SETTINGS_SCOPE);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const restore = () => form.setDraft(defaultPrompt);
  const submit = async () => {
    const next = form.draft.trim();
    if (await onSave({ prompt: next && next !== defaultPrompt ? next : null })) {
      form.adopt(next || defaultPrompt);
      toastSuccess(S.common.saved);
    }
  };
  return (
    <div className="space-y-3">
      <SettingsGroup title={S.voice.dictation}>
        <ToggleRow
          label={S.voice.polish}
          hint={
            model ? S.voice.polishWith(labelOf(model), model.provider) : S.voice.polishNeedsText
          }
          checked={enabled}
          disabled={!owner || busy || (!model && !enabled)}
          onChange={(value) => void onSave({ enabled: value })}
        />
      </SettingsGroup>
      <div className="border-t border-line-muted pt-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={`flex items-center rounded-md py-1 text-xs font-medium text-fg-muted transition-colors duration-150 hover:text-fg ${ICON_GAP.row}`}
        >
          <Chevron open={open} size={ICON_SIZE.chevronDense} />
          {S.voice.prompt}
        </button>
        <div id={panelId} hidden={!open} className="space-y-3 pt-2">
          <Textarea
            aria-label={S.voice.prompt}
            rows={8}
            maxLength={8000}
            value={form.draft}
            readOnly={!owner}
            disabled={busy}
            onChange={(e) => form.setDraft(e.target.value)}
          />
          {owner && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || form.draft === defaultPrompt}
                onClick={restore}
              >
                {S.voice.restorePrompt}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!form.dirty || busy}
                onClick={() => void submit()}
              >
                {S.common.save}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
