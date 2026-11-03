/**
 * The Trace toolbar's dropdown, one component for both of the toolbar's choices — the file a
 * multi-file Session is read from, and the round the navigator jumps to — so the two look and
 * behave the same.
 *
 * - The trigger is a ghost toolbar button: a glyph, the current choice, the caret.
 * - The panel is the shared `Dropdown`, portaled. Its width is capped by the room inside the
 *   panel's scroll box on the side it opens toward, so it never hangs past the Trace panel. A
 *   title row names the list and counts it (the navigator adds its number box at the row's end),
 *   then one row per choice, the Menu family's rows outside a menu: the current one filled and
 *   checked.
 * - Opening lands focus on the current row, the list's one tab stop, so Tab from a control in the
 *   title row reaches it. ArrowUp/ArrowDown walk the rows (Dropdown's walker), Home/End jump to
 *   the ends, Escape and an outside click close it, and Escape hands focus back to the trigger.
 *   Picking a row closes the list and hands focus back to the trigger before it reports the pick,
 *   so a pick that moves focus elsewhere (a jump to a round's head) has the last word.
 * - Rows carry `content-visibility: auto`: a list of thousands of rounds lays out only the rows
 *   in its scroll area.
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from "react";
import {
  Button,
  ChevronDown,
  Dropdown,
  GlyphIcon,
  ICON_SIZE,
  MenuItem,
} from "@prismshadow/penguin-ui";

/** Room the panel keeps from the scroll box's edge (px). */
const PANEL_INSET = 8;

export interface PickerRow<K extends string | number> {
  key: K;
  /** Before the label: a round's number and compaction badge. */
  lead?: ReactNode;
  /** The row's words, cut at their end when the panel is narrow. */
  label: ReactNode;
  /** After the label: a round's readings, a file's size. */
  trailing?: ReactNode;
}

/**
 * The panel's width: `width`, or the room between the trigger's aligned edge and the far edge of
 * the scroll box (the viewport's, outside one), whichever is less.
 */
function panelStyle(trigger: Element, align: "left" | "right", width: string): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const box = trigger.closest("[data-scroll-box]")?.getBoundingClientRect();
  const room =
    align === "right"
      ? rect.right - (box?.left ?? 0) - PANEL_INSET
      : (box?.right ?? window.innerWidth) - rect.left - PANEL_INSET;
  return { width: `min(${width}, ${Math.max(0, room)}px)`, maxWidth: "calc(100vw - 2rem)" };
}

export function TracePicker<K extends string | number>({
  slot,
  glyph,
  label,
  title,
  count,
  headerEnd,
  align,
  width,
  rows,
  current,
  onPick,
}: {
  /** The trigger's `data-slot`. */
  slot: string;
  /** The trigger's glyph (an `ICONS` path). */
  glyph: string;
  /** The trigger's words: the current choice. */
  label: string;
  /** The panel's title and accessible name. */
  title: string;
  /** How many choices the panel lists, beside its title. */
  count: string;
  /** Controls at the title row's end, handed the picker's pick (which closes the panel). */
  headerEnd?: (pick: (key: K) => void) => ReactNode;
  /** The trigger edge the panel lines up with: `left` at the toolbar's start, `right` its end. */
  align: "left" | "right";
  /** The panel's preferred width (a CSS length); the room in the scroll box caps it. */
  width: string;
  rows: readonly PickerRow<K>[];
  current: K;
  onPick: (key: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Opening lands on the current row. A frame later, not at commit: the portaled panel is laid
  // out hidden until it has been placed, and a hidden element cannot take focus.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('button[aria-current="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    trigger.current = e.currentTarget;
    if (!open) setStyle(panelStyle(e.currentTarget, align, width));
    setOpen(!open);
  };
  const pick = (key: K) => {
    setOpen(false);
    trigger.current?.focus();
    onPick(key);
  };
  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== "Home" && e.key !== "End") return;
    const buttons = listRef.current?.querySelectorAll<HTMLElement>("[data-pick-row] button");
    if (!buttons || buttons.length === 0) return;
    e.preventDefault();
    buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
  };

  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align }}
      menuStyle={style}
      menuClass=""
      focusOnOpen={false}
      className="min-w-0 shrink-0"
      button={
        <Button
          size="sm"
          variant="ghost"
          data-slot={slot}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          leading={<GlyphIcon d={glyph} size={ICON_SIZE.rowLead} />}
        >
          <span className="tabular-nums">{label}</span>
          <ChevronDown className="text-fg-subtle" />
        </Button>
      }
    >
      <div role="dialog" aria-label={title}>
        <div className="flex items-center gap-2 border-b border-line-muted px-3 pb-1.5">
          <span className="text-xs font-semibold whitespace-nowrap">{title}</span>
          <span className="truncate text-xs text-fg-muted">{count}</span>
          <span className="min-w-0 flex-1" />
          {headerEnd?.(pick)}
        </div>
        <ol
          ref={listRef}
          aria-label={title}
          onKeyDown={onListKey}
          className="max-h-[60vh] overflow-y-auto pt-1"
        >
          {rows.map((row) => {
            const isCurrent = row.key === current;
            return (
              // `content-visibility` contains the row's paint: the focus ring is drawn inside it.
              <li
                key={row.key}
                data-pick-row={row.key}
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 30px" }}
              >
                <MenuItem
                  density="sm"
                  glyph={row.lead}
                  label={row.label}
                  trailing={row.trailing}
                  checked={isCurrent}
                  tabIndex={isCurrent ? 0 : -1}
                  aria-current={isCurrent ? "true" : undefined}
                  onSelect={() => pick(row.key)}
                  className="focus-visible:[outline-offset:-2px]"
                />
              </li>
            );
          })}
        </ol>
      </div>
    </Dropdown>
  );
}
