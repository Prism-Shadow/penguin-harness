import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import {
  Button,
  Notice,
  PrefRow,
  SettingsGroup,
  Spinner,
  useSaving,
} from "@prismshadow/penguin-ui";
import { ModelCatalogSelect } from "../../model-picker";
import { sameModelRef } from "../../../lib/model-grouping";
import { S } from "../../../lib/strings";
import { useLocale } from "../../../state/locale";
import { useProjectCapabilities } from "../../../state/use-project-capabilities";
import { DictationPolishSettings } from "./dictation-polish-settings";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

const modelKey = (model: ModelRefDto) => JSON.stringify([model.provider, model.modelId]);

/**
 * The Project's multimodal models: one ruled row per operation an active plugin contributes —
 * its name, and the picker of the configured models that can serve it. What the page is for is
 * the pane heading's "?". The operations, their names and their candidates are the server's, so
 * a plugin's new operation gets its row here unchanged.
 */
export function MultimodalModelsSection({
  projectId,
  owner,
}: {
  projectId: string;
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
    <div className="space-y-6">
      {loadError}
      <SettingsGroup>
        {settings.available.map(({ key, title }) => {
          const current = settings.bindings[key];
          const choices = settings.candidates[key].flatMap(
            (ref) => modelByKey.get(modelKey(ref)) ?? [],
          );
          return (
            <PrefRow key={key} label={title[locale]}>
              <span className="w-64 min-w-0">
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
              </span>
            </PrefRow>
          );
        })}
      </SettingsGroup>
      {settings.available.some(({ key }) => key === "s2t") && (
        <DictationPolishSettings settings={settings} owner={owner} busy={busy} onSave={save} />
      )}
    </div>
  );
}
