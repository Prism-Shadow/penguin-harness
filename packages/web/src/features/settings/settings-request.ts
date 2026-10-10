/**
 * Opening the Settings dialog from outside the account menu that owns it.
 *
 * The dialog's open state lives in the one UserMenu the sidebar mounts (it is the menu's row
 * that opens it), so a caller elsewhere — a host that frames the app on a settings page, a
 * future command — asks through here rather than reaching for that state. A request made
 * before the menu has mounted (the app is still signing in, the layout is not up) is kept and
 * delivered the moment it subscribes, so "open Settings on Appearance" is honoured however
 * early it is asked.
 */
import type { SettingsSectionKey } from "../../lib/settings-sections";

export interface SettingsRequest {
  /** The page to open on; absent opens the viewer's first page, as the menu row does. */
  section?: SettingsSectionKey;
}

type Listener = (request: SettingsRequest) => void;

let listener: Listener | null = null;
let pending: SettingsRequest | null = null;

/** Asks the mounted account menu to open Settings; kept until one mounts if none has. */
export function requestSettings(request: SettingsRequest = {}): void {
  if (listener) listener(request);
  else pending = request;
}

/**
 * The account menu's side: answers requests for as long as it is mounted, and takes a request
 * made before it mounted at once. One listener at a time — the sidebar mounts one menu.
 */
export function onSettingsRequest(next: Listener): () => void {
  listener = next;
  if (pending) {
    const request = pending;
    pending = null;
    next(request);
  }
  return () => {
    if (listener === next) listener = null;
  };
}
