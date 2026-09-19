/**
 * Which platform's modifier conventions apply, and which host runs the page. Detected once from
 * `navigator` and cached; the tests set it explicitly. Electron's renderer leaves the user agent
 * alone and exposes `userAgentData`, so the same detection serves the desktop app.
 */
import type { HostKind, Platform } from "./types";

export interface NavigatorLike {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

/**
 * `userAgentData.platform` first, then `navigator.platform`, then the user agent. iPadOS reports
 * itself as a Mac and its hardware keyboards use ⌘, so it is a mac here. Everything that is not
 * a Mac or Windows — Linux, Chrome OS, Android — takes the Ctrl conventions.
 */
export function detectPlatform(nav: NavigatorLike | undefined): Platform {
  if (nav === undefined) return "linux";
  const uaPlatform = nav.userAgentData?.platform;
  if (uaPlatform !== undefined && uaPlatform !== "") {
    if (/^mac/i.test(uaPlatform)) return "mac";
    if (/^win/i.test(uaPlatform)) return "windows";
    return "linux";
  }
  const platform = nav.platform ?? "";
  if (/^(Mac|iPhone|iPad|iPod)/.test(platform)) return "mac";
  if (/^Win/.test(platform)) return "windows";
  if (platform !== "") return "linux";
  const ua = nav.userAgent ?? "";
  if (/Mac|iPhone|iPad/.test(ua)) return "mac";
  if (/Windows/.test(ua)) return "windows";
  return "linux";
}

/** The desktop shell is Electron, which names itself in the user agent. Only the reserved-chord notice reads this. */
export function detectHost(nav: NavigatorLike | undefined): HostKind {
  return /Electron\//.test(nav?.userAgent ?? "") ? "desktop" : "browser";
}

let platformOverride: Platform | null = null;
let hostOverride: HostKind | null = null;
let detectedPlatform: Platform | null = null;
let detectedHost: HostKind | null = null;

function currentNavigator(): NavigatorLike | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike);
}

export function currentPlatform(): Platform {
  if (platformOverride !== null) return platformOverride;
  detectedPlatform ??= detectPlatform(currentNavigator());
  return detectedPlatform;
}

export function currentHost(): HostKind {
  if (hostOverride !== null) return hostOverride;
  detectedHost ??= detectHost(currentNavigator());
  return detectedHost;
}

/** Tests pin the platform; null goes back to detection. */
export function setPlatformForTests(platform: Platform | null): void {
  platformOverride = platform;
}

/** Tests pin the host; null goes back to detection. */
export function setHostForTests(host: HostKind | null): void {
  hostOverride = host;
}
