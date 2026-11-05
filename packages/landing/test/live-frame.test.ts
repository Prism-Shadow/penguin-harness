/**
 * The home page's live frames ↔ the gallery that serves them.
 *
 * - Given a surface, a language and a mode, the frame's URL is the gallery's frame document under
 *   the site's `/gallery/`, which reads back as that surface's route, in that language, embedded
 *   (the guest that takes no focus and hands the wheel to the page), in the app's default theme
 *   and the asked mode.
 * - Given the same, the window bar's link opens that surface's own gallery page in the same
 *   language and mode, and in the phone view on a phone.
 * - Given the hero's opt-in, its new conversation starts the evolution walkthrough; other
 *   frames omit that opt-in and retain their interactive surfaces.
 */
import { describe, expect, it } from "vitest";
import { parseFrameParams } from "../../ui-gallery/src/app/frame";
import { surfaceById } from "../../ui-gallery/src/app/surfaces";
import { INITIAL_THEME_ID } from "../../ui/src/tokens";
import { gallerySurfaceUrl, liveFrameSrc } from "../src/lib/live-frame";

describe("a live frame", () => {
  it("opts the first new-conversation frame into the evolution walkthrough", () => {
    const src = liveFrameSrc("chat-new", "zh", false, "evolution");
    expect(parseFrameParams(new URL(src, "https://example.test").search)).toMatchObject({
      route: "/chat/new",
      lang: "zh",
      autoplay: "evolution",
    });
    expect(
      new URL(liveFrameSrc("chat-rsi", "en", false), "https://example.test").searchParams.has(
        "autoplay",
      ),
    ).toBe(false);
  });
  it("opens the surface's route in the gallery's frame document, embedded, in the site's language and mode", () => {
    for (const [surface, locale, dark] of [
      ["chat-rsi", "zh", true],
      ["benchmark-detail", "en", false],
    ] as const) {
      const src = liveFrameSrc(surface, locale, dark);
      expect(src.startsWith("/gallery/app.html?")).toBe(true);
      const query = src.slice(src.indexOf("?"));
      expect(parseFrameParams(query)).toEqual({
        route: surfaceById(surface)!.route,
        lang: locale,
        embedded: true,
      });
      const params = new URLSearchParams(query);
      expect(params.get("theme")).toBe(INITIAL_THEME_ID);
      expect(params.get("mode")).toBe(dark ? "dark" : "light");
    }
  });

  it("links to the surface's own gallery page, in the same language and mode", () => {
    expect(gallerySurfaceUrl("plugins", "zh", false, false)).toBe(
      "/gallery/s/plugins?lang=zh&mode=light",
    );
    expect(gallerySurfaceUrl("chat-new", "en", true, true)).toBe(
      "/gallery/s/chat-new?lang=en&mode=dark&view=phone",
    );
  });
});
