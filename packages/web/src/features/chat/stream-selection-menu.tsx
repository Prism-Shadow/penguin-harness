/**
 * The conversation's own menu for selected text: a secondary click — or Shift+F10, or the
 * keyboard's Menu key — on a selection inside the message stream offers Copy and Add to
 * conversation. The rules (which gestures it takes, which rows it shows, where a keyboard-opened
 * menu hangs, what an excerpt becomes) are pure and live in lib/selection-menu.ts; this half
 * reads the DOM and runs the rows.
 *
 * It is the Files panel preview's selection menu applied to the conversation, and it borrows
 * that menu's parts instead of copying them: `useRowContextMenu` for the anchored open state
 * and its dismissal, the `Dropdown` in `anchorRect` mode for the panel, the overflow-menu row
 * styling, and `restoreSelection` for the highlight. It is also what gives the desktop app a
 * copy menu for conversation text, since Electron raises no context menu of its own.
 *
 * Whatever the rules decline is left to the browser untouched: `preventDefault` runs only once
 * the rules have taken the gesture, inside the stream's own handler, so a right-click with no
 * selection, on a field, or on a selection that runs out of the stream still gets the native
 * menu. A touch or pen press-and-hold is declined outright — the OS selection menu owns that
 * gesture — which is why none of the hook's press-and-hold handlers are spread here.
 */
import { useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { S } from "../../lib/strings";
import { STAT_ICONS } from "../../lib/stat-icons";
import { contextMenuAnchor, isContextMenuKey } from "../../lib/context-menu";
import type { AnchorRect, ContextMenuEventLike } from "../../lib/context-menu";
import {
  SELECTION_MENU_ITEMS,
  excerptReference,
  opensSelectionMenu,
  selectionEndAnchor,
} from "../../lib/selection-menu";
import type { ComposerReference } from "../../lib/workspace-tree";
import { useRowContextMenu } from "../../components/ui/context-menu";
import { writeClipboard } from "../../components/ui/copy-button";
import { Dropdown } from "../../components/ui/dropdown";
import { ADD_TO_CHAT_ICON } from "../../components/ui/icons";
import { overflowMenuGlyph, overflowMenuRowClass } from "../../components/ui/session-row-menu";
import { restoreSelection } from "../../components/ui/text-selection";
import { toastSuccess } from "../../components/ui/toast";

/** The selection a gesture opened the menu on, captured before anything could collapse it. */
export interface CapturedSelection {
  /** What was selected, as the selection itself reads it. */
  text: string;
  /**
   * The range, cloned at the gesture: the live one follows the document's selection, which the
   * composer clears the moment it takes focus to receive the excerpt.
   */
  range: Range;
}

/**
 * The menu's rows, in SELECTION_MENU_ITEMS order. Copy writes the selection to the clipboard
 * and confirms with a toast: a row closes under the pointer, so it cannot carry the copy
 * button's at-the-control feedback (the Files panel's copy-path row confirms the same way).
 * Add to conversation hands the excerpt to the composer as a chip; nothing already typed is
 * touched and nothing is sent.
 */
export function SelectionMenuRows({
  selection,
  onAddExcerpt,
  onDone,
}: {
  selection: CapturedSelection;
  /** Stages the excerpt in this conversation's composer. */
  onAddExcerpt: (reference: ComposerReference) => void;
  /** Runs after either row has acted: closes the panel and puts the highlight back. */
  onDone: (selection: CapturedSelection) => void;
}) {
  return (
    <>
      {SELECTION_MENU_ITEMS.map((item) =>
        item === "copy" ? (
          <button
            key={item}
            type="button"
            className={overflowMenuRowClass}
            onClick={() => {
              writeClipboard(selection.text);
              toastSuccess(S.common.copied);
              onDone(selection);
            }}
          >
            {overflowMenuGlyph(STAT_ICONS.copy)}
            {S.common.copy}
          </button>
        ) : (
          <button
            key={item}
            type="button"
            className={overflowMenuRowClass}
            onClick={() => {
              onAddExcerpt(excerptReference(selection.text));
              onDone(selection);
            }}
          >
            {overflowMenuGlyph(ADD_TO_CHAT_ICON)}
            {S.files.addToChat}
          </button>
        ),
      )}
    </>
  );
}

/** A viewport box as the anchoring rules take it. */
const toAnchor = (r: DOMRect): AnchorRect => ({
  top: r.top,
  bottom: r.bottom,
  left: r.left,
  right: r.right,
});

/** Fields whose own context menu (paste, spelling) is the one that belongs to them. */
const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** Is the node inside such a field? */
function inEditable(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return element !== null && element.closest(EDITABLE_SELECTOR) !== null;
}

export interface StreamSelectionMenu {
  /** Whether the menu is open: the stream holds its auto-follow while it is (see stream-follow.ts). */
  open: boolean;
  /** Attach to the stream's scroll container: the element a selection has to lie inside. */
  hostRef: (el: HTMLElement | null) => void;
  /** Spread onto the same element. */
  hostProps: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onContextMenu: (e: ReactMouseEvent) => void;
    onKeyDown: (e: ReactKeyboardEvent) => void;
  };
  /** The portaled panel: render it anywhere in the stream's own tree. */
  panel: ReactNode;
}

export function useStreamSelectionMenu(
  onAddExcerpt: (reference: ComposerReference) => void,
): StreamSelectionMenu {
  // The row hook's anchor state and dismissal, with the stream as its "row": its owner is what a
  // scroll must move for the panel to close, and that is the stream's own scroll.
  const menu = useRowContextMenu();
  const [captured, setCaptured] = useState<CapturedSelection | null>(null);
  /**
   * The pointer that last pressed inside the stream. A `contextmenu` event is a PointerEvent in
   * current Chromium, which names its pointer itself; elsewhere it is a plain MouseEvent, and
   * the press that preceded it is the only witness to whether a finger raised it.
   */
  const lastPointer = useRef("");
  /** Where Escape hands focus back: the element inside the stream that held it when the menu opened, if any. */
  const focusBefore = useRef<HTMLElement | null>(null);

  /** Opens the menu on the document's selection if the rules take this gesture; returns whether it did. */
  const openOnSelection = (
    target: EventTarget | null,
    gesture: ContextMenuEventLike,
    pointerType: string,
  ): boolean => {
    const host = menu.anchorOwner();
    // Events raised in the portaled panel reach this handler through React's tree; only a
    // gesture that really happened inside the stream counts.
    if (host === null || !(target instanceof Node) || !host.contains(target)) return false;
    const selection = window.getSelection();
    const range =
      selection !== null && selection.rangeCount > 0 && !selection.isCollapsed
        ? selection.getRangeAt(0)
        : null;
    // The text is the whole selection's, so the rules take its range count too: a selection
    // of several ranges reads text this one range cannot vouch for (see opensSelectionMenu).
    const selectedText = range !== null && selection !== null ? selection.toString() : "";
    const opens = opensSelectionMenu({
      selectedText,
      rangeCount: selection?.rangeCount ?? 0,
      firstRangeInStream: range !== null && host.contains(range.commonAncestorContainer),
      pointerType,
      onEditable: inEditable(target),
    });
    if (!opens || range === null) return false;
    const next: CapturedSelection = { text: selectedText, range: range.cloneRange() };
    setCaptured(next);
    const active = document.activeElement;
    focusBefore.current = active instanceof HTMLElement && host.contains(active) ? active : null;
    // Put back at once, as the Files preview does: the press that asked for the menu, and the
    // panel taking focus, can each collapse the highlight the menu is about to act on.
    restoreSelection(next.range);
    const lineBoxes = Array.from(range.getClientRects(), toAnchor);
    menu.openAt(
      contextMenuAnchor(
        gesture,
        selectionEndAnchor(lineBoxes, toAnchor(range.getBoundingClientRect())),
      ),
    );
    return true;
  };

  const hostProps: StreamSelectionMenu["hostProps"] = {
    onPointerDown: (e) => {
      lastPointer.current = e.pointerType;
    },
    onContextMenu: (e) => {
      const named = (e.nativeEvent as MouseEvent & { pointerType?: unknown }).pointerType;
      const pointerType = typeof named === "string" && named !== "" ? named : lastPointer.current;
      if (openOnSelection(e.target, e, pointerType)) e.preventDefault();
    },
    onKeyDown: (e) => {
      if (!isContextMenuKey(e)) return;
      // No pointer: the anchoring rule reads (0, 0) with no button as the keyboard asking.
      if (openOnSelection(e.target, { button: 0, clientX: 0, clientY: 0 }, "")) e.preventDefault();
    },
  };

  const done = (selection: CapturedSelection) => {
    menu.close();
    // Scheduled after the composer's own focus frame (addReference schedules that one first),
    // so the highlight comes back after the focus that cleared it.
    restoreSelection(selection.range);
  };

  const panel = (
    <Dropdown
      open={menu.open && captured !== null}
      setOpen={menu.setOpen}
      portal={{ direction: "down", align: "left" }}
      anchorRect={menu.anchor}
      anchorOwner={menu.anchorOwner}
      returnFocus={() => focusBefore.current}
      className="contents"
      menuClass="w-max min-w-36 max-w-[calc(100vw-2rem)]"
      button={null}
    >
      {captured !== null && (
        <SelectionMenuRows selection={captured} onAddExcerpt={onAddExcerpt} onDone={done} />
      )}
    </Dropdown>
  );

  return { open: menu.open && captured !== null, hostRef: menu.rowRef, hostProps, panel };
}
