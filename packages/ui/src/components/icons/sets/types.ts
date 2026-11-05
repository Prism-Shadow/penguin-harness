/**
 * The keys every icon set draws. A registry glyph (`IconName`) and each of the small marks drawn
 * as components (`marks.tsx`, `chevron.tsx`) is drawn once per set, so a set's record is keyed by
 * `GlyphKey` and a key it does not draw is a type error.
 */
import type { IconName } from "../icons";

/**
 * The small marks drawn as components, by role. `caret` is the form-control caret pointing down;
 * `chevron` is the collapse chevron pointing right (the component rotates it).
 */
export type MarkName = "caret" | "check" | "plus" | "download" | "upload" | "close" | "chevron";

export type GlyphKey = IconName | MarkName;

/** 16 rows of 16 characters: "#" ink, "." empty. Row 0 is the top. */
export type PixelGrid = readonly string[];
