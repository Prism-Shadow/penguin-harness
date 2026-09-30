/**
 * Model picker pieces, extracted from chat-input.tsx so the Project settings dialog's
 * "new chat defaults" section can offer the same menu the chat composer uses (the panels
 * are mechanical moves; the composer's trigger is unchanged, and a "form" trigger variant
 * is added for dialog hosts — see ModelSelect). Both panels are built on the UI package's
 * PickerList (search box, scroll cap, keyboard navigation, current-entry marker), which
 * chat-input's `/agent` handoff picker shares:
 * - ModelMenuList: the model candidate panel (grouped, key-configured-first, "show all"
 *   expander) shared by the draft dropdown and the in-session `/model` switch picker;
 * - ModelSelect: the dropdown trigger (provider logo + name + chevron), pill or form style.
 */
import { useMemo, useState } from "react";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import {
  Badge,
  ChevronDown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  PickerList,
  ProviderLogo,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { Dropdown } from "../../components/ui/dropdown";
import { FormPicker } from "../../components/ui/form-picker";
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

/**
 * Model candidate panel (search box + grouped list + "show all" expander) shared by the
 * draft-state ModelSelect dropdown and the in-session `/model` switch picker. Search and
 * expanded state are internal and reset by remount (both hosts only render the panel while
 * open); the list is capped by an internal scroll (max-h-56) so it never overflows the
 * viewport no matter how many models there are.
 * Dropdown order mirrors the model library page (visibleChatModels): a top quick-search box
 * (the model page's rule — filters by id / display name / provider name); by default only
 * models with an API key are listed (hasConfiguredKey — a stored masked key or a masked env
 * fallback, the same standard as the model page's key status; `envKey` is merely the NAME of a
 * fallback env var and doesn't count on its own), with the selected and the default model
 * always visible even without a key; a muted bottom row reveals the remaining key-less models
 * (marked by a struck-through key icon, with the "no key" text in its title) without closing
 * the menu or changing the selection — when no model has a key at all, everything is listed
 * directly. Rows carry the provider logo, the "Free" badge for zero-cost models, the
 * project-default marker, and the selected checkmark.
 */
export function ModelMenuList({
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
  const [query, setQuery] = useState("");
  // Expanded "show all" state: collapses back to key-configured models on each open (remount).
  const [showAll, setShowAll] = useState(false);
  // The model page's dragged group order, so "mirrors the model library page" keeps holding
  // once a user has arranged their groups. Read here rather than threaded through every call
  // site, once per open (both hosts render the panel only while open, so opening it remounts
  // this) — an order changed on that page, in this tab or another, is picked up on the next
  // open without a reload. Not on every render: the search box below re-renders this panel
  // on each keystroke, and the Project context does so for reasons of its own.
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const groupOrder = useMemo(() => loadModelGroupOrder(projectId), [projectId]);
  const visible = visibleChatModels(models, {
    showAll,
    query,
    selected: value,
    defaultModel,
    groupOrder,
  });
  // How many models the key filter hides under the current query (0 when expanded): drives the bottom "show all" row.
  const hiddenCount = showAll
    ? 0
    : visibleChatModels(models, {
        showAll: true,
        query,
        selected: value,
        defaultModel,
        groupOrder,
      }).length - visible.length;
  return (
    <PickerList
      items={visible}
      itemKey={(m) => `${m.provider}:${m.modelId}`}
      isCurrent={(m) => sameModelRef(m, value)}
      query={query}
      onQueryChange={setQuery}
      // Quick search: supports model id / display name / provider name
      searchPlaceholder={S.models.searchPlaceholder}
      emptyText={S.models.noSearchResults}
      onPick={onPick}
      renderRow={(m) => (
        <>
          <ProviderLogo provider={m.provider} className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{modelLabel(m)}</span>
          {/* Zero-cost rows (all three price buckets 0): a "Free" badge, so free models stand
              out while picking — in the info tone: a price is a fact, not a warning. */}
          {isFreeModel(m.pricing) && (
            <span className="shrink-0">
              <Badge tone="info">{S.models.freeBadge}</Badge>
            </span>
          )}
          {/* Key-less rows (visible via show-all / selected / default / no-key-at-all) carry a
              struck-through key icon (the "no key" text lives in the title/aria-label). */}
          {!hasConfiguredKey(m) && (
            <span
              role="img"
              data-tooltip={S.models.noKey}
              aria-label={S.models.noKey}
              className="shrink-0 text-gray-400 dark:text-gray-500"
            >
              <GlyphIcon d={ICONS.keyOff} size={13} />
            </span>
          )}
          {sameModelRef(m, defaultModel) && (
            <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
              {S.models.default}
            </span>
          )}
        </>
      )}
      // Bottom expander row (pinned below the scroll area, mirroring the search box on top):
      // reveals the models hidden by the configured-key filter in place — the menu stays open
      // and the selection is untouched.
      {...(hiddenCount > 0
        ? {
            footer: (
              <div className="border-t border-gray-100 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                >
                  {S.models.showModelsWithoutKey(hiddenCount)}
                </button>
              </div>
            ),
          }
        : {})}
    />
  );
}

/**
 * Model selector (the chat composer's bottom-toolbar dropdown, also hosted by the Project
 * settings' new-chat-defaults section): the button shows the provider logo + name, and the
 * menu opens **downward** — the draft card is vertically centered with room below. The
 * candidate list itself is the shared ModelMenuList panel (search, key-configured-first
 * grouping, Free badge, "show all" expander — documented there).
 *
 * Two trigger variants, one menu:
 * - "pill" (default): the composer's compact toolbar button — collapses to the logo alone
 *   under the card's own `@container` query, menu right-aligned;
 * - "form": the shared FormPicker (full-width Input/Select-styled trigger, menu left-aligned
 *   under the control), used by every dialog host.
 *
 * `emptyLabel` is for the one kind of host where an unpicked model is a decision and not a
 * gap — the organization dialogs' "Project default"; see the prop.
 */
export function ModelSelect({
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
  /** Trigger style: the composer's toolbar pill (default), or a dialog form control (see the header comment). */
  variant?: "pill" | "form";
  /**
   * What the trigger reads while nothing is picked, for a host where "nothing" is itself a
   * choice rather than an unfinished one — the organization dialogs, where an empty model
   * means "follow the Project's default". The menu still offers models only, so such a host
   * carries its own way back to the empty value; here the label is grayed as a placeholder
   * and the provider logo is dropped, since no provider is being named.
   */
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => sameModelRef(m, value));
  const unset = value === null && emptyLabel !== undefined;
  // Display rule matches the model page's card: display name, or falls back to the upstream id (grouping is already conveyed by the provider logo).
  const label = current ? modelLabel(current) : (value?.modelId ?? emptyLabel ?? "…");
  const logo = unset ? null : (
    <ProviderLogo
      provider={current?.provider ?? value?.provider ?? "custom"}
      className="h-4 w-4 shrink-0"
    />
  );
  const menu = (
    <ModelMenuList
      models={models}
      value={value}
      {...(defaultModel !== undefined ? { defaultModel } : {})}
      onPick={(m) => {
        onChange({ provider: m.provider, modelId: m.modelId });
        setOpen(false);
      }}
    />
  );
  // Form: the shared full-width trigger (same look as Input/Select), used by every dialog picker.
  if (variant === "form") {
    return (
      <FormPicker
        size="sm"
        open={open}
        setOpen={setOpen}
        leading={logo}
        label={label}
        muted={unset}
        title={`${S.chat.chooseModel}：${label}`}
        ariaLabel={S.chat.chooseModel}
        ariaHaspopup="listbox"
        disabled={disabled || models.length === 0}
        menuClass="w-max min-w-56 origin-top-left"
      >
        {menu}
      </FormPicker>
    );
  }
  // Pill: the composer's compact toolbar button — the panel's right edge docks to it; portal
  // placement then clamps both edges inside the viewport.
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-max min-w-56 origin-top-right"
      portal={{ direction: "down", align: "right" }}
      button={
        <button
          type="button"
          data-tooltip={`${S.chat.chooseModel}：${label}`}
          aria-label={S.chat.chooseModel}
          disabled={disabled || models.length === 0}
          onClick={() => setOpen(!open)}
          className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          {logo}
          {/* When the card is narrower than @md, only the provider logo remains (title shows the full name). */}
          <span className="hidden min-w-0 truncate @md:block">{label}</span>
          <ChevronDown size={ICON_SIZE.caretDense} />
        </button>
      }
    >
      {menu}
    </Dropdown>
  );
}
