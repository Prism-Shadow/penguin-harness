/**
 * The model picker: a search over the models a caller offers, and the trigger it opens from.
 *
 * - `ModelMenuList` is the panel: the `PickerList` search box and scroll cap over one row per
 *   model — the provider's logo, the model's name, a "Free" badge for a model that costs nothing,
 *   the struck-through key for one with no API key, the default marker for the one new
 *   conversations start on, and the check on the one in effect. Below the list a muted row can
 *   reveal the models a filter holds back, in place: the menu stays open and the choice is
 *   untouched.
 * - `ModelSelect` is the trigger with the panel behind it, in two shapes: the composer's `pill`
 *   (logo, name, caret; the name hides on a narrow card and the panel docks to the pill's right
 *   edge) and the dialogs' `form` field (the shared `FormPicker`, the panel under its left edge).
 *   Its body is the caller's, rendered only while open and handed the way to close it, so a
 *   caller that reads something once per opening (the app's saved group order) reads it then.
 *
 * Which models are listed, in what order, and what "held back" means are the caller's: `view`
 * answers, for the search typed so far and whether the held-back models are revealed, with the
 * rows to draw and how many it held back. The search and the reveal are the panel's own state,
 * so both start over each time it opens. Every word the panel shows is the caller's too
 * (`labels`).
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "../../feedback/badge/badge";
import { PickerList } from "../../forms/picker-list/picker-list";
import { FormPicker } from "../../forms/select/form-picker";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { ProviderLogo } from "../../icons/logos/provider-logo";
import { Dropdown } from "../../overlays/dropdown/dropdown";
import { ToolbarTrigger } from "../composer/toolbar-trigger";

/** One model as the panel draws it. */
export interface ModelOption {
  /** Stable key and identity: the provider and the model id together. */
  key: string;
  /** The provider, for its logo. */
  provider: string;
  /** The model's name as shown. */
  label: string;
  /** Costs nothing: the "Free" badge. */
  free?: boolean;
  /** No API key is configured for it: the struck-through key. */
  noKey?: boolean;
  /** New conversations start on it: the default marker. */
  isDefault?: boolean;
}

/** The panel's words. */
export interface ModelMenuLabels {
  /** The search box's placeholder and accessible name. */
  search: string;
  /** Shown in place of the list when the search matches nothing. */
  empty: string;
  /** The free model's badge. */
  free: string;
  /** The no-key mark's name and tooltip. */
  noKey: string;
  /** The default model's marker. */
  isDefault: string;
  /** The reveal row's text, given how many models it would reveal. */
  showHidden: (count: number) => string;
}

/** What the panel shows for a search and a reveal state. */
export interface ModelMenuView<T extends ModelOption> {
  options: readonly T[];
  /** How many models the caller held back under this search (0 once revealed). */
  hidden: number;
}

/** What the caller answers the panel's search and reveal state with. */
export type ModelMenuQuery<T extends ModelOption> = (state: {
  query: string;
  showAll: boolean;
}) => ModelMenuView<T>;

export function ModelMenuList<T extends ModelOption>({
  view,
  currentKey,
  labels,
  onPick,
}: {
  view: ModelMenuQuery<T>;
  /** The model in effect (checked); null when none is chosen yet. */
  currentKey: string | null;
  labels: ModelMenuLabels;
  onPick: (option: T) => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { options, hidden } = view({ query, showAll });
  return (
    <PickerList
      items={options}
      itemKey={(option) => option.key}
      isCurrent={(option) => option.key === currentKey}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder={labels.search}
      emptyText={labels.empty}
      onPick={onPick}
      renderRow={(option) => (
        <>
          <ProviderLogo provider={option.provider} className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {/* A price is a fact, not a warning: the info tone. */}
          {option.free === true && (
            <span className="shrink-0">
              <Badge tone="info">{labels.free}</Badge>
            </span>
          )}
          {option.noKey === true && (
            <span
              role="img"
              data-tooltip={labels.noKey}
              aria-label={labels.noKey}
              className="shrink-0 text-fg-subtle"
            >
              <GlyphIcon d={ICONS.keyOff} size={13} />
            </span>
          )}
          {option.isDefault === true && (
            <span className="shrink-0 text-xs text-fg-subtle">{labels.isDefault}</span>
          )}
        </>
      )}
      // The reveal row, pinned under the scroll area as the search box is above it.
      {...(hidden > 0
        ? {
            footer: (
              <div className="border-t border-line-muted">
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg-muted"
                >
                  {labels.showHidden(hidden)}
                </button>
              </div>
            ),
          }
        : {})}
    />
  );
}

export function ModelSelect({
  label,
  provider,
  muted = false,
  ariaLabel,
  tooltip,
  disabled = false,
  variant = "pill",
  children,
}: {
  /** The trigger's words: the chosen model's name, or what stands in for none. */
  label: string;
  /** The trigger's logo; null draws none (no provider is being named). */
  provider: string | null;
  /** The form field's words read as a placeholder. */
  muted?: boolean;
  /** The trigger's accessible name. */
  ariaLabel: string;
  /** The trigger's tooltip: the name with the model in it. */
  tooltip: string;
  disabled?: boolean;
  /** The composer's toolbar pill, or a dialog's form field. */
  variant?: "pill" | "form";
  /**
   * The panel's body, mounted only while it is open — a `ModelMenuList`, whose pick calls
   * `close`.
   */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const logo =
    provider === null ? null : <ProviderLogo provider={provider} className="h-4 w-4 shrink-0" />;
  const menu = children(() => setOpen(false));
  if (variant === "form") {
    return (
      <FormPicker
        size="sm"
        open={open}
        setOpen={setOpen}
        leading={logo}
        label={label}
        muted={muted}
        title={tooltip}
        ariaLabel={ariaLabel}
        ariaHaspopup="listbox"
        disabled={disabled}
        menuClass="w-max min-w-56 origin-top-left"
      >
        {menu}
      </FormPicker>
    );
  }
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-max min-w-56 origin-top-right"
      portal={{ direction: "down", align: "right" }}
      button={
        <ToolbarTrigger
          glyph={logo}
          label={label}
          caret
          width="md"
          ariaLabel={ariaLabel}
          tooltip={tooltip}
          disabled={disabled}
          expanded={open}
          onClick={() => setOpen(!open)}
        />
      }
    >
      {menu}
    </Dropdown>
  );
}
