/** The owner's new-API-Session defaults, using the App's existing form pickers. */
import { useEffect, useState } from "react";
import type {
  AgentApiResponse,
  AgentApiSettings,
  AgentApiUpdateRequest,
  ModelsResponse,
} from "@prismshadow/penguin-server/api";
import { Button, FieldLabel, OptionMenu, RuledSection } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { useInstantSetting } from "../../lib/instant-setting";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { ModelCatalogSelect } from "../chat/model-select";
import { thinkingLevelOptionsFor } from "../chat/thinking-level";
import { WorkspaceSelect } from "../chat/workspace-select";

export function ApiSessionSettings({
  projectId,
  agentId,
  settings,
  disabled,
  onSaved,
  onBusy,
}: {
  projectId: string;
  agentId: string;
  settings: AgentApiSettings;
  disabled: boolean;
  onSaved: (response: AgentApiResponse) => void;
  onBusy: (busy: boolean) => void;
}) {
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
  );
}
