/**
 * What a message carries besides its text — the images and files attached to it — drawn the same
 * way wherever they show: staged in the composer, in the message once it is sent, and inside a
 * steer's chip. Every word arrives as a prop.
 *
 * - `AttachmentList` is the row they sit in: one wrapping row with even gaps, in the caller's
 *   order (images, then files), kept to the start or the end of its box.
 * - `AttachmentImage` is an image tile of a fixed height whose width follows the image's own
 *   ratio between two bounds, so a row of them lines up. Past a bound — a panorama, a tall strip —
 *   or for an image smaller than the tile, the picture is fitted inside the tile on a neutral
 *   fill: shown whole at its own ratio, never stretched, never cropped, never enlarged past its
 *   pixels. A click opens it large. An image that fails to load keeps a square tile with the
 *   image glyph, the reason in its hint.
 * - `AttachmentFile` is a file tile at the small image height: the glyph of the file's kind, its
 *   name — one line that gives way first, whole on hover — and under it the extension and, when
 *   the caller knows it, the size.
 *
 * Both tiles take the box radius, `rounded-md` like the composer's chips, and their border sits
 * on the box that clips. Never the control radius (`rounded-control`): a theme may draw controls
 * as pills — Frost does, at 9999px — and on a box that is not square that radius turns the tile
 * into a stadium, which is how a sent image used to read as an ellipse.
 *
 * A tile has a remove button when the caller names it (`removeLabel`): staged in the composer it
 * can be taken back, sent it cannot. The button stays on screen — touch has no hover — and a long
 * name truncates before it is pushed out. On an image it sits in the corner on a disc of the ink
 * colour, which keeps it visible on any picture.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { CloseIcon } from "../../icons/marks/marks";
import { Lightbox } from "../../overlays/lightbox/lightbox";

/** The row attachments sit in. */
export function AttachmentList({
  align = "start",
  children,
}: {
  /** Which edge the row keeps to: `end` beside a sent message, `start` inside a box. */
  align?: "start" | "end";
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="attachments"
      className={`flex min-w-0 flex-wrap items-start gap-2 ${align === "end" ? "justify-end" : ""}`}
    >
      {children}
    </div>
  );
}

/** `sm` in the composer and a steer's chip, `md` in a sent message. */
export type AttachmentImageSize = "sm" | "md";

/**
 * The tile's height per size, its border included, so an image tile and a file tile of one size
 * stand exactly as tall.
 */
const IMAGE_HEIGHT: Record<AttachmentImageSize, string> = { sm: "h-14", md: "h-36" };

/**
 * The bounds the tile's width keeps to. Between them the width is the tile's height times the
 * image's ratio; `object-scale-down` fits the picture whole when a bound wins. The upper bound
 * sits on the tile, not the picture: a percentage on the picture would not hold back the width the
 * picture asks its tile for, and the tile would stand wider than what it shows. It sits on the
 * row's item (the tile and its remove button), for the same reason one level up.
 */
const IMAGE_MAX_WIDTH: Record<AttachmentImageSize, string> = {
  sm: "max-w-[min(100%,calc(var(--spacing)*40))]",
  md: "max-w-[min(100%,28rem)]",
};
const IMAGE_MIN_WIDTH: Record<AttachmentImageSize, string> = { sm: "min-w-10", md: "min-w-14" };

/** The tile that stands in for an image that did not load: a square of the image's height. */
const UNAVAILABLE_BOX: Record<AttachmentImageSize, string> = {
  sm: "size-14",
  md: "size-36",
};

/** The remove button over an image: a disc of the ink colour in the tile's corner. */
const IMAGE_REMOVE =
  "absolute right-1 top-1 flex size-5 items-center justify-center rounded-[var(--ui-radius-pill)] bg-fg/60 text-canvas transition-colors duration-150 hover:bg-fg/80";

export interface AttachmentImageProps {
  src: string;
  /** What the image is, for a screen reader and for the lightbox. */
  alt: string;
  size?: AttachmentImageSize;
  /** Fetch only as it nears the viewport: a transcript's images arrive by reference, one request each. */
  lazy?: boolean;
  /** The hint and the name of the tile that stands in for an image that did not load; `alt` when absent. */
  unavailableLabel?: string;
  /** The remove button's accessible name; without it the tile has no remove button. */
  removeLabel?: string;
  onRemove?: () => void;
  /** The lightbox's close glyph's accessible name; the interface's word for "close" when absent. */
  closeLabel?: string;
}

export function AttachmentImage({
  src,
  alt,
  size = "sm",
  lazy = false,
  unavailableLabel,
  removeLabel,
  onRemove,
  closeLabel,
}: AttachmentImageProps) {
  const [open, setOpen] = useState(false);
  // The source that failed, not a flag: a tile handed another image (a row whose earlier image
  // was removed) tries the new one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  return (
    <div data-slot="attachment" className={`anim-pop relative shrink-0 ${IMAGE_MAX_WIDTH[size]}`}>
      {failed ? (
        <span
          role="img"
          aria-label={unavailableLabel ?? alt}
          {...(unavailableLabel !== undefined ? { "data-tooltip": unavailableLabel } : {})}
          className={`flex ${UNAVAILABLE_BOX[size]} items-center justify-center rounded-md border border-line bg-surface-muted text-fg-subtle`}
        >
          <GlyphIcon d={ICONS.image} size={ICON_SIZE.sectionMark} />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`block ${IMAGE_HEIGHT[size]} max-w-full cursor-zoom-in overflow-hidden rounded-md border border-line bg-surface-muted`}
        >
          <img
            src={src}
            alt={alt}
            loading={lazy ? "lazy" : undefined}
            decoding="async"
            onError={() => setFailedSrc(src)}
            className={`block h-full w-auto max-w-full object-scale-down ${IMAGE_MIN_WIDTH[size]}`}
          />
        </button>
      )}
      {removeLabel !== undefined && (
        <button type="button" aria-label={removeLabel} onClick={onRemove} className={IMAGE_REMOVE}>
          <CloseIcon />
        </button>
      )}
      <Lightbox
        open={open && !failed}
        src={src}
        alt={alt}
        onClose={() => setOpen(false)}
        {...(closeLabel !== undefined ? { closeLabel } : {})}
      />
    </div>
  );
}

/** What a file is, by its extension, as far as its glyph says. */
type FileKind = "text" | "code" | "archive" | "image" | "other";

const KIND_GLYPH: Record<FileKind, string> = {
  text: ICONS.textLines,
  code: ICONS.angleBrackets,
  archive: ICONS.archive,
  image: ICONS.image,
  other: ICONS.file,
};

const KIND_OF_EXTENSION: Readonly<Record<string, FileKind>> = Object.fromEntries([
  ...["txt", "md", "markdown", "log", "csv", "tsv", "rtf", "rst"].map((e) => [e, "text"]),
  ...[
    "js",
    "mjs",
    "cjs",
    "ts",
    "tsx",
    "jsx",
    "py",
    "rs",
    "go",
    "java",
    "kt",
    "c",
    "h",
    "cc",
    "cpp",
    "hpp",
    "cs",
    "rb",
    "php",
    "swift",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "sql",
    "json",
    "jsonl",
    "yaml",
    "yml",
    "toml",
    "xml",
    "html",
    "css",
    "scss",
    "ipynb",
  ].map((e) => [e, "code"]),
  ...["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst"].map((e) => [e, "archive"]),
  ...["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "heic", "avif", "tif", "tiff"].map(
    (e) => [e, "image"],
  ),
]);

/** A name's extension, lower-cased, or "" when it has none worth naming (`Makefile`, `.env`). */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

export interface AttachmentFileProps {
  /** The file's name, shown whole on hover when it does not fit. */
  name: string;
  /** Its size, formatted by the caller (`1.2 MB`); absent when not known. */
  size?: string;
  /** The remove button's accessible name; without it the tile has no remove button. */
  removeLabel?: string;
  onRemove?: () => void;
}

export function AttachmentFile({ name, size, removeLabel, onRemove }: AttachmentFileProps) {
  const ext = extensionOf(name);
  const facts = [ext.toUpperCase(), size ?? ""].filter((part) => part !== "").join(" · ");
  return (
    <div
      data-slot="attachment"
      className={`anim-pop flex h-14 w-56 max-w-full shrink-0 items-center gap-2 rounded-md border border-line bg-surface pl-3 ${removeLabel !== undefined ? "pr-1" : "pr-3"}`}
    >
      <GlyphIcon
        d={KIND_GLYPH[KIND_OF_EXTENSION[ext] ?? "other"]}
        size={ICON_SIZE.sectionMark}
        className="shrink-0 text-fg-muted"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-fg">{name}</span>
        {facts !== "" && <span className="truncate text-xs text-fg-subtle">{facts}</span>}
      </span>
      {removeLabel !== undefined && (
        <button
          type="button"
          aria-label={removeLabel}
          onClick={onRemove}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors duration-150 hover:text-fg"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
