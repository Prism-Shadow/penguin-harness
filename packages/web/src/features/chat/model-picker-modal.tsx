/**
 * The model picker as a dialog: a search field on top, the provider groups down a rail on the
 * left and the active group's models on the right. Every model picker in the app opens it —
 * the composer's pill, the dialog forms' field (both in model-select.tsx) and the in-session
 * `/model` switch.
 *
 * - **Opens on the current model**: its group is active and its row highlighted and scrolled
 *   into view. With nothing chosen, the first group with a configured key is active.
 * - **Search** replaces the right side with matches from every group, grouped by provider,
 *   best matches first (model-picker-logic.ts); clearing it returns to the group view. The
 *   rail stays, and picking a group from it leaves the search.
 * - **Models without a key** follow the rule the dropdown always had (visibleChatModels):
 *   hidden unless selected or the Project default, with a footer toggle that lists them —
 *   their groups join the rail, each row marked by the struck-through key. When nothing has a
 *   key, everything is listed and the toggle is not shown.
 * - **Keyboard**: the search field keeps focus the whole time and drives a highlight (the
 *   combobox pattern, via `aria-activedescendant`), so typing always lands in it. ↑/↓ walk the
 *   list or the rail, ←/→ or Tab switch between them, ⌥1–9 (Alt off macOS) jump to a group,
 *   Enter chooses, Escape closes (the Modal's esc layer, so a picker opened from a dialog closes
 *   alone). Rows and rail entries are not in the Tab order, and no click takes focus away
 *   from the search field.
 * - **Phone width**: the dialog fills the screen and the rail becomes a strip of group chips
 *   scrolling sideways above the list.
 *
 * The state (query, toggle, highlight) lives in the body, which Modal mounts only while open,
 * so each opening starts fresh on the current model.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Badge } from "../../components/ui/badge";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CloseButton } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { noAutofill, panelSearchClass } from "../../components/ui/input";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { hasConfiguredKey, isFreeModel, sameModelRef } from "../models/model-grouping";
import { loadModelGroupOrder } from "../models/model-group-order";
import { useProject } from "../../state/project";
import {
  entryRow,
  groupShortcutIndex,
  hiddenModelCount,
  initialGroupId,
  modelLabel,
  movePickerNav,
  pickerGroups,
  searchPickerGroups,
  stepIndex,
} from "./model-picker-logic";
import type { PickerGroup, PickerNavKey, PickerRegion } from "./model-picker-logic";

/**
 * "No key" marker for key-less rows: a key struck through by a prohibition slash (24x24 line
 * art, grayscale via currentColor, matching the approval-mode icon style).
 */
const NO_KEY_ICON =
  "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4M2 2l20 20";

const NAV_KEYS: Record<string, PickerNavKey> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Tab: "tab",
};

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export interface ModelPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Names the dialog for assistive tech ("Choose model", "Switch model"). */
  title: string;
  models: ModelInfo[];
  /** Currently selected (provider, modelId) pair; null = not yet chosen. */
  value: ModelRefDto | null;
  defaultModel?: ModelRefDto;
  /** A row was chosen. The host closes the dialog (it owns `open`). */
  onPick: (m: ModelInfo) => void;
}

export function ModelPickerModal({ open, onClose, title, ...body }: ModelPickerModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      headerless
      bare
      // Full screen on a phone: the rail needs a strip of its own above the list, and a bottom
      // sheet leaves too little height for both.
      widthClass="sm:max-w-3xl max-sm:rounded-none max-sm:border-0"
    >
      <ModelPickerBody {...body} onClose={onClose} />
    </Modal>
  );
}

function ModelPickerBody({
  models,
  value,
  defaultModel,
  onPick,
  onClose,
}: Omit<ModelPickerModalProps, "open" | "title">) {
  // The models page's dragged group order, read once per open (the body remounts on each), so
  // an order changed there is picked up on the next open without a reload.
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const groupOrder = useMemo(() => loadModelGroupOrder(projectId), [projectId]);

  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const searching = query.trim() !== "";
  const visibility = {
    showAll,
    selected: value,
    defaultModel: defaultModel ?? null,
    groupOrder,
  };
  const groups = pickerGroups(models, visibility);
  const results = searching ? searchPickerGroups(models, { ...visibility, query }) : [];
  const hidden = hiddenModelCount(models, { ...visibility, query });

  // Group-view position, by group id so it survives the rail changing under it (the toggle
  // adding or removing groups); a vanished group falls back to the opening rule.
  const [groupId, setGroupId] = useState(() => initialGroupId(groups, value));
  const [region, setRegion] = useState<PickerRegion>("list");
  const [row, setRow] = useState(() =>
    entryRow(groups.find((g) => g.id === groupId)?.rows ?? [], value),
  );
  // Search-view highlight over the flattened results; the top match until the arrows move it,
  // so "type a few letters, press Enter" takes the best match.
  const [searchRow, setSearchRow] = useState(0);

  let groupIndex = groups.findIndex((g) => g.id === groupId);
  if (groupIndex < 0) {
    const fallback = initialGroupId(groups, value);
    groupIndex = Math.max(
      0,
      groups.findIndex((g) => g.id === fallback),
    );
  }
  const activeGroup: PickerGroup<ModelInfo> | undefined = groups[groupIndex];
  const groupRows = activeGroup?.rows ?? [];
  const rowIndex = Math.min(row, groupRows.length - 1);
  const flatResults = results.flatMap((g) => g.rows);
  const searchIndex = Math.min(searchRow, flatResults.length - 1);
  const highlighted: ModelInfo | undefined = searching
    ? flatResults[searchIndex]
    : region === "list"
      ? groupRows[rowIndex]
      : undefined;

  const idBase = useId();
  const listId = `${idBase}-list`;
  const optionId = (m: ModelInfo) =>
    `${idBase}-opt-${encodeURIComponent(`${m.provider}:${m.modelId}`)}`;
  const inputRef = useRef<HTMLInputElement>(null);

  // The opening scroll centres the current model; keyboard moves after that only nudge.
  const centeredRef = useRef(false);
  const scrollHighlight = (el: HTMLElement | null) => {
    if (!el) return;
    el.scrollIntoView({ block: centeredRef.current ? "nearest" : "center" });
    centeredRef.current = true;
  };
  // The active rail entry follows the keyboard too — sideways on the phone strip.
  const activeRailRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRailRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [groupIndex]);

  const activateGroup = (index: number, nextRegion: PickerRegion) => {
    const g = groups[index];
    if (!g) return;
    setGroupId(g.id);
    setRow(entryRow(g.rows, value));
    setRegion(nextRegion);
    setQuery("");
    setSearchRow(0);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const jump = groupShortcutIndex(e);
    if (jump !== null) {
      // Claimed even past the last group, so Option+digit never types its symbol (¡, ™, …)
      // into the search field while the picker is up.
      e.preventDefault();
      if (jump < groups.length) activateGroup(jump, "list");
      return;
    }
    if (e.target !== inputRef.current) {
      // Focus sits on the close button or the toggle (reached with Tab): typing goes to the
      // search field anyway — a printable key moved there lands in it.
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) inputRef.current?.focus();
      return;
    }
    if (e.nativeEvent.isComposing) {
      // Escape while an IME candidate list is up drops the candidates, not the dialog.
      if (e.key === "Escape") e.stopPropagation();
      return;
    }
    if (searching) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSearchRow(stepIndex(searchIndex, flatResults.length, e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlighted) onPick(highlighted);
      }
      // ←/→ belong to the caret while there is text; Tab walks the dialog's controls.
      return;
    }
    const key = NAV_KEYS[e.key];
    if (key !== undefined) {
      e.preventDefault();
      const next = movePickerNav({ region, group: groupIndex, row: rowIndex }, key, {
        groupCount: groups.length,
        rowCount: (i) => groups[i]?.rows.length ?? 0,
        entry: (i) => entryRow(groups[i]?.rows ?? [], value),
      });
      setRegion(next.region);
      setRow(next.row);
      if (next.group !== groupIndex) setGroupId(groups[next.group]?.id ?? null);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (region === "rail") setRegion("list");
      else if (highlighted) onPick(highlighted);
    }
  };

  const renderRow = (m: ModelInfo, isHighlighted: boolean, onHover: () => void) => {
    const current = sameModelRef(m, value);
    const label = modelLabel(m);
    return (
      <li
        key={`${m.provider}:${m.modelId}`}
        id={optionId(m)}
        role="option"
        aria-selected={isHighlighted}
        ref={isHighlighted ? scrollHighlight : undefined}
      >
        <button
          type="button"
          tabIndex={-1}
          // Mouse movement, not mouseenter: rows scrolling under a resting pointer while the
          // keyboard drives the list must not steal the highlight.
          onMouseMove={isHighlighted ? undefined : onHover}
          onClick={() => onPick(m)}
          className={`flex w-full items-center gap-2 px-4 py-2 text-left transition-colors duration-150 ${
            isHighlighted ? "bg-gray-100 dark:bg-gray-800" : ""
          }`}
        >
          <span className="min-w-0 flex-1">
            <span
              className={`block truncate text-sm ${
                current
                  ? "font-medium text-gray-900 dark:text-gray-100"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {label}
            </span>
            {label !== m.modelId && (
              <span className="block truncate font-mono text-xs text-gray-400 dark:text-gray-500">
                {m.modelId}
              </span>
            )}
          </span>
          {/* Zero-cost rows: the model library card's light-yellow "Free" badge. */}
          {isFreeModel(m.pricing) && (
            <span className="shrink-0">
              <Badge tone="yellow">{S.models.freeBadge}</Badge>
            </span>
          )}
          {!hasConfiguredKey(m) && (
            <span
              role="img"
              title={S.models.noKey}
              aria-label={S.models.noKey}
              className="shrink-0 text-gray-400 dark:text-gray-500"
            >
              <GlyphIcon d={NO_KEY_ICON} size={ICON_SIZE.inlineGlyph} />
            </span>
          )}
          {sameModelRef(m, defaultModel) && (
            <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
              {S.models.default}
            </span>
          )}
          <span className="w-3 shrink-0 text-center text-xs text-gray-700 dark:text-gray-300">
            {current ? "✓" : ""}
          </span>
        </button>
      </li>
    );
  };

  const mod = isMacPlatform() ? "⌥" : "Alt+";
  const showToggle = hidden > 0 || showAll;
  return (
    <div
      onKeyDown={onKeyDown}
      // The search field keeps focus through every click inside the dialog — a row, a rail
      // entry, the toggle, or the blank space around them, which would otherwise focus the
      // panel itself and leave the next keystroke with nowhere to go. Clicks still fire.
      onMouseDown={(e) => {
        if (e.target !== inputRef.current) e.preventDefault();
      }}
      // The Modal panel adds the bottom safe-area inset below this, so the phone height leaves
      // room for it rather than pushing the search field under the status bar.
      className="flex h-[calc(100dvh_-_env(safe-area-inset-bottom))] flex-col pt-[env(safe-area-inset-top)] sm:h-[min(36rem,85vh)] sm:pt-0"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 py-2.5 dark:border-gray-800">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchRow(0);
          }}
          placeholder={S.models.searchPlaceholder}
          aria-label={S.models.searchPlaceholder}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          {...(highlighted ? { "aria-activedescendant": optionId(highlighted) } : {})}
          {...noAutofill}
          className={`${panelSearchClass} min-w-0 flex-1 px-2.5 py-1.5`}
        />
        <CloseButton onClose={onClose} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* Rail: a column beside the list, a sideways-scrolling strip of chips on a phone. */}
        <nav
          aria-label={S.modelPicker.groups}
          className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-gray-100 px-3 py-2 sm:w-52 sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-2 dark:border-gray-800"
        >
          {groups.map((g, i) => {
            // No group is active in the results view: they span every group.
            const active = !searching && i === groupIndex;
            const keyboardHere = active && region === "rail";
            return (
              <button
                key={g.id}
                ref={active ? activeRailRef : undefined}
                type="button"
                tabIndex={-1}
                aria-current={active ? "true" : undefined}
                title={i < 9 ? `${g.provider.label} · ${mod}${i + 1}` : g.provider.label}
                onClick={() => activateGroup(i, "rail")}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1 text-sm transition-colors duration-150 sm:w-full sm:rounded-md sm:border-transparent sm:py-1.5 sm:dark:border-transparent ${
                  active
                    ? "border-gray-300 bg-gray-200/70 font-medium text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    : "border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200"
                }${keyboardHere ? " ring-1 ring-inset ring-gray-400 dark:ring-gray-500" : ""}`}
              >
                <ProviderLogo provider={g.id} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate sm:flex-1 sm:text-left">{g.provider.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                  {g.rows.length}
                </span>
              </button>
            );
          })}
        </nav>

        <div
          id={listId}
          role="listbox"
          aria-label={
            searching
              ? S.models.searchPlaceholder
              : (activeGroup?.provider.label ?? S.chat.chooseModel)
          }
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {searching ? (
            flatResults.length === 0 ? (
              <p className="px-4 py-3 text-sm text-gray-400">{S.models.noSearchResults}</p>
            ) : (
              results.map((g) => (
                <ul key={g.id} role="group" aria-label={g.provider.label}>
                  <li
                    role="presentation"
                    className="flex items-center gap-2 px-4 pb-1 pt-2.5 text-xs font-medium text-gray-500 dark:text-gray-400"
                  >
                    <ProviderLogo provider={g.id} className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 truncate">{g.provider.label}</span>
                    <span className="tabular-nums text-gray-400 dark:text-gray-500">
                      {g.rows.length}
                    </span>
                  </li>
                  {g.rows.map((m) => {
                    const at = flatResults.indexOf(m);
                    return renderRow(m, at === searchIndex, () => setSearchRow(at));
                  })}
                </ul>
              ))
            )
          ) : groups.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">{S.models.empty}</p>
          ) : (
            <ul role="group" aria-label={activeGroup?.provider.label}>
              {groupRows.map((m, i) =>
                renderRow(m, region === "list" && i === rowIndex, () => {
                  setRegion("list");
                  setRow(i);
                }),
              )}
            </ul>
          )}
        </div>
      </div>

      {/* On a phone the bar exists only for the toggle: the keyboard legend is desktop-only. */}
      <div
        className={`${showToggle ? "flex" : "hidden sm:flex"} shrink-0 items-center gap-3 border-t border-gray-200 px-4 py-2 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500`}
      >
        {/* Models without a key: listed on request, as the dropdown's bottom row did. It turns
            back off too, since the rail grows by every key-less group while it is on. */}
        {showToggle && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="shrink-0 rounded transition-colors duration-150 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {showAll ? S.modelPicker.hideModelsWithoutKey : S.models.showModelsWithoutKey(hidden)}
          </button>
        )}
        <span className="ml-auto hidden truncate sm:block">{S.modelPicker.hint(mod)}</span>
      </div>
    </div>
  );
}
