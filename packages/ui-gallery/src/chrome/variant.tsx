/**
 * One variant's section on a module page: the H2 title and description, a small toolbar, the
 * preview in a hairline frame, and — for an animated variant — the frame strip under it.
 *
 * The toolbar follows the variant's kind (lib/modules.ts):
 *
 * - animated: the kind label, then Play / Pause / Replay on the section's own clock
 *   (chrome/player.tsx), which starts settled and moves only from here;
 * - interactive: the kind label, then Reset, which remounts the composition — its own state is
 *   the only state it has, so a fresh mount is its first picture again;
 * - static: the kind label alone.
 *
 * Then, for every kind: open standalone (`/embed`), compare across the themes (three framed
 * embeds following this section's clock, when it has one), copy the section's link, and the
 * quotable breadcrumb.
 *
 * A module designed at the app's own width (`viewport`) lays out at that width and is scaled down
 * to the column (chrome/fit.tsx), so an app window reads as the app does rather than reflowed into
 * the column's few hundred pixels.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import { memo, useState } from "react";
import { isSettled } from "../../../ui/src/scene";
import type { ModuleVariant } from "../../../ui/src/module";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { naturalWidth } from "../lib/fit";
import { absoluteUrl, BASE } from "../lib/location";
import type { CollectedModule } from "../lib/modules";
import { variantKind } from "../lib/modules";
import { modulePath, pageState } from "../lib/routes";
import { comparesVariant, formatGalleryQuery, withVariantCompare } from "../lib/url-state";
import { ModuleView, useText } from "../preview";
import { useGallery } from "../state";
import { ThemeFrames } from "./compare";
import { useCopy } from "./copy";
import { Breadcrumb } from "./crumb";
import { Fit } from "./fit";
import { ChromeIcon } from "./icons";
import type { ChromeIconName } from "./icons";
import { FrameStrip, PlayButton, useScenePlayer } from "./player";

const KIND_ICONS = { animated: "play", interactive: "pointer", static: "still" } as const;

function Tool({
  icon,
  label,
  title,
  pressed,
  onClick,
}: {
  icon: ChromeIconName;
  label: string;
  title?: string;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="g-tool" title={title} aria-pressed={pressed} onClick={onClick}>
      <ChromeIcon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );
}

export const VariantSection = memo(function VariantSection({
  entry,
  variant,
}: {
  entry: CollectedModule;
  variant: ModuleVariant;
}) {
  const { S, state, update } = useGallery();
  const text = useText();
  const [copied, copy] = useCopy();
  const { module } = entry;
  const kind = variantKind(variant);
  const compare = comparesVariant(state, module.id, variant.key);
  const phone = state.view === "phone";
  const framed = compare || phone;
  const natural = naturalWidth(module);
  /** Reset remounts the composition (and reloads its frames): a new key, nothing else. */
  const [epoch, setEpoch] = useState(0);
  const player = useScenePlayer(kind === "animated" ? variant.scene : undefined, {
    reduced: state.motion === "reduced",
  });
  const { clock } = player;

  const title = text.variant(module, variant);
  const paused = clock && !clock.playing && !isSettled(clock.frames, clock);
  const currentFrame = clock?.frames[clock.index];
  const crumb = formatBreadcrumb({
    theme: text.theme(state.theme),
    module: text.module(module).title,
    variant: [title],
    frame: paused && currentFrame ? text.frame(module, variant, currentFrame) : undefined,
    tier: state.tier,
    ...text.qualifiers(),
  });
  const embedHref = `${BASE}/embed${formatGalleryQuery(
    { ...state, compare: false, variants: {} },
    { module: module.id, variant: variant.key },
  )}`;
  const link = () => {
    const pinned = compare
      ? withVariantCompare(pageState(state), module.id, variant.key, true)
      : pageState(state);
    return absoluteUrl(`${modulePath(module.id)}${formatGalleryQuery(pinned)}#${variant.key}`);
  };

  return (
    <section id={variant.key} className="g-variant" data-kind={kind}>
      <h2 className="g-h2">{title}</h2>
      {variant.description && <p className="g-variant-desc">{variant.description}</p>}
      <div className="g-toolbar">
        <span className="g-kind" title={S.variant.kindHints[kind]}>
          <ChromeIcon name={KIND_ICONS[kind]} size={13} />
          {S.variant.kinds[kind]}
        </span>
        {clock && <PlayButton clock={clock} ran={player.ran} control={player.control} />}
        {kind === "interactive" && (
          <button
            type="button"
            className="g-tool g-tool-primary"
            onClick={() => setEpoch((current) => current + 1)}
          >
            <ChromeIcon name="restart" size={13} />
            <span>{S.variant.reset}</span>
          </button>
        )}
        <a className="g-tool" href={embedHref} target="_blank" rel="noreferrer">
          <ChromeIcon name="external" size={14} />
          <span>{S.variant.open}</span>
        </a>
        <Tool
          icon="columns"
          label={compare ? S.variant.compareOn : S.variant.compare}
          pressed={compare}
          onClick={() => update((s) => withVariantCompare(s, module.id, variant.key, !compare))}
        />
        <button
          type="button"
          className="g-tool g-tool-icon"
          title={S.section.copyLink}
          aria-label={S.section.copyLink}
          onClick={() => copy("link", link())}
        >
          <ChromeIcon name={copied === "link" ? "check" : "link"} size={14} />
        </button>
        <Breadcrumb text={crumb} />
      </div>

      <div className="g-frame" data-framed={framed || undefined}>
        {framed ? (
          <ThemeFrames
            key={epoch}
            module={module}
            variant={variant}
            clock={clock}
            control={player.control}
            themes={compare ? THEME_IDS : [state.theme]}
            phone={phone}
          />
        ) : (
          <div key={epoch} className="g-preview" data-module={module.id}>
            {natural === null ? (
              <ModuleView
                module={module}
                variant={variant}
                clock={clock}
                controls={player.controls}
              />
            ) : (
              <Fit natural={natural}>
                <ModuleView
                  module={module}
                  variant={variant}
                  clock={clock}
                  controls={player.controls}
                />
              </Fit>
            )}
          </div>
        )}
      </div>
      {clock && (
        <FrameStrip module={module} variant={variant} clock={clock} control={player.control} />
      )}
    </section>
  );
});
