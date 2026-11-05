/**
 * Tells the desktop shell which language the window is in, so its tray menu reads the same way.
 *
 * The shell cannot see this preference itself: it lives in this browser's localStorage, on the
 * other side of a boundary the desktop design keeps deliberately one-way — the window is a
 * plain browser with no IPC bridge into it. So the page reports, over the same
 * `PUT /api/desktop/tray` the Appearance switch uses, and the shell persists what it hears and
 * redraws its menu.
 *
 * Reports on mount as well as on change: the shell starts before any window loads and falls
 * back to the device language until something tells it otherwise, which is the wrong answer for
 * anyone who has picked a language that is not their device's.
 *
 * A failed report is dropped. There is no retry and no message: the tray is a convenience, the
 * next language change (or the next launch of the app, which sends again on mount) will carry
 * the value, and a toast about a menu the user may not even have open would be noise.
 */
import { useEffect } from "react";
import * as api from "../api/endpoints";
import { isDesktopShellWindow } from "../lib/account-menu";
import { useAuth } from "./auth";
import { useLocale } from "./locale";
import type { Locale } from "./locale";
import type { DesktopTrayLocale } from "@prismshadow/penguin-server/api";

// The Web App's languages and the ones the tray route accepts are the same set, and a
// divergence would otherwise show up as a 400 nobody looks at. Compile-time, no runtime cost.
type LocalesAgree = Locale extends DesktopTrayLocale ? true : never;
const _localesAgree: LocalesAgree = true;
void _localesAgree;

export function useTrayLocale(): void {
  const { locale } = useLocale();
  const { desktopMode, sessionVia } = useAuth();
  const shell = isDesktopShellWindow({ desktopMode, sessionVia });
  useEffect(() => {
    if (!shell) return;
    void api.setDesktopTray({ locale }).catch(() => {});
  }, [shell, locale]);
}
