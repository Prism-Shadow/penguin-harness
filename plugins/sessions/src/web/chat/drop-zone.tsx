import { DropOverlay } from "@prismshadow/penguin-ui";
import {
  dropRegionAction,
  isFileDrag,
  type DragSignal,
  type DropRegionAction,
} from "@prismshadow/penguin-web/internal";

import { S } from "@prismshadow/penguin-web/internal";
import { PAPERCLIP_ICON } from "@prismshadow/penguin-web/internal";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";


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
    <DropOverlay
      variant="veil"
      glyph={ICONS.paperclip}
      title={S.chat.dropFilesTitle}
      description={S.chat.dropFilesDesc}
    />,
    region,
  );
}
