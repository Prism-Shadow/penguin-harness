/**
 * `/screens/<name>` — a full-viewport composite on the themed root, under a slim unthemed toolbar
 * strip (hidden by `bare=1`) carrying the view controls and the screen's breadcrumb,
 * `Primer › Screens › Chat · light`, the same address the Screens page's section quotes. The
 * strip takes its own height rather than floating over the composite, whose controls reach every
 * edge; the composite fills what is left, and the whole viewport with `bare=1`.
 */
import { useEffect } from "react";
import { useCopy } from "../chrome/copy";
import { ChromeIcon } from "../chrome/icons";
import { ModeSwitch, ViewControls } from "../chrome/topbar";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { BASE } from "../lib/location";
import { moduleHref, routeHref } from "../lib/routes";
import { useText } from "../preview";
import { MODULES } from "../registry";
import { SCREENS } from "../screens";
import { useGallery } from "../state";

export function ScreenPage({ name }: { name: string }) {
  const { S, state, tokens } = useGallery();
  const text = useText();
  const [copied, copy] = useCopy();
  const screen = SCREENS[name];
  const bare = new URLSearchParams(window.location.search).get("bare") === "1";

  useEffect(() => {
    if (!tokens) return;
    void document.fonts.ready.then(() => {
      document.documentElement.dataset.galleryReady = "1";
    });
  }, [tokens]);

  // The Screens module's own names, so the toolbar quotes the same address as its section.
  const screens = MODULES.byId.get("screens")?.module;
  const screenVariant = screens?.variants.find((variant) => variant.key === screen?.id);
  const crumb = formatBreadcrumb({
    theme: text.theme(state.theme),
    module: screens ? text.module(screens).title : "Screens",
    variant: [
      screens && screenVariant ? text.variant(screens, screenVariant) : (screen?.title ?? name),
    ],
    tier: state.tier,
    ...text.qualifiers(),
  });
  const back = moduleHref(BASE, state, "screens", screen?.id);

  return (
    <div className="g-screen-page">
      {!bare && (
        <div className="g-screen-bar g-chrome">
          <a className="g-icon-button" href={back} title={S.screens.back}>
            <ChromeIcon name="back" />
          </a>
          <ViewControls compact />
          <ModeSwitch />
          <button
            type="button"
            className="g-crumb"
            onClick={() => copy("crumb", crumb)}
            title={S.section.copyBreadcrumb}
          >
            <ChromeIcon name={copied ? "check" : "copy"} size={13} />
            <span>{copied ? S.section.copied : crumb}</span>
          </button>
        </div>
      )}
      <div className="g-screen-root">
        {screen ? (
          <screen.Component lang={state.lang} />
        ) : (
          <div className="g-screen-missing g-chrome">
            <p>{S.screens.notFound(name)}</p>
            <ul>
              {Object.keys(SCREENS).map((known) => (
                <li key={known}>
                  <a href={routeHref(BASE, state, `/screens/${known}`)}>{known}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
