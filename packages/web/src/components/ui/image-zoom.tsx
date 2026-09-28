/**
 * Clickable image that zooms in on click. The thumbnail keeps the caller's styling;
 * clicking it opens a lightbox: a bordered image panel with a close glyph in the
 * top-right corner (no title bar), closable via Esc or clicking the overlay.
 * The lightbox is rendered via portal to body — the thumbnail may be nested inside
 * a card with a transform entrance animation or overflow-hidden, and a `fixed`
 * layer rendered in place would get hijacked/clipped by that ancestor (same fix
 * as the Select dropdown).
 *
 * The lightbox is a named dialog (the image's `alt`) that joins Modal's Escape stack, so
 * Escape inside a dialog-hosted thumbnail closes only the lightbox; focus moves to its close
 * button and returns to the thumbnail when it closes.
 * No test mounts it inside a Modal (the web unit tests have no DOM); the Modal case relies on
 * the lightbox pushing its Escape layer after the Modal's and on Modal's Tab handler skipping
 * keydowns this dialog has already handled (defaultPrevented).
 */
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { S } from "../../lib/strings";
import { CloseIcon } from "./icons";
import { isTopEscLayer, popEscLayer, pushEscLayer } from "./modal";

export function ZoomableImage({
  src,
  alt,
  className,
  onLoad,
  onError,
}: {
  src: string;
  alt: string;
  /** Style for the thumbnail img (keeps the caller's original class). */
  className?: string;
  /** Forwarded to the thumbnail img. */
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  /** Forwarded to the thumbnail img. */
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        className="block max-w-full cursor-zoom-in"
        onClick={() => setOpen(true)}
      >
        <img src={src} alt={alt} className={className} onLoad={onLoad} onError={onError} />
      </button>
      {open && (
        <Lightbox
          src={src}
          alt={alt}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  // Latest-callback ref so the layer is pushed once per opening, not on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const layer = pushEscLayer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopEscLayer(layer)) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      popEscLayer(layer);
    };
  }, []);

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-10"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // Without this the mousedown's default focus change runs after the overlay is gone
        // and moves focus to <body>, undoing the return to the thumbnail.
        e.preventDefault();
        onClose();
      }}
      // Portaled, yet still a React child of the thumbnail's parents: keep clicks in here
      // from reaching a clickable card the thumbnail sits in.
      onClick={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={alt || undefined}
        // Focusable so a click on the (unfocusable) image keeps focus inside the dialog,
        // where the Tab handler below still sees the next keydown.
        tabIndex={-1}
        className="anim-pop relative outline-none"
        onKeyDown={(e) => {
          // The close button is the only control: Tab stays on it.
          if (e.key !== "Tab") return;
          e.preventDefault();
          closeRef.current?.focus();
        }}
      >
        {/* Close glyph: top-right inside the frame, floating over the image (dark semi-transparent background keeps it visible on any image). */}
        <button
          ref={closeRef}
          type="button"
          aria-label={S.common.close}
          onClick={onClose}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white transition-colors duration-150 hover:bg-black/70"
        >
          <CloseIcon />
        </button>
        <img
          src={src}
          alt={alt}
          className="max-h-[85vh] max-w-[88vw] rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
        />
      </div>
    </div>,
    document.body,
  );
}
