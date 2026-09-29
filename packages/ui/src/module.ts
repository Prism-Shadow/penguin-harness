/**
 * The module contract: one documentation page of the gallery, and what a
 * `<id>.module.tsx` exports.
 *
 *   export const module = defineModule({
 *     id: "foundations",
 *     title: "Foundations",
 *     description: "The palette, the type scale, shape and depth, …, each on a board.",
 *     variants: [{ key: "colour", title: "Colour" }, { key: "type", title: "Type" }],
 *     parts: ["icons-glyph-icon"],
 *     render: (variant) => <Board name={variant} />,
 *   });
 *
 * The gallery renders exactly the ids in {@link MODULE_IDS}, each on its own page (`/c/<id>`)
 * with a section per variant. The product's own surfaces are not modules: the gallery frames
 * the real Web App for those (its `/s/<surface>` pages), so the modules that remain document
 * what the app is built from — the token vocabulary, on the Foundations boards — rather than
 * imitate it.
 *
 * Ids and variant keys are addresses: `/c/foundations#colour`, screenshot file names and quoted
 * feedback all use them. A key is lowercase words joined by `-`, never a `.`.
 */
import type { ReactNode } from "react";
import type { DemoContext } from "./demo";

/** The gallery's modules, in index order. */
export const MODULE_IDS = ["foundations"] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export interface ModuleVariant {
  /** The section's address: lowercase words joined by `-`. */
  key: string;
  /** English. The gallery's Chinese dictionary translates it. */
  title: string;
  description?: string;
}

export interface Module {
  id: ModuleId;
  /** English. The gallery's Chinese dictionary translates it. */
  title: string;
  /** One sentence on what the page shows. */
  description: string;
  /** At least one; the first is the default pick. */
  variants: readonly ModuleVariant[];
  /** The catalog section ids (catalog.ts) listed in the page's Parts section, in catalog order. */
  parts: readonly string[];
  /** Method syntax on purpose, like `Demo.render`. Unknown variant keys never reach it. */
  render(variant: string, context: DemoContext): ReactNode;
}

/** Identity: a typed home for a module literal. */
export function defineModule(module: Module): Module {
  return module;
}
