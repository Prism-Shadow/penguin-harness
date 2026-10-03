/**
 * Opening the Settings dialog: the account menu's Settings row, and anything outside it — a host
 * that frames the app on a settings page, a future command.
 *
 * The dialog and its open state belong to the settings module's layer (features/settings/
 * settings-layer.tsx), mounted once beside every page, so a caller asks through here rather than
 * reaching for that state. A request made before the layer has mounted (the app is still signing
 * in, the layout is not up) is kept and delivered the moment it subscribes, so "open Settings on
 * Appearance" is honoured however early it is asked.
 */
import type { SettingsSectionKey } from "./settings-sections";

export interface SettingsRequest {
  /** The page to open on; absent opens the viewer's first page, as the menu row does. */
  section?: SettingsSectionKey;
}

type Listener = (request: SettingsRequest) => void;

let listener: Listener | null = null;
let pending: SettingsRequest | null = null;

/** Asks the mounted layer to open Settings; kept until it mounts if it has not. */
export function requestSettings(request: SettingsRequest = {}): void {
  if (listener) listener(request);
  else pending = request;
}

/**
 * The layer's side: answers requests for as long as it is mounted, and takes a request made
 * before it mounted at once. One listener at a time — the layout mounts one layer.
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
