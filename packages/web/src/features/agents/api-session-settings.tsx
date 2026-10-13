/** The owner's new-API-Session defaults, using the App's existing form pickers. */
import { useEffect, useState } from "react";
import type {
  AgentApiResponse,
  AgentApiSettings,
  AgentApiUpdateRequest,
  ModelsResponse,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  FieldLabel,
  Input,
  OptionMenu,
  RuledSection,
  useFormDraft,
  useSaving,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { useInstantSetting } from "../../lib/instant-setting";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { ModelCatalogSelect } from "../chat/model-select";
import { thinkingLevelOptionsFor } from "../chat/thinking-level";
import { WorkspaceSelect } from "../chat/workspace-select";

interface ApiSettingsProps {
  projectId: string;
  agentId: string;
  settings: AgentApiSettings;
  disabled: boolean;
  onSaved: (response: AgentApiResponse) => void;
  onBusy: (busy: boolean) => void;
}

function ApiConcurrencySettings({
  projectId,
  agentId,
  settings,
  disabled,
  onSaved,
  onBusy,
}: ApiSettingsProps) {
  const form = useFormDraft({ limit: String(settings.maxConcurrentRuns) });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useSaving(busy, form.scope);
  const limit = Number(form.draft.limit);
  const valid = form.draft.limit.trim() !== "" && Number.isSafeInteger(limit) && limit >= 1;
  const error = form.dirty && !valid ? S.agent.apiConcurrencyInvalid : saveError;
  const save = async () => {
    if (!valid || !form.dirty || disabled || busy) return;
    setBusy(true);
    onBusy(true);
    setSaveError(null);
    try {
      const response = await api.putAgentApi(projectId, agentId, { maxConcurrentRuns: limit });
      onSaved(response);
      form.adopt({ limit: String(response.api.maxConcurrentRuns) });
    } catch (e) {
      setSaveError(apiErrorText(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <RuledSection title={S.agent.apiRunLimits}>
      <form
        className="max-w-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          size="sm"
          type="number"
          min={1}
          step={1}
          label={S.agent.apiConcurrency}
          info={S.agent.apiConcurrencyHint}
          value={form.draft.limit}
          disabled={disabled || busy}
          error={error ?? undefined}
          onChange={(e) => {
            form.patch({ limit: e.target.value });
            setSaveError(null);
          }}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="primary"
            type="submit"
            loading={busy}
            disabled={disabled || !form.dirty || !valid}
          >
            {S.common.save}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || busy || !form.dirty}
            onClick={() => {
              form.reset();
              setSaveError(null);
            }}
          >
            {S.common.reset}
          </Button>
        </div>
      </form>
    </RuledSection>
  );
}

export function ApiSessionSettings({
  projectId,
  agentId,
  settings,
  disabled,
  onSaved,
  onBusy,
}: ApiSettingsProps) {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setModels(null);
    setLoadError(null);
    void api.getModels(projectId).then(
      (res) => {
        if (!cancelled) setModels(res);
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(apiErrorText(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const write = useInstantSetting<AgentApiUpdateRequest>({}, async (patch) => {
    onBusy(true);
    try {
      onSaved(await api.putAgentApi(projectId, agentId, patch));
    } finally {
      onBusy(false);
    }
  });
  const value = { ...settings, ...write.value };
  const locked = disabled || write.busy;
  return (
    <>
      <RuledSection title={S.agent.apiSessionSettings} info={S.agent.apiSessionSettingsHint}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <FieldLabel>{S.chat.model}</FieldLabel>
            <ModelCatalogSelect
              models={models?.models ?? []}
              value={value.model}
              {...(models?.defaultModel !== undefined ? { defaultModel: models.defaultModel } : {})}
              onChange={(model) => void write.set({ model })}
              disabled={locked || models === null}
              variant="form"
              emptyLabel={S.company.modelProjectDefault}
            />
            {loadError !== null && <p className={`mt-1 text-xs ${toneInk.danger}`}>{loadError}</p>}
            {value.model !== null && (
              <Button
                size="sm"
                variant="ghost"
                disabled={locked}
                onClick={() => void write.set({ model: null })}
              >
                {S.company.modelClear}
              </Button>
            )}
          </div>
          <div className="min-w-0">
            <OptionMenu
              label={S.chat.thinkingLevel}
              fullWidth
              size="sm"
              placeholder={S.agent.defaultValue}
              value={value.thinkingLevel ?? ""}
              disabled={locked}
              options={thinkingLevelOptionsFor(
                S.agent.thinkingLevelOptions,
                S.agent.thinkingLevelNoneKept,
                settings.thinkingLevel ?? undefined,
              )}
              onChange={(level) =>
                void write.set({
                  thinkingLevel: level as NonNullable<AgentApiSettings["thinkingLevel"]>,
                })
              }
            />
            {value.thinkingLevel !== null && (
              <Button
                size="sm"
                variant="ghost"
                disabled={locked}
                onClick={() => void write.set({ thinkingLevel: null })}
              >
                {S.common.reset}
              </Button>
            )}
          </div>
          <div className="min-w-0 md:col-span-2">
            <FieldLabel>{S.chat.workspace}</FieldLabel>
            <WorkspaceSelect
              projectId={projectId}
              agentId={agentId}
              workspace={value.workspace ?? ""}
              onChange={(workspace) => void write.set({ workspace: workspace || null })}
              variant="form"
              disabled={locked}
            />
          </div>
        </div>
      </RuledSection>
      <ApiConcurrencySettings
        projectId={projectId}
        agentId={agentId}
        settings={settings}
        disabled={locked}
        onSaved={onSaved}
        onBusy={onBusy}
      />
    </>
  );
}
