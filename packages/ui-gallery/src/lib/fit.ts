/**
 * Fitting a composition that is designed at the app's own width (`Module.viewport`) into a card:
 * the composition lays out at its natural width and the result is scaled down to the room the
 * card has, never up. Pure, so the rule is unit-tested; chrome/fit.tsx measures and applies it.
 */
import type { Module } from "../../../ui/src/module";

/** The padding `/embed` puts on each side of a composition (`.g-embed`); the hero goes edge to edge. */
export const EMBED_PADDING = 24;

/**
 * The width a module's composition lays out at before it is fitted, or `null` when it reflows to
 * whatever width it is given.
 */
export function naturalWidth(module: Pick<Module, "viewport">): number | null {
  const width = module.viewport;
  return typeof width === "number" && Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * The factor that fits `natural` px into `available` px. Never above 1: a narrow card shrinks the
 * composition, a wide one centres it at its natural size rather than blowing it up. A width not
 * measured yet (0) reads as no scaling, so the first paint is the composition at rest.
 */
export function fitScale(natural: number, available: number): number {
  if (!(natural > 0) || !(available > 0)) return 1;
  return Math.min(1, available / natural);
}

/** The height the fitted box takes on the page: the composition's own height at the scale. */
export function fittedHeight(height: number, scale: number): number {
  return Math.ceil(height * scale);
}

/**
 * How wide a framed `/embed` of a module must be for its composition to get its natural width:
 * the natural width plus the embed's padding, which the hero does not have.
 */
export function embedWidth(moduleId: string, natural: number): number {
  return natural + (moduleId === "hero" ? 0 : 2 * EMBED_PADDING);
}
