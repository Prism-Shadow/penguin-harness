/**
 * One module on the gallery page: the header (`Title — description` and its link / parts / tokens /
 * code buttons), the card (the composition on the theme's canvas, or three compare frames), the
 * card's foot (the variant pills, a live variant's transport, and the quotable breadcrumb), and the
 * drawers. A live variant's clock belongs to the card, which plays it while it is on screen.
 */
import type { ThemeId } from "@prismshadow/penguin-ui";
import { memo, useRef, useState } from "react";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { absoluteUrl } from "../lib/location";
import type { CollectedModule } from "../lib/modules";
import { pickVariant, storedVariantKey } from "../lib/modules";
import { comparesModule, formatGalleryQuery, withVariant } from "../lib/url-state";
import { ModuleView, useText } from "../preview";
import { useGallery } from "../state";
import { CompareFrames } from "./compare";
import { useCopy } from "./copy";
import { CodeDrawer, PartsDrawer, TokensDrawer } from "./drawers";
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
  const { title, description } = text.module(module);
  const player = useScenePlayer(variant.scene, {
    reduced: state.motion === "reduced",
    autoplay: true,
  });
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
  const crumb = formatBreadcrumb({
    theme: state.theme,
    module: module.title,
    variant: [variant.title],
    frame: clock && !clock.playing ? clock.frames[clock.index]?.title : undefined,
    mode,
    lang: state.lang,
    tier: state.tier,
  });
  const measureRoot = () =>
    compare
      ? (frames.current.get(state.theme)?.contentDocument?.getElementById("embed-root") ?? null)
      : preview.current;

  return (
    <section id={module.id} className="g-section" data-width={module.width}>
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

      <div ref={player.observe} className="g-card">
        {compare ? (
          <CompareFrames module={module} variant={variant} clock={clock} frames={frames.current} />
        ) : (
          <div ref={preview} className="g-preview" data-module={module.id}>
            <ModuleView module={module} variant={variant} clock={clock} />
          </div>
        )}
        <div
          className="g-card-foot g-chrome"
          data-compare={compare || undefined}
          data-scene={clock ? true : undefined}
        >
          {!compare && <Breadcrumb text={crumb} />}
          <VariantPills module={module} current={variant} onPick={onPick} />
          {clock && (
            <Transport module={module} variant={variant} clock={clock} control={player.control} />
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
              measureKey={[variant.key, state.theme, mode, state.lang, compare].join("|")}
            />
          )}
          {open.has("code") && <CodeDrawer path={entry.path} />}
        </div>
      )}
    </section>
  );
});
