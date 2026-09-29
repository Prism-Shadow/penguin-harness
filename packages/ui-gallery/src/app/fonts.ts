/**
 * What fonts a document is actually set in: the first real family of each role's stack and the
 * root size in px, read from computed styles — the framed app's when the page has one, else the
 * page's own root, which carries the same theme attributes and the same theme sheets. Pure
 * where it can be (the stack parsing is unit-tested); the reader takes a Document.
 */

/** The three roles the readout names, and the token each is read from. */
export const FONT_ROLES = {
  latin: "--ui-font-sans",
  cjk: "--ui-font-cjk",
  mono: "--ui-font-mono",
} as const;
export type FontRole = keyof typeof FONT_ROLES;

export interface FontReadout {
  latin: string;
  cjk: string;
  mono: string;
  /** The root font size, in CSS px. */
  px: number;
}

/**
 * Generic family keywords and the system aliases: a stack that opens with one of them means the
 * theme defers to the platform, which the readout says as "System" rather than naming a
 * keyword.
 */
const GENERIC: Readonly<Record<string, string>> = {
  "system-ui": "System",
  "ui-sans-serif": "System",
  "-apple-system": "System",
  blinkmacsystemfont: "System",
  "ui-monospace": "System mono",
  "ui-serif": "System serif",
  "sans-serif": "System",
  serif: "System serif",
  monospace: "System mono",
};

/** The families of a `font-family` stack, unquoted, in order; empty for an empty stack. */
export function familiesOf(stack: string): string[] {
  return stack
    .split(",")
    .map((family) =>
      family
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim(),
    )
    .filter((family) => family !== "");
}

/**
 * The family a stack is set in, as the readout names it: the first family, or "System" (and
 * its variants) when the stack opens with a generic keyword. "—" for an empty stack.
 */
export function firstFamily(stack: string): string {
  const first = familiesOf(stack)[0];
  if (first === undefined) return "—";
  return GENERIC[first.toLowerCase()] ?? first;
}

/** Reads the three roles and the root size off a document's computed styles. */
export function readFontReadout(doc: Document): FontReadout {
  const view = doc.defaultView;
  const root = doc.documentElement;
  if (!view) return { latin: "—", cjk: "—", mono: "—", px: 16 };
  const styles = view.getComputedStyle(root);
  const px = Number.parseFloat(styles.fontSize);
  return {
    latin: firstFamily(styles.getPropertyValue(FONT_ROLES.latin)),
    cjk: firstFamily(styles.getPropertyValue(FONT_ROLES.cjk)),
    mono: firstFamily(styles.getPropertyValue(FONT_ROLES.mono)),
    px: Number.isFinite(px) ? Math.round(px * 10) / 10 : 16,
  };
}

/** `Mona Sans · MiSans · JetBrains Mono · 16px`, with the role labels the caller supplies. */
export function formatFontReadout(
  readout: FontReadout,
  labels: { latin: string; cjk: string; mono: string },
): string {
  return [
    `${labels.latin} ${readout.latin}`,
    `${labels.cjk} ${readout.cjk}`,
    `${labels.mono} ${readout.mono}`,
    `${readout.px}px`,
  ].join(" · ");
}
