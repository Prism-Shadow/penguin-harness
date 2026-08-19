/**
 * Drop target for composer attachments (#311), scoped to the chat area: dragging OS files
 * over the conversation + composer column shows a "drop to attach" overlay bounded to that
 * column, and releasing hands the batch to the composer's existing intake (images → the
 * pasted-image pipeline, everything else → the file-attachment pipeline; same validation,
 * same errors).
 *
 * Two pieces, because the region and the composer are not the same element:
 *   - `ChatDropRegion` wraps the chat column (chat-page.tsx) and publishes its DOM node
 *     through context. It is the only element a drop counts on: the sidebar, the mobile top
 *     bar, the chat toolbar and the docked Files/Subagents panels sit outside it and are
 *     inert, and pages with no chat column never render one.
 *   - `FileDropZone` stays mounted by ChatInput, which keeps "dropping works exactly when
 *     there is a composer to attach to" true by construction — chat page and draft page
 *     alike, and while a Task runs just the same. With no region above it (nothing does that
 *     today) it renders nothing and listens for nothing, rather than falling back to the
 *     window.
 *
 * The listeners are on `window` even though the target is a region, because the region only
 * needs to be the *subject* of the hit test, not the receiver: a window listener still sees
 * the drag after it has moved off the chat column — over the sidebar, over a docked panel,
 * out of the window — which is exactly when the overlay has to come down. Every event is
 * tested against the region with `contains`, so where the pointer is decides everything and
 * no state accumulates (see dropRegionAction in lib/file-drop.ts for why that matters).
 *
 * The overlay is pure feedback: `pointer-events-none` (so it never becomes the drag target
 * itself and the hit test keeps seeing the real element underneath), `aria-hidden` — it
 * exists only during a pointer drag, and the accessible entry point stays the "+" menu —
 * and `absolute inset-0` portaled into the region, on the overlay z tier (z-50).
 *
 * Interplay with the app-shell guard (see lib/file-drop.ts): over the chat area this
 * component claims the drag — preventDefault on dragover plus a copy cursor — so the guard's
 * no-drop fallback stands aside; everywhere else the guard alone runs, silently cancelling
 * the browser's navigate-to-file default so a stray drop is inert instead of destructive,
 * while non-file drags keep their native behavior. Both orders of the two window listeners
 * converge on the same outcome, so mount order cannot matter.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { dropRegionAction, isFileDrag } from "../../lib/file-drop";
import type { DragSignal, DropRegionAction } from "../../lib/file-drop";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { PAPERCLIP_ICON } from "./attached-files-banner";

/** The chat area's DOM node, or null when the composer is mounted outside a region. */
const ChatDropRegionContext = createContext<HTMLElement | null>(null);

/**
 * Marks the chat column as the one region file drops apply to. `relative` is the caller's
 * job (the overlay is positioned against this element); the element is held in state rather
 * than a ref so that consumers re-render once it exists.
 *
 * `ref={setRegion}` passes the state setter itself, not a closure over it: React re-invokes a
 * callback ref whenever its identity changes, so an inline arrow would detach (null) and
 * re-attach (element) on every render, and the pair of state updates that produces would
 * schedule the next render — a loop. A useState setter is stable for the component's life.
 */
export function ChatDropRegion({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  return (
    <div className={className} ref={setRegion}>
      <ChatDropRegionContext.Provider value={region}>{children}</ChatDropRegionContext.Provider>
    </div>
  );
}

export function FileDropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const region = useContext(ChatDropRegionContext);
  const [active, setActive] = useState(false);
  // Mirror of `active` the listeners can read: they are registered once per region, so they
  // close over the mount's render, not the current one.
  const activeRef = useRef(false);
  // Latest callback without re-registering the listeners.
  const onFilesRef = useRef(onFiles);
  useEffect(() => {
    onFilesRef.current = onFiles;
  });

  useEffect(() => {
    if (!region) return;
    /** Is this node the chat area or inside it? A null relatedTarget (drag left the window) is not. */
    const within = (node: EventTarget | null): boolean =>
      node instanceof Node && region.contains(node);
    const apply = (signal: DragSignal, e: DragEvent, inside: boolean): DropRegionAction => {
      const action = dropRegionAction(signal, isFileDrag(e.dataTransfer?.types), inside);
      // dragover fires tens of times a second; only a real change is routed through state.
      if (activeRef.current !== action.active) {
        activeRef.current = action.active;
        setActive(action.active);
      }
      if (action.claim) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }
      return action;
    };
    const onDragOver = (e: DragEvent) => {
      apply("over", e, within(e.target));
    };
    // `relatedTarget` is where the drag is going: still inside the region means an internal
    // element boundary was crossed and nothing changed.
    const onDragLeave = (e: DragEvent) => {
      apply("leave", e, within(e.relatedTarget));
    };
    const onDrop = (e: DragEvent) => {
      const action = apply("drop", e, within(e.target));
      if (!action.accept || !e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFilesRef.current(files);
    };
    const onDragEnd = (e: DragEvent) => {
      apply("end", e, false);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
      activeRef.current = false;
      setActive(false);
    };
  }, [region]);

  if (!active || !region) return null;
  return createPortal(
    <div
      aria-hidden
      className="anim-fade pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-white/70 p-6 backdrop-blur-sm dark:bg-gray-950/70"
    >
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-400 bg-white/80 px-10 py-8 text-center dark:border-gray-500 dark:bg-gray-900/80">
        <GlyphIcon d={PAPERCLIP_ICON} size={28} className="text-gray-400 dark:text-gray-500" />
        <p className="text-base font-medium text-gray-800 dark:text-gray-100">
          {S.chat.dropFilesTitle}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.chat.dropFilesDesc}</p>
      </div>
    </div>,
    region,
  );
}
