import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { Button, Notice, Spinner, useSaving } from "@prismshadow/penguin-ui";
import { ModelCatalogSelect } from "../../model-picker";
import { sameModelRef } from "../../../lib/model-grouping";
import { S } from "../../../lib/strings";
import { useLocale } from "../../../state/locale";
import { useProjectCapabilities } from "../../../state/use-project-capabilities";
import { DictationPolishSettings } from "./dictation-polish-settings";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

const modelKey = (model: ModelRefDto) => JSON.stringify([model.provider, model.modelId]);

export function MultimodalModelsSection({
  projectId,
  projectName,
  owner,
}: {
  projectId: string;
  projectName: string;
  owner: boolean;
}) {
  const { locale } = useLocale();
  const { settings, models, busy, error, reload, save } = useProjectCapabilities(projectId, null, {
    includeModels: true,
  });
  useSaving(busy, PROJECT_SETTINGS_SCOPE);
  const loadError = error && (
    <Notice tone="attention">
      {error}
      <Button size="xs" onClick={reload}>
        {S.common.retry}
      </Button>
    </Notice>
  );
  if (!settings) return loadError || <Spinner label={S.common.loading} />;
  if (!settings.available.length)
    return loadError || <p className="text-sm text-fg-muted">{S.voice.noTools}</p>;
  const modelByKey = new Map(models.map((model) => [modelKey(model), model]));
  return (
    <div className="space-y-4">
      {loadError}
      <p className="text-sm text-fg-muted">{S.voice.modelHelp(projectName)}</p>
      <div className="grid gap-x-4 gap-y-3 min-[52rem]:grid-cols-2">
        {settings.available.map(({ key, title }) => {
          const current = settings.bindings[key];
          const choices = settings.candidates[key].flatMap(
            (ref) => modelByKey.get(modelKey(ref)) ?? [],
          );
          return (
            <div key={key} className="min-w-0">
              <div className="mb-1 text-sm font-medium text-fg">{title[locale]}</div>
              <ModelCatalogSelect
                variant="form"
                purpose="tool"
                title={title[locale]}
                models={choices}
                value={current ?? null}
                emptyLabel={choices.length ? S.voice.unbound : S.voice.noModels}
                disabled={!owner || busy}
                onChange={(model) => {
                  if (!sameModelRef(model, current)) void save({ bindings: { [key]: model } });
                }}
                {...(current ? { onClear: () => void save({ bindings: { [key]: null } }) } : {})}
              />
            </div>
          );
        })}
      </div>
      {settings.available.some(({ key }) => key === "s2t") && (
        <DictationPolishSettings
          project={projectName}
          settings={settings}
          owner={owner}
          busy={busy}
          onSave={save}
        />
      )}
    </div>
  );
}
