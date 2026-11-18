import type { ToolModelSettings, ToolModelSettingsPatch } from "@prismshadow/penguin-server/api";
import {
  Button,
  CollapsibleSection,
  Switch,
  Textarea,
  useFormDraft,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

export function DictationPolishSettings({
  project,
  settings,
  owner,
  busy,
  onSave,
}: {
  project: string;
  settings: ToolModelSettings;
  owner: boolean;
  busy: boolean;
  onSave: (patch: ToolModelSettingsPatch) => Promise<boolean>;
}) {
  const { enabled, prompt, defaultPrompt } = settings.voicePolish;
  const form = useFormDraft({ enabled, prompt }, { scope: PROJECT_SETTINGS_SCOPE });
  const textModel = settings.bindings.t2t;
  const restore = () => form.patch({ prompt: defaultPrompt });
  const submit = async () => {
    const next = form.draft.prompt.trim();
    const saved = await onSave({
      voicePolish: {
        ...(form.draft.enabled !== enabled ? { enabled: form.draft.enabled } : {}),
        ...(form.draft.prompt !== prompt
          ? { prompt: next && next !== defaultPrompt ? next : null }
          : {}),
      },
    });
    if (saved) {
      form.adopt({ enabled: form.draft.enabled, prompt: next || defaultPrompt });
      toastSuccess(S.common.saved);
    }
  };
  return (
    <CollapsibleSection
      title={S.voice.polish}
      defaultOpen={false}
      meta={settings.voicePolish.enabled ? S.voice.polishOn : undefined}
    >
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-fg">{S.voice.enableIn(project)}</p>
            <p className="break-words text-xs text-fg-muted">
              {textModel
                ? S.voice.polishWith(textModel.modelId, textModel.provider)
                : S.voice.polishNeedsText}
            </p>
          </div>
          <Switch
            checked={form.draft.enabled}
            disabled={!owner || busy || !textModel}
            aria-label={S.voice.polish}
            onChange={(value) => form.patch({ enabled: value })}
          />
        </div>
        <Textarea
          label={S.voice.prompt}
          rows={8}
          maxLength={8000}
          value={form.draft.prompt}
          readOnly={!owner}
          disabled={busy}
          onChange={(e) => form.patch({ prompt: e.target.value })}
        />
        {owner && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || form.draft.prompt === defaultPrompt}
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
    </CollapsibleSection>
  );
}
