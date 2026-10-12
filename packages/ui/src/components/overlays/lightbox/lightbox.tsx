/**
 * The lightbox: an image shown large over the page, in a bordered frame with a close glyph in the
 * top-right corner (no title bar), closable via Esc or clicking the overlay. `ZoomableImage` is the
 * thumbnail that opens it: the thumbnail keeps the caller's styling, and a click zooms in.
 *
 * The lightbox is rendered via portal to body — the thumbnail may be nested inside a card with a
 * transform entrance animation or overflow-hidden, and a `fixed` layer rendered in place would get
 * hijacked or clipped by that ancestor (the same reason the Select panel portals). Escape goes
 * through the shared Escape-layer stack like every other overlay's, so a lightbox opened from
 * inside a dialog closes alone and leaves the dialog up.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useUiStrings } from "../../../strings";
import { CloseIcon } from "../../icons/marks/marks";
import { useEscLayer } from "../esc-layers/esc-layers";

export interface LightboxProps {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
  /** The close glyph's accessible name; defaults to the interface's word for "close". */
  closeLabel?: string;
}

export function Lightbox({ open, src, alt, onClose, closeLabel }: LightboxProps) {
  const strings = useUiStrings();
  useEscLayer(open, onClose);

  if (!open) return null;
  return createPortal(
    <div
      // ui-scrim: the overlay is the dimmed layer, with the image inside it.
      className="ui-scrim anim-fade fixed inset-0 z-50 flex items-center justify-center bg-[var(--ui-overlay-backdrop)] p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="anim-pop relative">
        {/* Close glyph: top-right inside the frame, floating over the image on a translucent
            disc of the ink colour, which keeps it visible on any image. */}
        <button
          type="button"
          aria-label={closeLabel ?? strings.close}
          onClick={onClose}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-fg/50 text-canvas transition-colors duration-150 hover:bg-fg/70"
        >
          <CloseIcon />
        </button>
        <img
          src={src}
          alt={alt}
          className="max-h-[85vh] max-w-[88vw] rounded-lg border border-line bg-surface"
        />
      </div>
    </div>,
    document.body,
  );
}

/** A clickable image that opens itself in the {@link Lightbox}. */
export function ZoomableImage({
  src,
  alt,
  className,
  closeLabel,
  lazy = false,
}: {
  src: string;
  alt: string;
  /** Style for the thumbnail img (keeps the caller's original class). */
  className?: string;
  /** The lightbox's close glyph's accessible name; defaults to the interface's word for "close". */
  closeLabel?: string;
  /** Fetch the thumbnail only as it nears the viewport (a long list of fetched images, e.g. a transcript's). */
  lazy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="block cursor-zoom-in" onClick={() => setOpen(true)}>
        <img src={src} alt={alt} className={className} loading={lazy ? "lazy" : undefined} />
      </button>
      <Lightbox
        open={open}
        src={src}
        alt={alt}
        onClose={() => setOpen(false)}
        closeLabel={closeLabel}
      />
    </>
  );
}
