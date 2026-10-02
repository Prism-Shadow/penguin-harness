/**
 * A table's choice cell without select chrome: the current option's full title as plain text,
 * wrapping when long. Pressing it opens a small menu of the options, portaled to the body so no
 * scrolling ancestor clips it; an option this machine cannot honour stays listed, greyed out,
 * with the reason. Keyboard: Enter or Space opens it on the current option, the arrow keys move,
 * Enter picks, Esc closes (capture-phase, so an enclosing dialog stays open).
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChoiceCheck,
  menuPanelClass,
  menuRowClass,
  menuRowTone,
  usePortalPanel,
} from "@prismshadow/penguin-ui";

export interface EnumCellOption {
  value: string;
  title: string;
  /** Why this machine cannot honour it; set, the option is listed but cannot be picked. */
  unavailable?: string;
}

export function EnumCell({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: EnumCellOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const rows = useRef<Array<HTMLButtonElement | null>>([]);
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: () => setOpen(false),
    estimatedHeight: 40 + options.length * 32,
    panelWidth: 224,
  });
  const current = options.find((o) => o.value === value);
  const openAt = () => {
    setActive(Math.max(0, options.indexOf(current ?? options[0]!)));
    setOpen(true);
  };
  // The active row takes focus, so the keyboard (and a screen reader) follows it.
  useEffect(() => {
    if (open && position !== null) rows.current[active]?.focus();
  }, [open, position, active]);
  const pick = (option: EnumCellOption) => {
    if (option.unavailable !== undefined) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (option.value !== value) onChange(option.value);
  };
  const move = (by: number) =>
    setActive((i) => (i + by + options.length) % Math.max(1, options.length));
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}: ${current?.title ?? value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openAt();
          }
        }}
        // Plain text that wraps; the hover wash and the focus ring say it can be pressed.
        className="w-full rounded-md px-1.5 py-1 text-left text-xs leading-snug break-words text-fg transition-colors duration-150 hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {current?.title ?? value}
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id={listId}
            role="listbox"
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Tab") {
                setOpen(false);
              }
            }}
            className={`ui-glass ${menuPanelClass} fixed z-[60] w-56`}
            style={{ left: position.left, top: position.topPx, bottom: position.bottomPx }}
          >
            {options.map((o, i) => (
              <button
                key={o.value}
                ref={(el) => {
                  rows.current[i] = el;
                }}
                type="button"
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.unavailable !== undefined}
                tabIndex={i === active ? 0 : -1}
                onClick={() => pick(o)}
                className={`flex items-start gap-2 ${menuRowClass} text-xs ${o.unavailable !== undefined ? "cursor-not-allowed opacity-50" : ""} ${menuRowTone(o.value === value)}`}
              >
                <span className="min-w-0 flex-1">
                  {o.title}
                  {o.unavailable !== undefined && (
                    <span className="block text-fg-muted">{o.unavailable}</span>
                  )}
                </span>
                <ChoiceCheck on={o.value === value} />
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
