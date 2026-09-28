/**
 * What a preview renders, whatever produced it: a module's composition for one variant, or a
 * part's demo (a single pick or its matrix). The module pages, the framed embeds (compare mode,
 * the phone view) and `/embed` all render through this one file, so a preview looks the same in
 * each.
 */
import type { ThemeId } from "@prismshadow/penguin-ui";
import type { ComponentSection } from "../../ui/src/catalog";
import type { Demo } from "../../ui/src/demo";
import type { Module, ModuleVariant, SceneFrame, VariantKind } from "../../ui/src/module";
import { SceneContext, SceneControlsContext } from "../../ui/src/scene";
import type { SceneClock, SceneControls } from "../../ui/src/scene";
import { THEME_ACCENT } from "./lib/accents";
import { allSelections, formatVariantKey } from "./lib/demos";
import type { VariantPick } from "./lib/demos";
import type { GroupId } from "./lib/groups";
import { useGallery } from "./state";

/**
 * A module's composition. A scene's clock, and the controls to move it, reach the components it
 * renders through `SceneContext` and `SceneControlsContext`; a variant without a clock gets
 * neither, so no clock from a surrounding section ever leaks in.
 */
export function ModuleView({
  module,
  variant,
  clock = null,
  controls = null,
}: {
  module: Module;
  variant: ModuleVariant;
  clock?: SceneClock | null;
  controls?: SceneControls | null;
}) {
  const { state, mode } = useGallery();
  return (
    <SceneContext.Provider value={clock}>
      <SceneControlsContext.Provider value={clock ? controls : null}>
        {module.render(variant.key, { lang: state.lang, mode })}
      </SceneControlsContext.Provider>
    </SceneContext.Provider>
  );
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
 * Localized names: English from the module and catalog files, Chinese from strings.ts; group
 * and kind names, theme display names and the breadcrumb's mode and view words from the
 * dictionaries in both.
 */
export function useText(): {
  module: (module: Module) => { title: string; description: string };
  variant: (module: Module, variant: ModuleVariant) => string;
  frame: (module: Module, variant: ModuleVariant, frame: SceneFrame) => string;
  part: (section: ComponentSection) => { title: string; description: string };
  group: (id: GroupId) => string;
  kind: (kind: VariantKind) => string;
  /** 通用 / 白领 / 极客, or Primer / Frost / Console. */
  theme: (id: ThemeId) => string;
  /** The breadcrumb's qualifiers: the mode word, the accent id when applied, the phone frame's word. */
  qualifiers: () => { mode: string; accent: string | undefined; view: string | undefined };
} {
  const { S, state, mode, accent } = useGallery();
  return {
    module: (module) => {
      const zh = S.catalog.modules[module.id];
      return {
        title: zh?.title ?? module.title,
        description: zh?.description ?? module.description,
      };
    },
    variant: (module, variant) =>
      S.catalog.modules[module.id]?.variants[variant.key] ?? variant.title,
    frame: (module, variant, frame) =>
      S.catalog.modules[module.id]?.frames?.[variant.key]?.[frame.key] ?? frame.title,
    part: (section) => {
      const zh = S.catalog.sections[section.id];
      return {
        title: zh?.title ?? section.title,
        description: zh?.description ?? section.description,
      };
    },
    group: (id) => S.groups[id],
    kind: (kind) => S.variant.kinds[kind],
    theme: (id) => S.rail.themeNames[id],
    qualifiers: () => ({
      mode: S.crumb.modes[mode],
      accent: accent === THEME_ACCENT ? undefined : accent,
      view: state.view === "phone" ? S.crumb.phone : undefined,
    }),
  };
}
