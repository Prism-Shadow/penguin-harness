import { useCallback, useEffect, useState } from "react";
import type { ModelRefDto, ModelsResponse } from "@prismshadow/penguin-server/api";
import {
  Button,
  Notice,
  PrefRow,
  SettingsGroup,
  Spinner,
  toastError,
  useSaving,
} from "@prismshadow/penguin-ui";
import { getModels } from "../../../api/endpoints";
import { MULTIMODAL_TOOLS_PACKAGE } from "../../../api/tool-types";
import { ModelCatalogSelect } from "../../model-picker";
import { putVisionModel } from "../../models";
import { apiErrorText } from "../../../lib/api-error";
import { sameModelRef } from "../../../lib/model-grouping";
import { S } from "../../../lib/strings";
import { useLocale } from "../../../state/locale";
import { useToolBindings } from "../../../state/use-tool-bindings";
import { DictationPolishSettings } from "./dictation-polish-settings";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

const modelKey = (model: ModelRefDto) => JSON.stringify([model.provider, model.modelId]);

/**
 * The Project's multimodal models: one ruled row per operation — its name, and the picker of the
 * configured models that can serve it. Image understanding comes first: it is the Project's
 * vision model, a core setting the plugins' tools share, so it is listed whether or not a plugin
 * is on. Then one row per tool binding the enabled plugins declare; their names and candidates
 * are the server's, so a plugin's new binding gets its row here unchanged. What the page is for
 * is the pane heading's "?".
 */
export function MultimodalModelsSection({
  projectId,
  owner,
}: {
  projectId: string;
  owner: boolean;
}) {
  const { locale } = useLocale();
  const tools = useToolBindings(projectId, null);
  const [table, setTable] = useState<ModelsResponse | null>(null);
  const [tableError, setTableError] = useState("");
  const [visionBusy, setVisionBusy] = useState(false);
  const loadTable = useCallback(() => {
    setTableError("");
    getModels(projectId, null).then(setTable, (e: unknown) => setTableError(apiErrorText(e)));
  }, [projectId]);
  useEffect(loadTable, [loadTable]);
  const busy = tools.busy || visionBusy;
  useSaving(busy, PROJECT_SETTINGS_SCOPE);

  const error = tools.error || tableError;
  const loadError = error && (
    <Notice tone="attention">
      {error}
      <Button
        size="xs"
        onClick={() => {
          tools.reload();
          loadTable();
        }}
      >
        {S.common.retry}
      </Button>
    </Notice>
  );
  if (!table || !tools.bindings) return loadError || <Spinner label={S.common.loading} />;

  const modelByKey = new Map(table.models.map((model) => [modelKey(model), model]));
  const visionChoices = table.models.filter((m) => m.vision !== false && m.chatEligible !== false);
  const chooseVision = async (model: ModelRefDto) => {
    if (sameModelRef(model, table.visionModel)) return;
    setVisionBusy(true);
    try {
      setTable(await putVisionModel(projectId, model));
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setVisionBusy(false);
    }
  };
  const dictation = tools.bindings.some(
    (b) => b.key === "s2t" && b.package === MULTIMODAL_TOOLS_PACKAGE,
  );
  return (
    <div className="space-y-6">
      {loadError}
      <SettingsGroup>
        <PrefRow label={S.voice.imageUnderstanding}>
          <span className="w-64 min-w-0">
            <ModelCatalogSelect
              variant="form"
              title={S.voice.imageUnderstanding}
              models={visionChoices}
              value={table.visionModel ?? null}
              emptyLabel={visionChoices.length ? S.voice.unbound : S.voice.noModels}
              disabled={!owner || busy}
              onChange={(model) => void chooseVision(model)}
            />
          </span>
        </PrefRow>
        {tools.bindings.map((binding) => {
          const title = binding.title[locale];
          const choices = binding.candidates.flatMap((ref) => modelByKey.get(modelKey(ref)) ?? []);
          const current = binding.model;
          return (
            <PrefRow key={binding.key} label={title}>
              <span className="w-64 min-w-0">
                <ModelCatalogSelect
                  variant="form"
                  purpose="tool"
                  title={title}
                  models={choices}
                  value={current ?? null}
                  emptyLabel={choices.length ? S.voice.unbound : S.voice.noModels}
                  disabled={!owner || busy}
                  onChange={(model) => {
                    if (!sameModelRef(model, current)) void tools.bind(binding.key, model);
                  }}
                  {...(current ? { onClear: () => void tools.bind(binding.key, null) } : {})}
                />
              </span>
            </PrefRow>
          );
        })}
      </SettingsGroup>
      {tools.bindings.length === 0 && <p className="text-sm text-fg-muted">{S.voice.noTools}</p>}
      {dictation && (
        <DictationPolishSettings projectId={projectId} owner={owner} refreshKey={tools.bindings} />
      )}
    </div>
  );
}
