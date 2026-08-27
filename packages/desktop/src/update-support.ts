/**
 * Whether this running form can update itself (pure; no Electron import, so it unit-tests
 * directly).
 *
 * electron-updater can only replace the forms it installed: the NSIS installer on
 * Windows, the app bundle on macOS, and an AppImage on Linux. A `.deb` belongs to the
 * system package manager — silently "updating" around dpkg would leave the two disagreeing
 * about what is installed — and a dev run has no installed artifact at all.
 */
export type UpdateSupport =
  { supported: true } | { supported: false; reason: "dev" | "linux-not-appimage" };

export function updateSupport(opts: {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}): UpdateSupport {
  if (!opts.isPackaged) return { supported: false, reason: "dev" };
  // The AppImage runtime exports APPIMAGE with the path of the running image; a deb
  // install (or an extracted tree) has no such variable, and that is exactly the
  // distinction electron-updater's Linux path depends on.
  if (opts.platform === "linux" && !opts.env.APPIMAGE) {
    return { supported: false, reason: "linux-not-appimage" };
  }
  return { supported: true };
}

/**
 * Optional feed override (`PENGUIN_UPDATE_FEED_URL`), what makes an end-to-end update
 * test possible against a local server. Returns null when unset or unparseable — an
 * unusable override must not silently redirect updates, so the caller keeps the default
 * GitHub feed.
 */
export function feedUrlOverride(env: NodeJS.ProcessEnv): string | null {
  const raw = env.PENGUIN_UPDATE_FEED_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type UpdateSource = "auto" | "oss" | "github";

/**
 * Desktop update source switches. The names are deliberately separate from the installer's
 * PENGUIN_DOWNLOAD_* variables so a CLI-install setting never leaks into the app's
 * background updater.
 */
export interface UpdateSourceConfig {
  source: UpdateSource;
  probe: boolean;
  /** PENGUIN_UPDATE_SOURCE was set but not one of auto | oss | github. */
  invalidSource: boolean;
  /** PENGUIN_UPDATE_SPEED_PROBE was set but not 0 or 1. */
  invalidProbe: boolean;
}

export function updateSourceConfig(env: NodeJS.ProcessEnv): UpdateSourceConfig {
  const rawSource = env.PENGUIN_UPDATE_SOURCE?.trim() ?? "";
  let source: UpdateSource = "auto";
  let invalidSource = false;
  if (rawSource !== "") {
    if (rawSource === "auto" || rawSource === "oss" || rawSource === "github") {
      source = rawSource;
    } else {
      invalidSource = true;
    }
  }

  const rawProbe = env.PENGUIN_UPDATE_SPEED_PROBE?.trim() ?? "";
  let probe = true;
  let invalidProbe = false;
  if (rawProbe !== "") {
    if (rawProbe === "0") {
      probe = false;
    } else if (rawProbe === "1") {
      probe = true;
    } else {
      invalidProbe = true;
    }
  }
  return { source, probe, invalidSource, invalidProbe };
}
