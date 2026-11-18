import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { Button, FieldHint, Modal, Notice, Select, Spinner, Switch } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { useProjectCapabilities } from "../../state/use-project-capabilities";

function ModelChoice({
  label,
  value,
  rows,
  disabled,
  onChange,
}: {
  label: string;
  value: ModelRefDto | null | undefined;
  rows: readonly ModelRefDto[];
  disabled: boolean;
  onChange: (ref: ModelRefDto | null) => void;
}) {
  const options = [...rows];
  const matches = (a: ModelRefDto, b: ModelRefDto) =>
    a.provider === b.provider && a.modelId === b.modelId;
  if (value && !options.some((model) => matches(value, model))) options.push(value);
  const selected = value ? options.findIndex((model) => matches(value, model)) : -1;
  return (
    <Select
      label={label}
      value={String(selected)}
      disabled={disabled}
      size="sm"
      onChange={(e) => onChange(options[Number(e.target.value)] ?? null)}
    >
      <option value="-1">{S.voice.unbound}</option>
      {options.map((model, index) => (
        <option
          key={JSON.stringify([model.provider, model.modelId])}
          value={String(index)}
        >{`${model.modelId} · ${model.provider}`}</option>
      ))}
    </Select>
  );
}

export function CapabilityDialog({
  selection,
  locale,
  owner,
  onClose,
}: {
  selection: ReturnType<typeof useProjectCapabilities>;
  locale: "en" | "zh";
  owner: boolean;
  onClose: () => void;
}) {
  const { settings, error, busy, reload, save } = selection;
  return (
    <Modal open title={S.voice.models} widthClass="sm:max-w-2xl" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">{S.voice.modelsHelp}</p>
        {error && (
          <Notice tone="attention">
            {error}
            {!settings && (
              <Button size="sm" onClick={reload}>
                {S.common.retry}
              </Button>
            )}
          </Notice>
        )}
        {!settings && !error && <Spinner label={S.common.loading} />}
        {settings && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {settings.available.map(({ key, title }) => (
                <div key={key}>
                  <ModelChoice
                    label={title[locale]}
                    value={settings.bindings[key]}
                    rows={settings.candidates[key]}
                    disabled={
                      busy ||
                      !owner ||
                      (!settings.candidates[key].length && !settings.bindings[key])
                    }
                    onChange={(model) => void save({ bindings: { [key]: model } })}
                  />
                  {!settings.candidates[key].length && (
                    <FieldHint>{S.voice.noCandidates}</FieldHint>
                  )}
                </div>
              ))}
            </div>
            {settings.available.some(({ key }) => key === "stt") && (
              <div className="space-y-3 border-t border-line-muted pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-fg">{S.voice.polish}</p>
                    <p className="text-xs text-fg-muted">{S.voice.polishHelp}</p>
                  </div>
                  <Switch
                    aria-label={S.voice.polish}
                    checked={settings.voicePolish.enabled}
                    disabled={busy || !owner || !settings.voicePolish.model}
                    onChange={(enabled) => void save({ voicePolish: { enabled } })}
                  />
                </div>
                <ModelChoice
                  label={S.voice.polishModel}
                  rows={settings.candidates.chat}
                  value={settings.voicePolish.model}
                  disabled={busy || !owner}
                  onChange={(model) =>
                    void save({ voicePolish: model ? { model } : { model: null, enabled: false } })
                  }
                />
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
