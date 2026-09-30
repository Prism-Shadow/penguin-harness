/**
 * The model picker bound to the Project's model catalog: the UI package's `ModelSelect` and
 * `ModelMenuList` draw it (trigger, search, rows, badges, the "show all" row); this module decides
 * which models they list and in what order, and speaks the app's words. The chat composer, the
 * Project settings' new-chat defaults, the schedule form, the organization dialogs and the
 * benchmark dialog all pick a model through it.
 *
 * - ModelCatalogMenu: the candidate panel, shared by the draft composer's dropdown and the
 *   in-session `/model` switch picker;
 * - ModelCatalogSelect: the trigger with the panel behind it, as the composer's pill or a dialog's
 *   form field.
 *
 * The list mirrors the model library page (visibleChatModels): the page's dragged group order,
 * a search over id / display name / provider name, and by default only the models with an API
 * key (hasConfiguredKey — a stored masked key or a masked env fallback, the model page's own
 * standard; `envKey` is merely the NAME of a fallback env var and doesn't count on its own), with
 * the selected and the default model always listed even without one. The panel's bottom row
 * reveals the rest in place; when no model has a key at all, everything is listed directly.
 */
import { useMemo } from "react";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import { ModelMenuList, ModelSelect } from "@prismshadow/penguin-ui";
import type { ModelMenuLabels, ModelMenuQuery, ModelOption } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  hasConfiguredKey,
  isFreeModel,
  sameModelRef,
  visibleChatModels,
} from "../models/model-grouping";
import { loadModelGroupOrder } from "../models/model-group-order";
import { useProject } from "../../state/project";

/**
 * Display label for a model: the display name, or falls back to the upstream id (model_id is
 * the raw field, no prefix parsing). Blank counts as absent — a name the user cleared is sent
 * as the empty string, which must read as the id rather than as an empty label.
 */
export function modelLabel(m: ModelInfo): string {
  return m.displayName?.trim() || m.modelId;
}

/** The key a model goes by in the panel: its (provider, model id) pair. */
function modelKey(ref: ModelRefDto): string {
  return `${ref.provider}:${ref.modelId}`;
}

/** A catalog model as the panel draws it, carrying the model it stands for. */
interface ModelRow extends ModelOption {
  model: ModelInfo;
}

/** The panel's words, read at render time: `S` is a live binding swapped on locale change. */
function menuLabels(): ModelMenuLabels {
  return {
    search: S.models.searchPlaceholder,
    empty: S.models.noSearchResults,
    free: S.models.freeBadge,
    noKey: S.models.noKey,
    isDefault: S.models.default,
    showHidden: S.models.showModelsWithoutKey,
  };
}

/**
 * The panel's answer for a search and a reveal state: the models to list, in the library's
 * order, and how many the configured-key filter holds back under that search.
 *
 * The model page's dragged group order is read here rather than threaded through every call
 * site, once per mount (every host renders the panel only while it is open, so opening it
 * remounts this) — an order changed on that page, in this tab or another, is picked up on the
 * next open without a reload. Not on every render: the search box re-renders the panel on each
 * keystroke, and the Project context does so for reasons of its own.
 */
function useModelMenuQuery(
  models: ModelInfo[],
  value: ModelRefDto | null,
  defaultModel: ModelRefDto | undefined,
): ModelMenuQuery<ModelRow> {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const groupOrder = useMemo(() => loadModelGroupOrder(projectId), [projectId]);
  return ({ query, showAll }) => {
    const pick = { query, selected: value, defaultModel, groupOrder };
    const visible = visibleChatModels(models, { ...pick, showAll });
    // Held back = what the full list has under this search that the key filter left out.
    const all = showAll
      ? visible.length
      : visibleChatModels(models, { ...pick, showAll: true }).length;
    return {
      options: visible.map((m) => ({
        key: modelKey(m),
        provider: m.provider,
        label: modelLabel(m),
        free: isFreeModel(m.pricing),
        noKey: !hasConfiguredKey(m),
        isDefault: sameModelRef(m, defaultModel),
        model: m,
      })),
      hidden: all - visible.length,
    };
  };
}

/**
 * The model candidate panel (search box + grouped list + "show all" row), shared by the draft
 * composer's dropdown and the in-session `/model` switch picker. Search and the reveal reset by
 * remount: both hosts render it only while open.
 */
export function ModelCatalogMenu({
  models,
  value,
  defaultModel,
  onPick,
}: {
  models: ModelInfo[];
  /** Currently selected (provider, modelId) pair; null = not yet chosen. */
  value: ModelRefDto | null;
  defaultModel?: ModelRefDto;
  onPick: (m: ModelInfo) => void;
}) {
  const view = useModelMenuQuery(models, value, defaultModel);
  return (
    <ModelMenuList
      view={view}
      currentKey={value ? modelKey(value) : null}
      labels={menuLabels()}
      onPick={(row) => onPick(row.model)}
    />
  );
}

/**
 * Model selector: the composer's toolbar pill (the draft card has room below, so it opens
 * downward, docked to the pill's right edge) or a dialog's form field.
 *
 * `emptyLabel` is for the one kind of host where an unpicked model is a decision and not a
 * gap — the organization dialogs, where an empty model means "follow the Project's default".
 * The menu still offers models only, so such a host carries its own way back to the empty
 * value; here the label is grayed as a placeholder and the provider logo is dropped, since no
 * provider is being named.
 */
export function ModelCatalogSelect({
  models,
  value,
  defaultModel,
  onChange,
  disabled,
  variant = "pill",
  emptyLabel,
}: {
  models: ModelInfo[];
  /** Currently selected (provider, modelId) pair; null = not yet chosen. */
  value: ModelRefDto | null;
  defaultModel?: ModelRefDto;
  onChange: (ref: ModelRefDto) => void;
  disabled: boolean;
  /** Trigger style: the composer's toolbar pill (default), or a dialog form control. */
  variant?: "pill" | "form";
  /** What the trigger reads while nothing is picked, where "nothing" is itself a choice. */
  emptyLabel?: string;
}) {
  const current = models.find((m) => sameModelRef(m, value));
  const unset = value === null && emptyLabel !== undefined;
  // Display rule matches the model page's card: display name, or falls back to the upstream id
  // (grouping is already conveyed by the provider logo).
  const label = current ? modelLabel(current) : (value?.modelId ?? emptyLabel ?? "…");
  return (
    <ModelSelect
      label={label}
      provider={unset ? null : (current?.provider ?? value?.provider ?? "custom")}
      muted={unset}
      ariaLabel={S.chat.chooseModel}
      tooltip={`${S.chat.chooseModel}：${label}`}
      disabled={disabled || models.length === 0}
      variant={variant}
    >
      {(close) => (
        <ModelCatalogMenu
          models={models}
          value={value}
          {...(defaultModel !== undefined ? { defaultModel } : {})}
          onPick={(m) => {
            onChange({ provider: m.provider, modelId: m.modelId });
            close();
          }}
        />
      )}
    </ModelSelect>
  );
}
