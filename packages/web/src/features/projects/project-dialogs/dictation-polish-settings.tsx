import { useId, useState } from "react";
import type { ToolModelSettings, ToolModelSettingsPatch } from "@prismshadow/penguin-server/api";
import {
  Button,
  Chevron,
  ICON_GAP,
  ICON_SIZE,
  SettingsGroup,
  Textarea,
  ToggleRow,
  useFormDraft,
  useSaving,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

/**
 * Dictation's polish, under the operation rows: the switch (it commits on click) with the text
 * generation model it uses as its hint — polishing shares that operation's model rather than
 * choosing one of its own — and the instructions, folded, which save with their own button. The
 * fold follows the disclosure pattern: a real button with `aria-expanded`, its panel kept in the
 * DOM and `hidden` while closed.
 */
export function DictationPolishSettings({
  settings,
  owner,
  busy,
  onSave,
}: {
  settings: ToolModelSettings;
  owner: boolean;
  busy: boolean;
  onSave: (patch: ToolModelSettingsPatch) => Promise<boolean>;
}) {
  const { enabled, prompt, defaultPrompt } = settings.voicePolish;
  const form = useFormDraft(prompt, { scope: PROJECT_SETTINGS_SCOPE });
  useSaving(busy, PROJECT_SETTINGS_SCOPE);
  const textModel = settings.bindings.t2t;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const restore = () => form.setDraft(defaultPrompt);
  const submit = async () => {
    const next = form.draft.trim();
    if (await onSave({ voicePolish: { prompt: next && next !== defaultPrompt ? next : null } })) {
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
            textModel
              ? S.voice.polishWith(textModel.modelId, textModel.provider)
              : S.voice.polishNeedsText
          }
          checked={enabled}
          disabled={!owner || busy || !textModel}
          onChange={(value) => void onSave({ voicePolish: { enabled: value } })}
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
