/**
 * What fonts a document is actually set in: for each role's stack, the first family that can
 * render — not the first family named, which is what a stack opening with "PingFang SC" on a
 * Linux box would report while Noto or the platform's sans does the work — and the root size in
 * px, read from computed styles: the framed app's when the page has one, else the page's own
 * root, which carries the same theme attributes and the same theme sheets.
 *
 * A family can render when the document bundles a face for it (a `@font-face` in
 * `document.fonts` that has not failed; a face the page has not needed yet is still the one that
 * would render), or, for a family the document does not declare, when the platform has it
 * installed. `document.fonts.check` answers neither question: it says true for any family it
 * holds no face for, installed or not, and false for a bundled face whose slices the page has not
 * needed yet. So the set's own faces and their statuses answer the first, and the platform is
 * asked the old way for the second, by measuring a sample in the family against the generic
 * fallback alone — a family that is not there measures exactly as the fallback. A stack that
 * reaches a generic keyword, or runs out, has fallen through to the platform, which the readout
 * says in words ("system").
 *
 * The resolution is pure over a probe (unit-tested); the document probe is the one place the
 * browser is asked.
 */

/** The three roles the readout names, and the token each is read from. */
export const FONT_ROLES = {
  latin: "--ui-font-sans",
  cjk: "--ui-font-cjk",
  mono: "--ui-font-mono",
} as const;
export type FontRole = keyof typeof FONT_ROLES;

export interface FontReadout {
  /** The family rendering the role, or null when the stack fell through to the platform's face. */
  latin: string | null;
  cjk: string | null;
  mono: string | null;
  /** The root font size, in CSS px. */
  px: number;
}

/** The generic families and the system aliases: a stack that reaches one of them defers to the platform. */
const GENERIC = new Set([
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "math",
  "emoji",
]);

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

/** Whether a family name is a generic keyword or a system alias rather than a face. */
export function isGenericFamily(family: string): boolean {
  return GENERIC.has(family.toLowerCase());
}

/**
 * What a document knows about a family: a bundled face that can render ("bundled"), one whose
 * every face failed to load ("failed"), or no face declared at all ("absent").
 */
export type Declared = "bundled" | "failed" | "absent";

export interface FaceProbe {
  declared(family: string): Declared;
  /** Whether the platform has a face installed under this name. Asked only for undeclared families. */
  installed(family: string): boolean;
}

/**
 * The family a stack renders in: the first that is bundled or installed, skipping a family that
 * is neither; null once the stack reaches a generic keyword or runs out.
 */
export function faceInUse(stack: string, probe: FaceProbe): string | null {
  for (const family of familiesOf(stack)) {
    if (isGenericFamily(family)) return null;
    const declared = probe.declared(family);
    if (declared === "bundled") return family;
    if (declared === "failed") continue;
    if (probe.installed(family)) return family;
  }
  return null;
}

/**
 * The sample each role is measured with. Latin letters of unequal width tell a proportional face
 * from the monospace fallback; the CJK sample keeps Latin letters too, because CJK glyphs are an
 * em wide in every face and would measure the same in any of them.
 */
const SAMPLES: Readonly<Record<FontRole, string>> = {
  latin: "mmmmmmmmmmlliI1O0",
  cjk: "中文字体样张 mmmmlliI1O0",
  mono: "mmmmmmmmmmlliI1O0",
};

/** The document's answer, for one role's sample text. */
export function documentProbe(doc: Document, sample: string): FaceProbe {
  const faces = new Map<string, FontFace[]>();
  doc.fonts.forEach((face) => {
    const family = face.family.replace(/^["']|["']$/g, "");
    const list = faces.get(family) ?? [];
    list.push(face);
    faces.set(family, list);
  });
  let context: CanvasRenderingContext2D | null | undefined;
  const width = (font: string): number => {
    if (context === undefined) context = doc.createElement("canvas").getContext("2d");
    if (!context) return 0;
    context.font = font;
    return context.measureText(sample).width;
  };
  return {
    declared(family) {
      const list = faces.get(family);
      if (!list) return "absent";
      return list.every((face) => face.status === "error") ? "failed" : "bundled";
    },
    installed(family) {
      // Measured against two fallbacks, so a face that happens to match one's metrics still
      // shows against the other.
      return ["monospace", "serif"].some(
        (fallback) => width(`72px "${family}", ${fallback}`) !== width(`72px ${fallback}`),
      );
    },
  };
}

/** Reads the three roles and the root size off a document's computed styles. */
export function readFontReadout(doc: Document): FontReadout {
  const view = doc.defaultView;
  if (!view) return { latin: null, cjk: null, mono: null, px: 16 };
  const styles = view.getComputedStyle(doc.documentElement);
  const px = Number.parseFloat(styles.fontSize);
  const role = (name: FontRole) =>
    faceInUse(styles.getPropertyValue(FONT_ROLES[name]), documentProbe(doc, SAMPLES[name]));
  return {
    latin: role("latin"),
    cjk: role("cjk"),
    mono: role("mono"),
    px: Number.isFinite(px) ? Math.round(px * 10) / 10 : 16,
  };
}

/** `Latin Mona Sans · CJK MiSans · Mono JetBrains Mono · 16px`, with the words the caller supplies. */
export function formatFontReadout(
  readout: FontReadout,
  labels: { latin: string; cjk: string; mono: string; system: string },
): string {
  const face = (family: string | null) => family ?? labels.system;
  return [
    `${labels.latin} ${face(readout.latin)}`,
    `${labels.cjk} ${face(readout.cjk)}`,
    `${labels.mono} ${face(readout.mono)}`,
    `${readout.px}px`,
  ].join(" · ");
}
