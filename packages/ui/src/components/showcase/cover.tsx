/**
 * A cover: the 16:9 picture a showcase card, the selected carousel and a product page lead with.
 *
 * Every subject has one. An authored cover is an image the host names by URL (a card asks for
 * the thumbnail, a hero for the full picture); a subject without one — or whose image does not
 * load — wears the generated cover instead: a field in the subject's hue, a quiet motif, the
 * subject's own icon on a tile in the middle and the product's logo in the corner (the logo
 * takes the tile when the subject has no icon). The generated cover is drawn here, from nothing
 * but the seed, so it shows offline and for a package nobody has made a picture for.
 *
 * While an authored image is on its way the box holds a flat field — the image's own `tone` when
 * the host knows it, else the hue's — and the image fades in over it; the generated drawing is
 * never shown first and then replaced. The box keeps its ratio in every state, so nothing around
 * it moves.
 *
 * Shared by the Web App and the public sites: the look is showcase.css, which names no palette
 * of either and which each host's stylesheet imports (theme.css, site.css) together with its map
 * of the `--showcase-*` properties onto its own tokens. A `ui-showcase` host (hooks.ts).
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { ICONS } from "../icons/icons";
import { ImageIcon, type ImageIconSource } from "../icons/image-icon/image-icon";

/** The hues a generated cover is drawn in: the icon tints every theme already carries. */
export const COVER_HUES = [
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "slate",
] as const;
export type CoverHue = (typeof COVER_HUES)[number];

/** The motifs a generated cover's field carries, picked by the seed. */
export const COVER_MOTIFS = ["rings", "dots", "bands", "tiles"] as const;
export type CoverMotif = (typeof COVER_MOTIFS)[number];

/**
 * A well-mixed hash of the seed (FNV-1a, then an avalanche): names that share a long suffix —
 * a family of `*-rsi-toolkit` plugins — must still spread over the hues, which a plain
 * polynomial hash taken modulo a small number does not do.
 */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** A seed's hue: stable for a name, one of the eight colours (slate is for a host to ask for). */
export function coverHue(seed: string): CoverHue {
  return COVER_HUES[hash(seed) % (COVER_HUES.length - 1)]!;
}

/** A seed's motif: stable for a name, and independent of its hue. */
export function coverMotif(seed: string): CoverMotif {
  return COVER_MOTIFS[Math.floor(hash(seed) / 8) % COVER_MOTIFS.length]!;
}

/** An authored cover: the full picture, its thumbnail when there is one, and its dominant colour. */
export interface CoverSource {
  src: string;
  /** The small rendition a card draws; absent, the card draws `src`. */
  thumb?: string;
  /** The picture's dominant colour (`#rrggbb`): the field it fades in over. */
  tone?: string;
}

export interface CoverProps {
  /** The authored cover; absent or null, the generated one is drawn. */
  image?: CoverSource | null;
  /** `thumb` (default) for a card and a rail, `full` for a hero. */
  rendition?: "thumb" | "full";
  /** What the generated cover is drawn from: the subject's name. */
  seed: string;
  /** The hue, when the host has one for the subject already; else the seed's. */
  hue?: CoverHue;
  /** The subject's icon, on the generated cover's tile. */
  icon?: ImageIconSource | null;
  /** The product logo's URL: the generated cover's corner mark, or its tile without an icon. */
  logo?: string;
  /** Load the image at once (the first slide of a hero) instead of when it nears the viewport. */
  eager?: boolean;
  className?: string;
}

/**
 * The motifs, on a 160 × 90 field. Their line weight is the stylesheet's (`.showcase-art-motif`),
 * not an attribute: it is part of the look a pack may restyle. The tiles keep the lower-left
 * corner clear, where the logo's mark sits.
 */
const MOTIF: Record<CoverMotif, ReactNode> = {
  rings: (
    <g fill="none">
      <circle cx="132" cy="78" r="22" />
      <circle cx="132" cy="78" r="38" />
      <circle cx="132" cy="78" r="54" />
      <circle cx="132" cy="78" r="70" />
    </g>
  ),
  dots: (
    <g stroke="none" fill="currentColor">
      {Array.from({ length: 6 }, (_, row) =>
        Array.from({ length: 11 }, (_, col) => (
          <circle key={`${row}-${col}`} cx={10 + col * 14} cy={10 + row * 14} r="0.9" />
        )),
      )}
    </g>
  ),
  bands: (
    <g stroke="none" fill="currentColor" opacity="0.55">
      <rect x="96" y="-30" width="13" height="160" transform="rotate(32 100 45)" />
      <rect x="122" y="-30" width="7" height="160" transform="rotate(32 100 45)" />
      <rect x="140" y="-30" width="20" height="160" transform="rotate(32 100 45)" />
    </g>
  ),
  tiles: (
    <g fill="none">
      <rect x="10" y="10" width="26" height="18" rx="3" />
      <rect x="116" y="8" width="34" height="22" rx="3" />
      <rect x="124" y="56" width="26" height="26" rx="3" />
      <rect x="16" y="44" width="30" height="18" rx="3" />
    </g>
  ),
};

/** The generated cover's drawing: field, motif, the icon on its tile, the logo's mark. */
function GeneratedArt({
  seed,
  icon,
  logo,
}: {
  seed: string;
  icon?: ImageIconSource | null;
  logo?: string;
}) {
  const puzzle = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d={ICONS.puzzle} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <div className="showcase-art" data-part="art" aria-hidden>
      <svg
        className="showcase-art-motif"
        viewBox="0 0 160 90"
        preserveAspectRatio="xMidYMid slice"
        stroke="currentColor"
      >
        {MOTIF[coverMotif(seed)]}
      </svg>
      <span className="showcase-art-tile" data-part="tile">
        {icon != null ? (
          <span className="showcase-art-icon">
            <ImageIcon icon={icon} size="fill" fallback={puzzle} />
          </span>
        ) : logo !== undefined ? (
          <img src={logo} alt="" draggable={false} className="showcase-art-logo" />
        ) : (
          <span className="showcase-art-icon">{puzzle}</span>
        )}
      </span>
      {icon != null && logo !== undefined && (
        <img src={logo} alt="" draggable={false} className="showcase-art-mark" />
      )}
    </div>
  );
}

export function Cover({
  image,
  rendition = "thumb",
  seed,
  hue,
  icon,
  logo,
  eager = false,
  className = "",
}: CoverProps) {
  const url = image == null ? null : rendition === "thumb" ? (image.thumb ?? image.src) : image.src;
  // Keyed by URL: a new picture is tried, and awaited, afresh.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const pending = url !== null && failed !== url;
  const style =
    pending && image?.tone !== undefined
      ? ({ "--showcase-cover-tone": image.tone } as CSSProperties)
      : undefined;
  return (
    <div
      className={`showcase showcase-cover ui-showcase ${className}`}
      data-part="cover"
      data-hue={hue ?? coverHue(seed)}
      data-state={!pending ? "generated" : loaded === url ? "loaded" : "loading"}
      style={style}
    >
      {!pending && <GeneratedArt seed={seed} icon={icon} logo={logo} />}
      {pending && (
        <img
          key={url}
          src={url}
          alt=""
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          // A picture already in the cache is complete before React attaches the listener.
          ref={(el) => {
            if (el !== null && el.complete && el.naturalWidth > 0) setLoaded(url);
          }}
          onLoad={() => setLoaded(url)}
          onError={() => setFailed(url)}
        />
      )}
    </div>
  );
}
