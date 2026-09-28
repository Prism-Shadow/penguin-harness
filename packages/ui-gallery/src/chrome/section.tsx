/**
 * One module on the gallery page: the header (`Title — description` and its link / parts / tokens /
 * code buttons), the card (the composition on the theme's canvas — or framed embeds, when
 * comparing themes or at phone width), the card's foot (the quotable breadcrumb, the variant
 * pills, and the transport when the variant has a scene), and the drawers.
 *
 * The scene's clock belongs to the card. It starts settled and moves only from the transport;
 * the framed embeds follow it, so compare mode and the phone view play the same frame at the same
 * moment as the card would.
 *
 * The hero module is the page's opening: its card bleeds to the main column's edges and carries no
 * frame of its own.
 *
 * A module designed at the app's own width (`viewport`) lays out at that width and is scaled down
 * to the card (chrome/fit.tsx), so an app window reads as the app does rather than reflowed into
 * the card's few hundred pixels.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { memo, useRef, useState } from "react";
import { isSettled } from "../../../ui/src/scene";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { naturalWidth } from "../lib/fit";
import { absoluteUrl } from "../lib/location";
import type { CollectedModule } from "../lib/modules";
import { pickVariant, storedVariantKey } from "../lib/modules";
import { comparesModule, formatGalleryQuery, withVariant } from "../lib/url-state";
import { ModuleView, useText } from "../preview";
import { useGallery } from "../state";
import { ThemeFrames } from "./compare";
import { useCopy } from "./copy";
import { CodeDrawer, PartsDrawer, TokensDrawer } from "./drawers";
import { Fit } from "./fit";
import { ChromeIcon } from "./icons";
import type { ChromeIconName } from "./icons";
import { Breadcrumb, VariantPills } from "./pills";
import { Transport, useScenePlayer } from "./player";

type Drawer = "parts" | "tokens" | "code";

function DrawerButton({
  icon,
  title,
  pressed,
  onClick,
}: {
  icon: ChromeIconName;
  title: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="g-icon-button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <ChromeIcon name={icon} />
    </button>
  );
}

/** A deep link to a part (`#actions-button`) opens its module's Parts drawer. */
function linkedToPart(parts: readonly string[]): boolean {
  const hash = decodeURIComponent(window.location.hash.slice(1));
  return hash !== "" && parts.includes(hash);
}

export const ModuleSection = memo(function ModuleSection({
  entry,
  pickKey,
}: {
  entry: CollectedModule;
  pickKey: string | undefined;
}) {
  const { S, state, mode, update } = useGallery();
  const text = useText();
  const [copied, copy] = useCopy();
  const { module } = entry;
  const [open, setOpen] = useState<ReadonlySet<Drawer>>(
    () => new Set<Drawer>(linkedToPart(module.parts) ? ["parts"] : []),
  );
  const preview = useRef<HTMLDivElement>(null);
  const frames = useRef(new Map<ThemeId, HTMLIFrameElement>());
  const variant = pickVariant(module, pickKey);
  const compare = comparesModule(state, module.id);
  const phone = state.view === "phone";
  const framed = compare || phone;
  const natural = naturalWidth(module);
  const { title, description } = text.module(module);
  const player = useScenePlayer(variant.scene, { reduced: state.motion === "reduced" });
  const { clock } = player;

  const toggle = (drawer: Drawer) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(drawer)) next.add(drawer);
      return next;
    });
  const onPick = (key: string) =>
    update((s) => withVariant(s, module.id, storedVariantKey(module, key)));
  const link = () => {
    const stored = storedVariantKey(module, variant.key);
    const variants = stored === null ? {} : { [module.id]: stored };
    const query = formatGalleryQuery({ ...state, compare: compare ? module.id : false, variants });
    return absoluteUrl(`/${query}#${module.id}`);
  };
  const paused = clock && !clock.playing && !isSettled(clock.frames, clock);
  const currentFrame = clock?.frames[clock.index];
  const crumb = formatBreadcrumb({
    theme: text.theme(state.theme),
    module: title,
    variant: [text.variant(module, variant)],
    frame: paused && currentFrame ? text.frame(module, variant, currentFrame) : undefined,
    tier: state.tier,
    ...text.qualifiers(),
  });
  const measureRoot = () =>
    framed
      ? (frames.current.get(state.theme)?.contentDocument?.getElementById("embed-root") ?? null)
      : preview.current;

  return (
    <section
      id={module.id}
      className="g-section"
      data-width={module.width}
      data-hero={module.id === "hero" || undefined}
    >
      <header className="g-section-head g-chrome">
        <h2 className="g-section-title">{title}</h2>
        <p className="g-section-desc">{description}</p>
        <span className="g-section-actions">
          <DrawerButton
            icon={copied === "link" ? "check" : "link"}
            title={S.section.copyLink}
            pressed={false}
            onClick={() => copy("link", link())}
          />
          <DrawerButton
            icon="parts"
            title={S.section.parts}
            pressed={open.has("parts")}
            onClick={() => toggle("parts")}
          />
          <DrawerButton
            icon="tokens"
            title={S.section.tokens}
            pressed={open.has("tokens")}
            onClick={() => toggle("tokens")}
          />
          <DrawerButton
            icon="code"
            title={S.section.code}
            pressed={open.has("code")}
            onClick={() => toggle("code")}
          />
        </span>
      </header>

      <div className="g-card">
        {framed ? (
          <ThemeFrames
            module={module}
            variant={variant}
            clock={clock}
            control={player.control}
            frames={frames.current}
            themes={compare ? THEME_IDS : [state.theme]}
            phone={phone}
          />
        ) : (
          <div ref={preview} className="g-preview" data-module={module.id}>
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
        <div className="g-card-foot g-chrome" data-scene={clock ? true : undefined}>
          <Breadcrumb text={crumb} />
          <VariantPills module={module} current={variant} onPick={onPick} />
          {clock && (
            <Transport
              module={module}
              variant={variant}
              clock={clock}
              ran={player.ran}
              control={player.control}
            />
          )}
        </div>
      </div>

      {open.size > 0 && (
        <div className="g-drawer g-chrome">
          {open.has("parts") && <PartsDrawer module={module} />}
          {open.has("tokens") && (
            <TokensDrawer
              module={module}
              root={measureRoot}
              measureKey={[
                variant.key,
                state.theme,
                mode,
                state.accent,
                state.lang,
                state.tier,
                framed,
              ].join("|")}
            />
          )}
          {open.has("code") && <CodeDrawer path={entry.path} />}
        </div>
      )}
    </section>
  );
});
