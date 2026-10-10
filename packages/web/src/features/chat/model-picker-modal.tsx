/**
 * The model picker as a dialog: a search field on top, the provider groups down a rail on the
 * left and the active group's models on the right. Every model picker in the app opens it —
 * the composer's pill, the dialog forms' field (both in model-select.tsx) and the in-session
 * `/model` switch.
 *
 * - **Rows** read as the provider's logo, the model's name and its marks (pickerRowTags: the
 *   models page's default / vision / fast / free / discount marks, drawn as badges), then the
 *   no-key glyph and Select's check. The upstream id is not printed; it is the row's tooltip,
 *   which also tells apart two groups' models of the same name. Rail entries and list rows are
 *   bands inset from the dialog's edges on the row radius, so a theme's rows look the same on
 *   both sides.
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
 *   Enter chooses, Escape empties a typed query first (the shared search box) and then closes
 *   (the Modal's esc layer, so a picker opened from a dialog closes alone). Rows and rail
 *   entries are not in the Tab order, and no click takes focus away from the search field.
 * - **Phone width**: the dialog fills the screen and the rail becomes a strip of group entries
 *   scrolling sideways above the list.
 *
 * The state (query, toggle, highlight) lives in the body, which Modal mounts only while open,
 * so each opening starts fresh on the current model. The body is three bands — the search head,
 * the rail and list, the foot — laid straight into the dialog, so a theme's dialog recipe finds
 * its head and foot the way it finds Modal's own.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import {
  Badge,
  ChoiceCheck,
  CloseButton,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Modal,
  NavList,
  ProviderLogo,
  SearchInput,
  navRowClass,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { hasConfiguredKey, sameModelRef } from "../models/model-grouping";
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
  pickerRowTags,
  searchPickerGroups,
  stepIndex,
} from "./model-picker-logic";
import type { PickerGroup, PickerNavKey, PickerRegion } from "./model-picker-logic";

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
      // Sized to its rows — a logo, a name and a few marks on one line — so the list does not
      // open an empty band between a name and its check. Full screen on a phone: the rail needs a
      // strip of its own above the list, and a bottom sheet leaves too little height for both.
      fullScreenOnPhone
      widthClass="sm:h-[min(32rem,80vh)] sm:max-w-xl max-sm:border-0"
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

  // Discounts follow the clock (off-peak tiers); the body remounts per opening, so one reading
  // per render is as fresh as the rows need.
  const now = new Date();
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
          data-tooltip={label === m.modelId ? label : `${label} · ${m.modelId}`}
          // Mouse movement, not mouseenter: rows scrolling under a resting pointer while the
          // keyboard drives the list must not steal the highlight.
          onMouseMove={isHighlighted ? undefined : onHover}
          onClick={() => onPick(m)}
          // The highlight is the keyboard's and the pointer's at once, so it takes the fill a
          // picker's highlighted row takes (PickerList); the current model is told by its weight
          // and its check.
          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-fg transition-colors duration-150${
            isHighlighted ? " bg-line-muted" : ""
          }`}
        >
          <ProviderLogo provider={m.provider} className="h-4 w-4 shrink-0" />
          {/* The marks follow the name rather than the row's far edge, so each reads as part of
              the model it describes; a long name truncates before they give way. */}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={`min-w-0 truncate text-sm${current ? " font-medium" : ""}`}>
              {label}
            </span>
            {pickerRowTags(m, defaultModel, now).map((tag) => (
              <Badge key={tag.key} tone={tag.tone} size="sm" tooltip={tag.title}>
                {tag.label}
              </Badge>
            ))}
          </span>
          {!hasConfiguredKey(m) && (
            <span
              role="img"
              data-tooltip={S.models.noKey}
              aria-label={S.models.noKey}
              className="shrink-0 text-fg-subtle"
            >
              <GlyphIcon d={ICONS.keyOff} size={ICON_SIZE.inlineGlyph} />
            </span>
          )}
          <ChoiceCheck on={current} />
        </button>
      </li>
    );
  };

  const mod = isMacPlatform() ? "⌥" : "Alt+";
  const showToggle = hidden > 0 || showAll;
  // Every band carries the same two handlers, which the body as a whole needs.
  const band = {
    onKeyDown,
    // The search field keeps focus through every click inside the dialog — a row, a rail
    // entry, the toggle, or the blank space around them, which would otherwise focus the
    // panel itself and leave the next keystroke with nowhere to go. Clicks still fire.
    onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => {
      if (e.target !== inputRef.current) e.preventDefault();
    },
  };
  return (
    <>
      <div
        data-slot="head"
        {...band}
        className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5"
      >
        <SearchInput
          ref={inputRef}
          variant="panel"
          autoFocus
          value={query}
          onChange={(next) => {
            setQuery(next);
            setSearchRow(0);
          }}
          placeholder={S.models.searchPlaceholder}
          aria-label={S.models.searchPlaceholder}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          {...(highlighted ? { "aria-activedescendant": optionId(highlighted) } : {})}
          className="min-w-0 flex-1"
        />
        <CloseButton onClose={onClose} />
      </div>

      <div {...band} className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* Rail: a column beside the list, a sideways-scrolling strip on a phone. */}
        <NavList
          label={S.modelPicker.groups}
          orientation="responsive"
          className="shrink-0 border-b border-line-muted px-3 py-2 sm:w-52 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-2"
        >
          {groups.map((g, i) => {
            // No group is active in the results view: they span every group.
            const active = !searching && i === groupIndex;
            const keyboardHere = active && region === "rail";
            return (
              // A rail row's look on a button of its own: an entry is out of the Tab order (the
              // search field drives the rail) and marks the group shown, not a page.
              <button
                key={g.id}
                ref={active ? activeRailRef : undefined}
                type="button"
                tabIndex={-1}
                aria-current={active ? "true" : undefined}
                data-tooltip={i < 9 ? `${g.provider.label} · ${mod}${i + 1}` : g.provider.label}
                onClick={() => activateGroup(i, "rail")}
                className={`${navRowClass({ active, orientation: "responsive" })}${
                  keyboardHere ? " ring-1 ring-inset ring-fg-subtle" : ""
                }`}
              >
                <ProviderLogo provider={g.id} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate sm:flex-1">{g.provider.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-fg-subtle">
                  {g.rows.length}
                </span>
              </button>
            );
          })}
        </NavList>

        <div
          id={listId}
          role="listbox"
          aria-label={
            searching
              ? S.models.searchPlaceholder
              : (activeGroup?.provider.label ?? S.chat.chooseModel)
          }
          className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
        >
          {searching ? (
            flatResults.length === 0 ? (
              <p className="px-2 py-3 text-sm text-fg-subtle">{S.models.noSearchResults}</p>
            ) : (
              results.map((g) => (
                <ul key={g.id} role="group" aria-label={g.provider.label}>
                  <li
                    role="presentation"
                    className="flex items-center gap-2 px-2 pb-1 pt-2.5 text-xs font-medium text-fg-muted"
                  >
                    <ProviderLogo provider={g.id} className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 truncate">{g.provider.label}</span>
                    <span className="tabular-nums text-fg-subtle">{g.rows.length}</span>
                  </li>
                  {g.rows.map((m) => {
                    const at = flatResults.indexOf(m);
                    return renderRow(m, at === searchIndex, () => setSearchRow(at));
                  })}
                </ul>
              ))
            )
          ) : groups.length === 0 ? (
            <p className="px-2 py-3 text-sm text-fg-subtle">{S.models.empty}</p>
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
        data-slot="foot"
        {...band}
        className={`${showToggle ? "flex" : "hidden sm:flex"} shrink-0 items-center gap-3 border-t border-line px-4 py-2 text-xs text-fg-subtle`}
      >
        {/* Models without a key: listed on request, as the dropdown's bottom row did. It turns
            back off too, since the rail grows by every key-less group while it is on. */}
        {showToggle && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="shrink-0 rounded-sm transition-colors duration-150 hover:text-fg"
          >
            {showAll ? S.modelPicker.hideModelsWithoutKey : S.models.showModelsWithoutKey(hidden)}
          </button>
        )}
        <span className="ml-auto hidden truncate sm:block">{S.modelPicker.hint(mod)}</span>
      </div>
    </>
  );
}
