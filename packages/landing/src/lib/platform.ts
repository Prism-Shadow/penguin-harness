/**
 * Coarse client-side OS detection, shared by the hero's platform-aware download
 * button and the download page's platform cards. Detection only tunes emphasis
 * (which label the hero button carries, which card gets badged) — absent or wrong
 * detection never blocks a download.
 */
export type Platform = "mac" | "windows" | "linux";

export function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Linux|X11/.test(ua) && !/Android/i.test(ua)) return "linux";
  return null;
}
