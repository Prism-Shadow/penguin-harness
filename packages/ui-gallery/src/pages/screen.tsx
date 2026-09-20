/**
 * `/screens/<name>` — a full-viewport composite on the themed root, with a small floating
 * unthemed toolbar (hidden by `bare=1`) carrying the view controls and the screen's breadcrumb,
 * `Primer › Screens › Chat · light`, the same address the Screens module's card quotes.
 */
import { useEffect } from "react";
import { ModeSwitch, ViewControls } from "../chrome/rail";
import { useCopy } from "../chrome/copy";
import { ChromeIcon } from "../chrome/icons";
import { formatBreadcrumb } from "../lib/breadcrumb";
import { BASE } from "../lib/location";
import { formatGalleryQuery } from "../lib/url-state";
import { module as screensModule } from "../modules/screens.module";
import { SCREENS } from "../screens";
import { useGallery } from "../state";

export function ScreenPage({ name }: { name: string }) {
  const { S, state, mode, tokens } = useGallery();
  const [copied, copy] = useCopy();
  const screen = SCREENS[name];
  const bare = new URLSearchParams(window.location.search).get("bare") === "1";

  useEffect(() => {
    if (!tokens) return;
    void document.fonts.ready.then(() => {
      document.documentElement.dataset.galleryReady = "1";
    });
  }, [tokens]);

  const crumb = formatBreadcrumb({
    theme: state.theme,
    module: "Screens",
    variant: [screen?.title ?? name],
    mode,
    lang: state.lang,
    tier: state.tier,
  });
  // The module's first variant is its default pick, so the link back names the screen only when
  // it is not that one.
  const variants: Record<string, string> =
    screen && screen.id !== screensModule.variants[0]!.key ? { screens: screen.id } : {};
  const back = `${BASE}/${formatGalleryQuery({ ...state, compare: false, variants })}#screens`;

  return (
    <>
      <div className="g-screen-root">
        {screen ? (
          <screen.Component lang={state.lang} />
        ) : (
          <div className="g-screen-missing g-chrome">
            <p>{S.screens.notFound(name)}</p>
            <ul>
              {Object.keys(SCREENS).map((known) => (
                <li key={known}>
                  <a
                    href={`${BASE}/screens/${known}${formatGalleryQuery({ ...state, variants: {} })}`}
                  >
                    {known}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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
    </>
  );
}
