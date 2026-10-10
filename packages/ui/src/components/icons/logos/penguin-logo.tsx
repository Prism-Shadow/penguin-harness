/**
 * The brand logo (the coloured penguin emblem). The asset is the app's — it also serves as the
 * favicon — so the caller passes its URL. The image is a square on a white background, with
 * `className` controlling size and rounded-corner cropping: it blends into the page in light mode
 * and reads as an app-icon-style white rounded square in dark mode. Purely decorative, hidden from
 * screen readers.
 */
export function PenguinLogo({ src, className }: { src: string; className?: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={`select-none ${className ?? "h-9 w-9 rounded-lg"}`}
    />
  );
}
