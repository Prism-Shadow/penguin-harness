/**
 * The catalog of the component set's planned sections, each filed under the gallery module
 * (module.ts) whose page lists it. What remains here is filed under Foundations: the icon
 * primitives the boards document. The rest of the plan — the sections that were filed under
 * the retired stand-in compositions — lives in the design's component partition; the gallery
 * now frames the real Web App for those surfaces instead of listing planned parts beside
 * imitations of them.
 *
 * A section is what a module's Parts section lists. It is rendered by the demo whose `id`
 * equals the section id (`components/<group>/<name>/<name>.demo.tsx`, demo.ts) and, until that
 * demo exists, by one grey line built from the planned fields below.
 *
 * Ids are stable addresses: `?v.<id>=` picks and quoted feedback use them. Rename one only
 * together with everything that links it.
 *
 * Plain data with erasable types only, so Node can import this file directly.
 */
import type { ModuleId } from "./module";

/** How a planned component gets into the package. */
export type CatalogKind = "move" | "new" | "lift" | "move-new";

/** The migration wave a section lands in. */
export type CatalogWave = "W0" | "W1" | "W2" | "W3" | "W4" | "W5" | "W6" | "W7" | "W8";

export interface ComponentSection {
  id: string;
  /** The module whose page lists this component in its Parts section. */
  module: ModuleId;
  /** The section title — the component's name, or the family's for a multi-export row. */
  title: string;
  /** Every export the row plans, in the order the partition lists them. */
  components: readonly string[];
  /** One line: what the component is for. */
  description: string;
  /** The planned props, as the partition spells them. */
  props: string;
  /** The web code it replaces, as the partition cites it. Empty for a component with no predecessor. */
  replaces: string;
  plan: CatalogKind;
  wave: CatalogWave;
}

const c = (
  module: ModuleId,
  id: string,
  title: string,
  components: readonly string[],
  description: string,
  props: string,
  replaces: string,
  plan: CatalogKind,
  wave: CatalogWave,
): ComponentSection => ({
  id,
  module,
  title,
  components,
  description,
  props,
  replaces,
  plan,
  wave,
});

/** Every planned component the gallery still lists, grouped by module in module order. */
export const CATALOG: readonly ComponentSection[] = [
  c(
    "foundations",
    "icons-glyph-icon",
    "GlyphIcon",
    ["GlyphIcon"],
    "The one line-icon renderer; stroke from --ui-icon-stroke.",
    "d, size?: IconSize, filled?",
    "glyph-icon.tsx; group-list.tsx Icon",
    "move",
    "W1",
  ),
  c(
    "foundations",
    "icons-registry",
    "Icon registry",
    ["icons.ts"],
    "Every path string, grouped, declared once.",
    "ICONS.plus, ICONS.trash, …",
    "icons.tsx paths, stat-icons.ts, group-list.tsx, session-row-menu.tsx, company-nav-icons.ts; the 9 redeclared plus, 5 trash, pencil/eye/key/rotate/back copies",
    "move",
    "W1",
  ),
  c(
    "foundations",
    "icons-marks",
    "Marks",
    ["Chevron", "ChevronDown", "CheckIcon", "CloseIcon", "PlusIcon", "DownloadIcon", "UploadIcon"],
    "The off-grid marks kept beside the line icons.",
    "as today",
    "chevron.tsx, icons.tsx",
    "move",
    "W1",
  ),
];

/** A section by id. */
export function catalogSection(id: string): ComponentSection | undefined {
  return CATALOG.find((section) => section.id === id);
}
