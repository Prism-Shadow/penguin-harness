import { useState } from "react";
import type { ModelRefDto, ToolModelKey } from "@prismshadow/penguin-server/api";
import {
  Button,
  FormPickerTrigger,
  Notice,
  PickerDialog,
  ProviderLogo,
  Spinner,
  useSaving,
} from "@prismshadow/penguin-ui";
import { sameModelRef } from "../../../lib/model-grouping";
import { S } from "../../../lib/strings";
import { useLocale } from "../../../state/locale";
import { useProjectCapabilities } from "../../../state/use-project-capabilities";
import { DictationPolishSettings } from "./dictation-polish-settings";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

const labelFor = (model: ModelRefDto) => `${model.modelId} · ${model.provider}`;

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
  const { settings, busy, error, reload, save } = useProjectCapabilities(projectId, null);
  const [picking, setPicking] = useState<ToolModelKey | null>(null);
  const [query, setQuery] = useState("");
  useSaving(busy, PROJECT_SETTINGS_SCOPE);
  if (error)
    return (
      <Notice tone="attention">
        {error}
        <Button size="xs" onClick={reload}>
          {S.common.retry}
        </Button>
      </Notice>
    );
  if (!settings) return <Spinner label={S.common.loading} />;
  if (!settings.available.length) return <p className="text-sm text-fg-muted">{S.voice.noTools}</p>;
  const active = settings.available.find(({ key }) => key === picking);
  const options = picking
    ? settings.candidates[picking].filter((model) =>
        labelFor(model).toLowerCase().includes(query.trim().toLowerCase()),
      )
    : [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">{S.voice.modelHelp(projectName)}</p>
      <div className="grid gap-x-5 gap-y-3 min-[52rem]:grid-cols-2">
        {settings.available.map(({ key, title }) => {
          const current = settings.bindings[key];
          const available = settings.candidates[key].length > 0;
          const text = current ? labelFor(current) : available ? S.voice.unbound : S.voice.noModels;
          return (
            <div key={key} className="min-w-0">
              <div className="mb-1 text-sm font-medium text-fg">{title[locale]}</div>
              <FormPickerTrigger
                label={text}
                muted={!current}
                ariaLabel={title[locale]}
                title={text}
                titleExtra
                leading={
                  current ? (
                    <ProviderLogo provider={current.provider} className="size-4 shrink-0" />
                  ) : undefined
                }
                disabled={!owner || busy || (!available && !current)}
                ariaHaspopup="dialog"
                expanded={picking === key}
                onClick={() => {
                  setQuery("");
                  setPicking(key);
                }}
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
      {picking && active && (
        <PickerDialog<ModelRefDto | null>
          open
          title={active.title[locale]}
          onClose={() => setPicking(null)}
          items={query.trim() ? options : [null, ...options]}
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder={S.models.searchPlaceholder}
          emptyText={S.models.noSearchResults}
          itemKey={(model) => JSON.stringify(model ? [model.provider, model.modelId] : null)}
          isCurrent={(model) =>
            model ? sameModelRef(model, settings.bindings[picking]) : !settings.bindings[picking]
          }
          onPick={(model) => {
            setPicking(null);
            if (
              model
                ? !sameModelRef(model, settings.bindings[picking])
                : Boolean(settings.bindings[picking])
            )
              void save({ bindings: { [picking]: model } });
          }}
          renderRow={(model) =>
            model ? (
              <>
                <ProviderLogo provider={model.provider} className="size-4 shrink-0" />
                <span className="min-w-0 truncate" data-tooltip={labelFor(model)}>
                  {labelFor(model)}
                </span>
              </>
            ) : (
              S.voice.unbound
            )
          }
        />
      )}
    </div>
  );
}
