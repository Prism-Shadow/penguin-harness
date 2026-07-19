/**
 * Clickable image that zooms in on click. The thumbnail keeps the caller's styling;
 * clicking it opens a lightbox: a bordered image panel with a close glyph in the
 * top-right corner (no title bar), closable via Esc or clicking the overlay.
 * The lightbox is rendered via portal to body — the thumbnail may be nested inside
 * a card with a transform entrance animation or overflow-hidden, and a `fixed`
 * layer rendered in place would get hijacked/clipped by that ancestor (same fix
 * as the Select dropdown).
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { S } from "../../lib/strings";

export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  /** Style for the thumbnail img (keeps the caller's original class). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="block cursor-zoom-in" onClick={() => setOpen(true)}>
        <img src={src} alt={alt} className={className} />
      </button>
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="anim-pop relative">
        {/* Close glyph: top-right inside the frame, floating over the image (dark semi-transparent background keeps it visible on any image). */}
        <button
          type="button"
          aria-label={S.common.close}
          onClick={onClose}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white transition-colors duration-150 hover:bg-black/70"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
            <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
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
