/**
 * The activity workspace shell: a pinned header, a rail and a detail pane that fill the
 * viewport and scroll separately, so the page itself never scrolls.
 *
 * Height comes from the app shell, which hands a page a `min-h-0 flex-1 overflow-hidden`
 * main element; this fills it with `h-full` and each pane owns its own scrolling, which
 * is the same contract the chat page keeps. The divider follows the workspace file
 * browser's: a real `separator` that drags and also moves by keyboard, with its width
 * remembered only on release rather than on every frame.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Chevron } from "../../components/ui/chevron";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import {
  RAIL_MAX_WIDTH,
  RAIL_MIN_WIDTH,
  clampRailWidth,
  railFitsBeside,
  railWidthAfterKey,
  railWidthFor,
  readRailCollapsed,
  readRailWidth,
  writeRailCollapsed,
  writeRailWidth,
} from "./workspace-model";

export function ActivityWorkspace({
  header,
  notices,
  rail,
  children,
}: {
  header: ReactNode;
  /** Banners that belong to the whole activity, under the header and above the panes. */
  notices?: ReactNode;
  /**
   * Given a way to dismiss itself, for the narrow layout where the rail covers the work
   * and a choice should hand the workspace back.
   */
  rail: (dismiss: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [width, setWidth] = useState(() => readRailWidth());
  const [collapsed, setCollapsed] = useState(() => readRailCollapsed());
  const [dragging, setDragging] = useState(false);
  const [available, setAvailable] = useState(0);
  // On a workspace too narrow to hold both, the rail is a menu over the work rather than
  // a column beside it, so it starts shut and is never remembered that way: a phone
  // should not decide how the rail opens on a desktop.
  const [narrowOpen, setNarrowOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endDrag = useRef<(() => void) | null>(null);

  // The rail gives way on a narrow window rather than squeezing the editor past the
  // point where it can show two previews side by side.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setAvailable(body.clientWidth);
    measure();
    // Both, deliberately. The observer catches the width changing without the window
    // doing so — a sidebar collapsing, a dock opening — and the window listener catches
    // the window itself, which is the case a quiet or unsupported observer would miss.
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(body);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);

  const beside = railFitsBeside(available);
  const open = beside ? !collapsed : narrowOpen;
  const applied = !open ? 0 : beside ? railWidthFor(width, available) : available;

  // A drag that never sees its pointerup — the system claiming a touch gesture, or this
  // workspace unmounting mid-drag — would otherwise leave the move listener installed.
  useEffect(() => () => endDrag.current?.(), []);

  // Opening the rail on a narrow workspace is a temporary answer to having no room for
  // both. Once there is room the answer no longer applies, and keeping it would cover
  // the editor the next time the window narrows.
  useEffect(() => {
    if (beside) setNarrowOpen(false);
  }, [beside]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const body = bodyRef.current;
    if (!body) return;
    // A second pointer on the divider before the first lets go would otherwise strand
    // the first drag's listeners, which keep moving the rail and are never removed.
    endDrag.current?.();
    event.preventDefault();
    setDragging(true);
    const left = body.getBoundingClientRect().left;
    const move = (point: PointerEvent) => setWidth(clampRailWidth(point.clientX - left));
    const release = () => {
      setDragging(false);
      endDrag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", release);
    };
    const done = (point: PointerEvent) => {
      const next = clampRailWidth(point.clientX - left);
      setWidth(next);
      writeRailWidth(next);
      release();
    };
    // A cancelled drag keeps the width the pointer last reached, which is what is on
    // screen; only the listeners go.
    endDrag.current = release;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", release);
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Step from the width on screen, not the remembered one: a narrow window may be
    // showing less than was stored, and starting from the stored value would move the
    // remembered number without moving the rail.
    const next = railWidthAfterKey(applied, event.key, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    setWidth(next);
    writeRailWidth(next);
  }

  function toggle() {
    if (!beside) {
      setNarrowOpen((current) => !current);
      return;
    }
    setCollapsed((current) => {
      writeRailCollapsed(!current);
      return !current;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-950">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
        {header}
      </div>
      {notices && (
        <div className="shrink-0 space-y-2 border-b border-gray-200 px-4 py-2 empty:hidden dark:border-gray-800">
          {notices}
        </div>
      )}
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        <div
          style={open ? { width: `${applied}px` } : undefined}
          className={`flex min-h-0 shrink-0 flex-col border-gray-200 dark:border-gray-800 ${
            open ? "" : "w-auto border-r"
          }`}
        >
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-200 px-2 py-1.5 dark:border-gray-800">
            {open && (
              <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium">
                {S.activities.workspaceRail}
              </span>
            )}
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? S.activities.railCollapse : S.activities.railExpand}
              title={open ? S.activities.railCollapse : S.activities.railExpand}
              onClick={toggle}
              className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Chevron
                open={false}
                size={ICON_SIZE.chevronDense}
                className={`text-gray-500 ${open ? "rotate-180" : ""}`}
              />
            </button>
          </div>
          {open && rail(() => setNarrowOpen(false))}
        </div>
        {open && beside && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={S.activities.railWidth}
            aria-valuenow={applied}
            aria-valuemin={RAIL_MIN_WIDTH}
            aria-valuemax={RAIL_MAX_WIDTH}
            title={S.activities.railWidth}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            className={`w-1.5 shrink-0 cursor-col-resize outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400/60 ${
              dragging
                ? "bg-gray-300 dark:bg-gray-600"
                : "bg-transparent hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          />
        )}
        {/* Too narrow for both, and the rail is open: the rail has the workspace. */}
        {(beside || !open) && children}
      </div>
    </div>
  );
}
