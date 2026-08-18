/**
 * Full-window drop target for composer attachments (#311): while the composer is mounted,
 * dragging OS files anywhere over the window shows a full-area "drop to attach" overlay, and
 * releasing hands the batch to the composer's existing intake (images → the pasted-image
 * pipeline, everything else → the file-attachment pipeline; same validation, same errors).
 *
 * The listeners live on `window` rather than on a container element, for three reasons:
 * the issue's ask is literally "drag onto the window"; the composer is what a drop feeds, so
 * mounting the zone with it is what makes "drop works exactly when the composer is available"
 * true by construction (chat page and draft page alike, including while a Task runs); and a
 * window listener still sees drops released over elements with their own drag handling (the
 * sidebar's reorder rows), which ignore file drags without stopping propagation.
 *
 * The overlay is pure feedback: `pointer-events-none`, `aria-hidden` (it exists only during a
 * pointer drag; the accessible entry point stays the "+" menu), portaled to <body> like Modal
 * so no ancestor transform can re-anchor its fixed position, on the overlay z tier (z-50).
 * The drop itself is caught at the window level, so releasing anywhere counts — there is no
 * inner "hole" the user can miss.
 *
 * Interplay with the app-shell guard (see lib/file-drop.ts): while a file drag is over the
 * window this component claims it — preventDefault on dragover plus a copy cursor — so the
 * guard's no-drop fallback stands aside; everywhere else (no composer, or a non-file drag)
 * the guard alone runs and native behavior for text drags is preserved. Both orders of the
 * two window listeners converge on the same outcome, so mount order cannot matter.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isFileDrag, nextDragDepth } from "../../lib/file-drop";
import type { DragDepthEvent } from "../../lib/file-drop";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { PAPERCLIP_ICON } from "./attached-files-banner";

export function FileDropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [active, setActive] = useState(false);
  // Depth lives in a ref: dragenter/dragleave fire for every element boundary, and routing
  // each through state would re-register nothing but still churn renders; only the derived
  // boolean is state (setState with an unchanged value bails out of re-rendering).
  const depthRef = useRef(0);
  // Latest callback without re-registering the window listeners (they are mount-scoped).
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    const update = (event: DragDepthEvent, fileDrag: boolean) => {
      depthRef.current = nextDragDepth(depthRef.current, event, fileDrag);
      setActive(depthRef.current > 0);
    };
    const onDragEnter = (e: DragEvent) => update("enter", isFileDrag(e.dataTransfer?.types));
    const onDragLeave = (e: DragEvent) => update("leave", isFileDrag(e.dataTransfer?.types));
    const onDragOver = (e: DragEvent) => {
      if (depthRef.current === 0) return;
      // Claim the drag: cancelling dragover is what makes the later drop event fire at all,
      // and marks the event handled so the shell guard leaves the cursor as "copy".
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      const wasActive = depthRef.current > 0;
      update("drop", true);
      if (!wasActive || !e.dataTransfer) return;
      // Cancel the browser's default open-file navigation (the guard would too; being
      // self-sufficient here keeps the zone correct even standalone).
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFilesRef.current(files);
    };
    // dragend only fires for drags that STARTED in this page (OS file drags end with
    // drop/dragleave instead) — it is the reset for in-page drag sources, kept for symmetry
    // and cheap insurance.
    const onDragEnd = () => update("end", true);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  if (!active) return null;
  return createPortal(
    <div
      aria-hidden
      className="anim-fade pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/70 p-6 backdrop-blur-sm dark:bg-gray-950/70"
    >
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-400 bg-white/80 px-10 py-8 text-center dark:border-gray-500 dark:bg-gray-900/80">
        <GlyphIcon d={PAPERCLIP_ICON} size={28} className="text-gray-400 dark:text-gray-500" />
        <p className="text-base font-medium text-gray-800 dark:text-gray-100">
          {S.chat.dropFilesTitle}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.chat.dropFilesDesc}</p>
      </div>
    </div>,
    document.body,
  );
}
