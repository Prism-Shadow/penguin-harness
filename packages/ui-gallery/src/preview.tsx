/**
 * What a preview renders: a module's board for one variant, or a part's demo (a single pick or
 * its matrix) — and the localized names every page prints.
 */
import type { ThemeId } from "@prismshadow/penguin-ui";
import type { ComponentSection } from "../../ui/src/catalog";
import type { Demo } from "../../ui/src/demo";
import type { Module, ModuleVariant } from "../../ui/src/module";
import type { SurfaceGroupId, SurfaceId } from "./app/surfaces";
import { THEME_ACCENT } from "./lib/accents";
import { allSelections, formatVariantKey } from "./lib/demos";
import type { VariantPick } from "./lib/demos";
import { useGallery } from "./state";
import type { SurfaceCopy } from "./strings";

/** A module's board for one variant. */
export function ModuleView({ module, variant }: { module: Module; variant: ModuleVariant }) {
  const { state, mode } = useGallery();
  return <>{module.render(variant.key, { lang: state.lang, mode })}</>;
}

function DemoCell({
  demo,
  selection,
}: {
  demo: Demo;
  selection: Readonly<Record<string, string>>;
}) {
  const { state, mode } = useGallery();
  return <>{demo.render(selection, { lang: state.lang, mode })}</>;
}

export function DemoView({ demo, pick }: { demo: Demo; pick: VariantPick }) {
  if (pick.kind === "single") return <DemoCell demo={demo} selection={pick.selection} />;
  return (
    <div className="g-matrix">
      {allSelections(demo.axes).map((selection) => {
        const key = formatVariantKey(demo.axes, { kind: "single", selection });
        return (
          <div key={key} className="g-matrix-cell">
            <span className="g-matrix-label g-chrome">{key.replaceAll(".", " · ")}</span>
            <div>
              <DemoCell demo={demo} selection={selection} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Localized names: the surfaces and their groups from the dictionaries; English module and
 * catalog names from the module and catalog files, Chinese from strings.ts; theme display names
 * and the breadcrumb's mode and view words from the dictionaries in both.
 */
export function useText(): {
  surface: (id: SurfaceId) => SurfaceCopy;
  surfaceGroup: (id: SurfaceGroupId) => string;
  module: (module: Module) => { title: string; description: string };
  variant: (module: Module, variant: ModuleVariant) => string;
  part: (section: ComponentSection) => { title: string; description: string };
  /** 通用 / 白领 / 极客, or Primer / Frost / Console. */
  theme: (id: ThemeId) => string;
  /** The breadcrumb's qualifiers: the mode word, the accent id when applied, the phone frame's word. */
  qualifiers: () => { mode: string; accent: string | undefined; view: string | undefined };
} {
  const { S, state, mode, accent } = useGallery();
  return {
    surface: (id) => S.surfaces[id],
    surfaceGroup: (id) => S.surfaceGroups[id],
    module: (module) => {
      const zh = S.catalog.modules[module.id];
      return {
        title: zh?.title ?? module.title,
        description: zh?.description ?? module.description,
      };
    },
    variant: (module, variant) =>
      S.catalog.modules[module.id]?.variants[variant.key] ?? variant.title,
    part: (section) => {
      const zh = S.catalog.sections[section.id];
      return {
        title: zh?.title ?? section.title,
        description: zh?.description ?? section.description,
      };
    },
    theme: (id) => S.rail.themeNames[id],
    qualifiers: () => ({
      mode: S.crumb.modes[mode],
      accent: accent === THEME_ACCENT ? undefined : accent,
      view: state.view === "phone" ? S.crumb.phone : undefined,
    }),
  };
}
