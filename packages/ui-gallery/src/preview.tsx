/**
 * What a card renders, whatever produced it: a module's composition for one variant, or a part's
 * demo (a single pick or its matrix). The main page, the compare frames and `/embed` all render
 * through this one file, so a preview looks the same in each.
 */
import type { ComponentSection } from "../../ui/src/catalog";
import type { Demo } from "../../ui/src/demo";
import type { Module, ModuleVariant } from "../../ui/src/module";
import { allSelections, formatVariantKey } from "./lib/demos";
import type { VariantPick } from "./lib/demos";
import { useGallery } from "./state";

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

/** Localized titles and descriptions: English from the module and catalog files, Chinese from strings.ts. */
export function useText(): {
  module: (module: Module) => { title: string; description: string };
  variant: (module: Module, variant: ModuleVariant) => string;
  part: (section: ComponentSection) => { title: string; description: string };
} {
  const { S } = useGallery();
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
    part: (section) => {
      const zh = S.catalog.sections[section.id];
      return {
        title: zh?.title ?? section.title,
        description: zh?.description ?? section.description,
      };
    },
  };
}
