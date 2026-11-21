/**
 * Sample app artwork for the boards that draw app icons: a square of one hue with a lighter disc,
 * as an SVG data URL, the way a Workbench's own icon arrives from the server as an image. Full
 * bleed, so the app icon shape's corner is what rounds it.
 */
import type { ImageIconSource } from "@prismshadow/penguin-ui";

/** The hues the sample apps cycle through. */
const HUES = [210, 150, 30, 280, 0, 180, 60, 320] as const;

/** The artwork of sample app number `n`. */
export function sampleAppArt(n: number): ImageIconSource {
  const hue = HUES[n % HUES.length];
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112">' +
    `<rect width="112" height="112" fill="hsl(${hue} 62% 52%)"/>` +
    `<circle cx="56" cy="56" r="26" fill="hsl(${hue} 80% 86%)"/></svg>`;
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, tint: false };
}
