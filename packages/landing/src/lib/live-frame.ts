/**
 * What the home page's live frames show: the component gallery's frame document, which mounts the
 * real Web App against an in-browser demo API, opened on one of the gallery's surfaces in the
 * app's default theme and the site's language and mode. The URL, the window sizes and the surface
 * routes are the gallery's own (packages/ui-gallery/src/app/frame.ts and surfaces.ts), imported
 * rather than copied, so a renamed route or parameter cannot leave the landing page framing the
 * wrong page. Both files are pure and import nothing beyond the UI package's tokens.
 *
 * The frame is embedded (`embed=1`): until the reader clicks into it, the app takes no focus,
 * scrolls nothing and hands the wheel to this page (the gallery's guest-frame.ts).
 */
import { APP_FRAME, embeddedFrameSrc, PHONE_FRAME } from "../../../ui-gallery/src/app/frame";
import { surfaceById } from "../../../ui-gallery/src/app/surfaces";
import type { SurfaceId } from "../../../ui-gallery/src/app/surfaces";
import { surfacePath } from "../../../ui-gallery/src/lib/page-paths";
import { INITIAL_THEME_ID } from "../../../ui/src/tokens";
import type { SiteLocale as Locale } from "@prismshadow/penguin-ui/site";
import { GALLERY_URL } from "./links";

export type { SurfaceId };

/** The window a frame lays the app out in: a laptop's, or a phone's on a phone. */
export function frameSize(phone: boolean): { width: number; height: number } {
  return phone ? PHONE_FRAME : APP_FRAME;
}

/** The gallery's base without its trailing slash, which its frame URLs are built on. */
const GALLERY_BASE = GALLERY_URL.replace(/\/$/, "");

const modeOf = (dark: boolean) => (dark ? "dark" : "light");

/** A live frame's document: the surface's route in the app's default theme, the site's language and mode. */
export function liveFrameSrc(
  surface: SurfaceId,
  locale: Locale,
  dark: boolean,
  autoplay?: "evolution",
): string {
  const route = surfaceById(surface)?.route;
  if (route === undefined) throw new Error(`No gallery surface named ${surface}`);
  return embeddedFrameSrc(
    GALLERY_BASE,
    { theme: INITIAL_THEME_ID, mode: modeOf(dark), lang: locale },
    route,
    autoplay,
  );
}

/** The gallery's own page for the surface: the same app at full size, in the same language and mode. */
export function gallerySurfaceUrl(
  surface: SurfaceId,
  locale: Locale,
  dark: boolean,
  phone: boolean,
): string {
  const params = new URLSearchParams({ lang: locale, mode: modeOf(dark) });
  if (phone) params.set("view", "phone");
  return `${GALLERY_BASE}${surfacePath(surface)}?${params.toString()}`;
}
