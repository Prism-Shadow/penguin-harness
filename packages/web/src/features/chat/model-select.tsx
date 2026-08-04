/**
 * Model picker pieces, extracted from chat-input.tsx so the Project settings dialog's
 * "new chat defaults" section can offer the same menu the chat composer uses (the panels
 * are mechanical moves; the composer's trigger is unchanged, and a "form" trigger variant
 * is added for dialog hosts — see ModelSelect):
 * - PickerList: the generic candidate panel (search box, scroll cap, keyboard navigation,
 *   current-entry marker) shared with chat-input's `/agent` handoff picker;
 * - ModelMenuList: the model candidate panel (grouped, key-configured-first, "show all"
 *   expander) shared by the draft dropdown and the in-session `/model` switch picker;
 * - ModelSelect: the dropdown trigger (provider logo + name + chevron), pill or form style.
 */
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { Badge } from "../../components/ui/badge";
import { Dropdown } from "../../components/ui/dropdown";
import { controlBase } from "../../components/ui/field";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ChevronDown } from "../../components/ui/icons";
import { noAutofill, sizeClass } from "../../components/ui/input";
import { ProviderLogo } from "../../components/ui/provider-logo";
import {
  hasConfiguredKey,
  isFreeModel,
  sameModelRef,
  visibleChatModels,
} from "../models/model-grouping";

/** Display label for a model: the display name, or falls back to the upstream id (model_id is the raw field, no prefix parsing). */
export function modelLabel(m: ModelInfo): string {
  return m.displayName ?? m.modelId;
}

/**
 * "No key" marker for the model dropdown's key-less rows: a key struck through by a prohibition
 * slash (24x24 line art, grayscale via currentColor, matching the approval-mode icon style).
 */
const NO_KEY_ICON =
  "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4M2 2l20 20";

/**
 * Candidate panel shared by every picker of this family (the model dropdown / `/model` switch
 * picker and the `/agent` handoff picker): the search box, the internal scroll cap, the row
 * chrome, the keyboard navigation and the "current entry" marker slot all live here, so the
 * two pickers can differ only in what a row *contains* (provider logo vs Agent avatar) and in
 * what they hang below the list (`footer`, e.g. the model list's "show all" expander).
 *
 * Keyboard navigation deliberately starts with **no** row highlighted: the search box is
 * autofocused, and pre-highlighting a row would repaint a panel that has looked the same since
 * before this control existed. ArrowDown/ArrowUp begin the navigation, and Enter/Tab commits —
 * the highlighted row if there is one, otherwise the top match, which is what makes "type a few
 * letters, press Enter" work. Escape is NOT handled here: each host closes its own panel at the
 * window level (an IME-safe handler for the switch pickers, Dropdown's for the model dropdown).
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
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none dark:text-gray-200 dark:placeholder:text-gray-500"
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
 * Model candidate panel (search box + grouped list + "show all" expander) shared by the
 * draft-state ModelSelect dropdown and the in-session `/model` switch picker. Search and
 * expanded state are internal and reset by remount (both hosts only render the panel while
 * open); the list is capped by an internal scroll (max-h-56) so it never overflows the
 * viewport no matter how many models there are.
 * Dropdown order mirrors the model library page (visibleChatModels): a top quick-search box
 * (the model page's rule — filters by id / display name / provider name); by default only
 * models with a configured API key are listed (stored masked key — the same standard as the
 * model page's key status; `envKey` is merely the NAME of a fallback env var and doesn't
 * count), with the selected and the default model always visible even without a key; a muted
 * bottom row reveals the remaining key-less models (marked by a struck-through key icon, with
 * the "no key" text in its title) without closing the menu or changing the selection — when
 * no model has a key at all, everything is listed directly. Rows carry the provider logo, the
 * light-yellow "Free" badge for zero-cost models (same as the model library card), the
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
  const visible = visibleChatModels(models, { showAll, query, selected: value, defaultModel });
  // How many models the key filter hides under the current query (0 when expanded): drives the bottom "show all" row.
  const hiddenCount = showAll
    ? 0
    : visibleChatModels(models, { showAll: true, query, selected: value, defaultModel }).length -
      visible.length;
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
          {/* Zero-cost rows (all three price buckets 0): same light-yellow "Free" badge as
              the model library card, so free models stand out while picking. */}
          {isFreeModel(m.pricing) && (
            <span className="shrink-0">
              <Badge tone="yellow">{S.models.freeBadge}</Badge>
            </span>
          )}
          {/* Key-less rows (visible via show-all / selected / default / no-key-at-all) carry a
              struck-through key icon (the "no key" text lives in the title/aria-label). */}
          {!hasConfiguredKey(m) && (
            <span
              role="img"
              title={S.models.noKey}
              aria-label={S.models.noKey}
              className="shrink-0 text-gray-400 dark:text-gray-500"
            >
              <GlyphIcon d={NO_KEY_ICON} size={13} />
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
 * - "form": a full-width trigger styled like the dialog's Input/Select (controlBase + the
 *   sm size tier), label always visible (a container-less host's `@md:` variant would never
 *   match), menu left-aligned under the control.
 */
export function ModelSelect({
  models,
  value,
  defaultModel,
  onChange,
  disabled,
  variant = "pill",
}: {
  models: ModelInfo[];
  /** Currently selected (provider, modelId) pair; null = not yet chosen. */
  value: ModelRefDto | null;
  defaultModel?: ModelRefDto;
  onChange: (ref: ModelRefDto) => void;
  disabled: boolean;
  /** Trigger style: the composer's toolbar pill (default), or a dialog form control (see the header comment). */
  variant?: "pill" | "form";
}) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => sameModelRef(m, value));
  // Display rule matches the model page's card: display name, or falls back to the upstream id (grouping is already conveyed by the provider logo).
  const label = current ? modelLabel(current) : (value?.modelId ?? "…");
  const logo = (
    <ProviderLogo
      provider={current?.provider ?? value?.provider ?? "custom"}
      className="h-4 w-4 shrink-0"
    />
  );
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      // Pill: the panel's right edge docks to the button; portal placement then clamps both
      // edges inside the viewport, so a w-max panel can no longer run off-screen on phones
      // (it used to need a hand-tuned width clamp reserving the anchor offset). Form: the
      // panel hangs under the full-width control's left edge, like the dialog's Select.
      menuClass={`w-max min-w-56 ${variant === "form" ? "origin-top-left" : "origin-top-right"}`}
      portal={{ direction: "down", align: variant === "form" ? "left" : "right" }}
      button={
        variant === "form" ? (
          // Dialog form control: full width, same border/height/typography as Input/Select (sm tier).
          <button
            type="button"
            title={`${S.chat.chooseModel}：${label}`}
            aria-label={S.chat.chooseModel}
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled || models.length === 0}
            onClick={() => setOpen(!open)}
            className={`flex w-full items-center gap-2 text-left ${controlBase} ${sizeClass.sm} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {logo}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <ChevronDown className="text-gray-400" />
          </button>
        ) : (
          <button
            type="button"
            title={`${S.chat.chooseModel}：${label}`}
            aria-label={S.chat.chooseModel}
            disabled={disabled || models.length === 0}
            onClick={() => setOpen(!open)}
            className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            {logo}
            {/* When the card is narrower than @md, only the provider logo remains (title shows the full name). */}
            <span className="hidden min-w-0 truncate @md:block">{label}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              className="shrink-0"
              aria-hidden
            >
              <path
                d="M3 4.5l3 3 3-3"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )
      }
    >
      <ModelMenuList
        models={models}
        value={value}
        {...(defaultModel !== undefined ? { defaultModel } : {})}
        onPick={(m) => {
          onChange({ provider: m.provider, modelId: m.modelId });
          setOpen(false);
        }}
      />
    </Dropdown>
  );
}
