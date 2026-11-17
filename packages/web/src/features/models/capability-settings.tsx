import { useEffect, useState } from "react";
import type { CapabilitySettings, ModelRefDto } from "@prismshadow/penguin-server/api";
import {
  Button,
  FieldHint,
  Modal,
  Notice,
  Select,
  Spinner,
  Switch,
  toastError,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import {
  capabilities,
  getCapabilities,
  updateCapabilities,
  type CapabilityPatch,
} from "../../api/project-capabilities";

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
  projectId,
  owner,
  onClose,
}: {
  projectId: string;
  owner: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<CapabilitySettings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const job = new AbortController();
    setError("");
    void getCapabilities(projectId, null, job.signal)
      .then((next) => {
        if (!job.signal.aborted) setSettings(next);
      })
      .catch((e) => {
        if (!job.signal.aborted) setError(apiErrorText(e));
      });
    return () => job.abort();
  }, [projectId, retry]);
  async function save(patch: CapabilityPatch) {
    if (!settings || busy || !owner) return;
    const previous = settings;
    const bindings = { ...settings.bindings };
    for (const key of capabilities) {
      const value = patch.bindings?.[key];
      if (value === null) delete bindings[key];
      else if (value) bindings[key] = value;
    }
    setSettings({
      ...settings,
      bindings,
      voicePolish: { ...settings.voicePolish, ...patch.voicePolish },
    });
    setBusy(true);
    setError("");
    try {
      setSettings(await updateCapabilities(projectId, patch));
    } catch (e) {
      setSettings(previous);
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title={S.voice.models}
      widthClass="sm:max-w-2xl"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">{S.voice.modelsHelp}</p>
        {error && (
          <Notice tone="attention">
            {error}
            {!settings && (
              <Button size="sm" onClick={() => setRetry((n) => n + 1)}>
                {S.common.retry}
              </Button>
            )}
          </Notice>
        )}
        {!settings && !error && <Spinner label={S.common.loading} />}
        {settings && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {capabilities.map((key) => (
                <div key={key}>
                  <ModelChoice
                    label={S.voice.capabilities[key]}
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
            <div className="space-y-3 border-t border-edge pt-4">
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
          </>
        )}
      </div>
    </Modal>
  );
}
