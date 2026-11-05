/**
 * The panels' display identity — label and glyph — for every surface that names them: the
 * toolbar's triggers and menu rows, the docks' tab strips, and the docks' add menus. The table
 * itself is the panel registry's (panel-registry.ts: one definition per panel, so a panel never
 * has two names or two marks); these are its readers, kept here so the surfaces that need only a
 * name or a mark keep their import, with the drawn form of the glyph beside them.
 */
import type { ReactNode } from "react";
import { GlyphIcon, ICON_SIZE } from "@prismshadow/penguin-ui";
import { panelGlyphPath, panelLabel } from "./panel-registry";
import type { PanelId } from "./panel-registry";

export { panelGlyphPath, panelLabel };

/** The panel's mark, drawn at `size` (an id with no definition yet draws the puzzle piece). */
export function panelGlyph(id: PanelId, size: number = ICON_SIZE.iconButton): ReactNode {
  return <GlyphIcon d={panelGlyphPath(id)} size={size} />;
}
