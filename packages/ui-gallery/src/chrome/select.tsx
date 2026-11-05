/**
 * The chrome's select, in the app's own idiom rather than the browser's: a drawn trigger that
 * shows the chosen option and a chevron, a panel listing the options with a check on the chosen
 * one, portaled to the body at fixed viewport coordinates so no drawer or panel clips it. What it
 * replaces is the native `<select>`, whose popup takes the platform's look, never the chrome's,
 * and cannot be told apart from the app's own drawn selects in a screenshot.
 *
 * Keyboard: on the trigger, Enter, Space or an arrow opens the list on the chosen option; in the
 * list, the arrows step, Home and End jump, a typed character jumps to the next option starting
 * with it, Enter or Space picks, Escape closes and Tab closes and moves on — every close puts the
 * focus back on the trigger first, so Tab continues from there rather than from the end of the
 * body, where the panel lives. Focus follows the active row (one option is in the tab order at a
 * time), so the row is what assistive technology reads. The panel also closes on a click outside
 * it, on a scroll that would move its trigger, and on a resize.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { nextOptionIndex, placePanel, typeaheadIndex } from "../lib/listbox";
import type { PanelPlacement } from "../lib/listbox";
import { ChromeIcon } from "./icons";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/** The rows' height and the panel's padding, as chrome.css draws them: only the flip decision reads them. */
const ROW_HEIGHT = 30;
const PANEL_PADDING = 8;

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** The control's accessible name; the visible words beside it are the caller's. */
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  const show = () => {
    setActive(selectedIndex);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    setPlacement(null);
    if (refocus) trigger.current?.focus();
  };
  const pick = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close(true);
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    setPlacement(
      placePanel(
        trigger.current.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        options.length * ROW_HEIGHT + PANEL_PADDING,
      ),
    );
  }, [open, options.length]);

  // The active row takes the focus once the panel is placed, and again whenever it moves.
  useEffect(() => {
    if (!open || !placement) return;
    const rows = panel.current?.querySelectorAll<HTMLElement>('[role="option"]');
    rows?.[active]?.focus({ preventScroll: true });
  }, [open, placement, active]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || panel.current?.contains(target)) return;
      setOpen(false);
      setPlacement(null);
    };
    // The panel's own scrolling (a long list) keeps it open; any other scroll has moved the
    // trigger the panel was placed against, and so has a resize.
    const onScroll = (event: Event) => {
      if (panel.current?.contains(event.target as Node)) return;
      setOpen(false);
      setPlacement(null);
    };
    const onResize = () => {
      setOpen(false);
      setPlacement(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const onTriggerKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      show();
    }
  };

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = nextOptionIndex(event.key, active, options.length);
    if (next !== null) {
      event.preventDefault();
      setActive(next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
      return;
    }
    if (event.key === "Escape") {
      // Stopped here so the popover or drawer holding this select stays open.
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      // Not prevented: the browser's own Tab then continues from the refocused trigger.
      close(true);
      return;
    }
    const hit = typeaheadIndex(
      event.key,
      options.map((option) => option.label),
      active,
    );
    if (hit !== null) setActive(hit);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="g-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onTriggerKey}
      >
        <span className="g-select-value">{selected?.label ?? ""}</span>
        <ChromeIcon name="chevron" size={13} />
      </button>
      {open &&
        placement &&
        createPortal(
          <div
            ref={panel}
            id={listId}
            role="listbox"
            aria-label={label}
            className="g-chrome g-listbox"
            style={{
              top: placement.top,
              bottom: placement.bottom,
              left: placement.left,
              minWidth: placement.minWidth,
            }}
            onKeyDown={onListKey}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                tabIndex={index === active ? 0 : -1}
                data-active={index === active || undefined}
                className="g-option"
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <ChromeIcon name="check" size={14} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
