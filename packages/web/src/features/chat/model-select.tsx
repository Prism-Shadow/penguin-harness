/**
 * Model picker pieces, extracted from chat-input.tsx so every host offers the same picker:
 * - PickerList: the generic candidate panel (search box, scroll cap, keyboard navigation,
 *   current-entry marker) used by chat-input's `/agent` handoff picker;
 * - ModelSelect: the model picker's trigger (provider logo + name + chevron), pill or form
 *   style. Either opens the model-picker dialog (model-picker-modal.tsx), which the in-session
 *   `/model` switch opens too.
 */
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { FormPickerTrigger } from "../../components/ui/form-picker";
import { ChevronDown } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import { menuSearchClass, noAutofill } from "../../components/ui/input";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { sameModelRef } from "../models/model-grouping";
import { modelLabel } from "./model-picker-logic";
import { ModelPickerModal } from "./model-picker-modal";

// Re-exported for the pages that label models (the models page, the Project and company
// dialogs); it lives beside the picker's pure logic so the dialog can share it without an
// import cycle back to this module.
export { modelLabel };

/**
 * Searchable candidate panel for the composer's switch pickers (today the `/agent` handoff
 * picker; the model picker grew into its own dialog): the search box, the internal scroll cap,
 * the row chrome, the keyboard navigation and the "current entry" marker slot all live here,
 * so a picker supplies only what a row *contains* and what hangs below the list (`footer`).
 *
 * Keyboard navigation deliberately starts with **no** row highlighted: the search box is
 * autofocused, and pre-highlighting a row would repaint a panel that has looked the same since
 * before this control existed. ArrowDown/ArrowUp begin the navigation, and Enter/Tab commits —
 * the highlighted row if there is one, otherwise the top match, which is what makes "type a few
 * letters, press Enter" work. Escape is NOT handled here: each host closes its own panel at the
 * window level (an IME-safe handler for the switch pickers).
 */
export function PickerList<T>({
  items,
  itemKey,
  isCurrent,
  query,
  onQueryChange,
  searchPlaceholder,
  emptyText,
  onPick,
  renderRow,
  footer,
}: {
  items: T[];
  /** Stable React key AND identity for the highlighted row. */
  itemKey: (item: T) => string;
  /** Marks the entry already in effect (the session's model / its Agent): renders the ✓ slot and the emphasized row style. */
  isCurrent?: (item: T) => boolean;
  query: string;
  onQueryChange: (query: string) => void;
  searchPlaceholder: string;
  /** Shown in place of the list when the query matches nothing. */
  emptyText: string;
  onPick: (item: T) => void;
  /** The row's own content, left of the ✓ slot. */
  renderRow: (item: T) => ReactNode;
  /** Pinned below the scroll area (mirroring the search box above it). */
  footer?: ReactNode;
}) {
  // -1 = nothing highlighted yet (see the note above); reset whenever the candidate set changes.
  const [active, setActive] = useState(-1);
  const activeKey = active >= 0 && active < items.length ? itemKey(items[active]!) : null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
      return;
    }
    // Same guard as the composer's own Enter handling: an IME commit must not be read as a pick.
    if (((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onPick(items[active >= 0 ? active : 0]!);
    }
  };
  return (
    <div className="contents" onKeyDown={onKeyDown}>
      {/* Quick search (autofocused: it also owns the keyboard while the panel is up) */}
      <div className="border-b border-gray-100 px-2 pb-1.5 pt-0.5 dark:border-gray-800">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setActive(-1);
          }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          {...noAutofill}
          className={`${menuSearchClass} px-1 py-0.5`}
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {items.length === 0 && <p className="px-3 py-1.5 text-xs text-gray-400">{emptyText}</p>}
        {items.map((item) => {
          const key = itemKey(item);
          const current = isCurrent?.(item) ?? false;
          return (
            <button
              key={key}
              type="button"
              ref={key === activeKey ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              onClick={() => onPick(item)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                current
                  ? "font-medium text-gray-900 dark:text-gray-100"
                  : "text-gray-600 dark:text-gray-400"
              }${key === activeKey ? " bg-gray-100 dark:bg-gray-800" : ""}`}
            >
              {renderRow(item)}
              <span className="w-3 shrink-0 text-center text-xs">{current ? "✓" : ""}</span>
            </button>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

/**
 * Model selector (the chat composer's bottom-toolbar trigger, also hosted by the Project
 * settings' new-chat-defaults section, the schedule form, the company dialogs and the benchmark
 * dialog): the button shows the provider logo + name and opens the model-picker dialog (search,
 * provider-group rail, key-configured-first listing, Free badge — documented there). A pick
 * closes the dialog and reports `{ provider, modelId }` through `onChange`.
 *
 * Two trigger variants, one dialog:
 * - "pill" (default): the composer's compact toolbar button — collapses to the logo alone
 *   under the card's own `@container` query;
 * - "form": the shared form trigger (full-width, Input/Select-styled), used by every dialog
 *   host. The picker opened from inside a dialog stacks above it as a second Modal, and Escape
 *   closes only the picker.
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
   * means "follow the Project's default". The picker still offers models only, so such a host
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
  const isDisabled = disabled || models.length === 0;
  const picker = (
    <ModelPickerModal
      open={open}
      onClose={() => setOpen(false)}
      title={S.chat.chooseModel}
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
      <>
        <FormPickerTrigger
          size="sm"
          expanded={open}
          onClick={() => setOpen(true)}
          leading={logo}
          label={label}
          muted={unset}
          title={`${S.chat.chooseModel}：${label}`}
          ariaLabel={S.chat.chooseModel}
          ariaHaspopup="dialog"
          disabled={isDisabled}
        />
        {picker}
      </>
    );
  }
  // Pill: the composer's compact toolbar button.
  return (
    <>
      <button
        type="button"
        title={`${S.chat.chooseModel}：${label}`}
        aria-label={S.chat.chooseModel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={isDisabled}
        onClick={() => setOpen(true)}
        className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        {logo}
        {/* When the card is narrower than @md, only the provider logo remains (title shows the full name). */}
        <span className="hidden min-w-0 truncate @md:block">{label}</span>
        <ChevronDown size={ICON_SIZE.caretDense} />
      </button>
      {picker}
    </>
  );
}
