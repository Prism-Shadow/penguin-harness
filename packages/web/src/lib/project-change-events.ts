/** A completed write invalidates related project views in this window and other browser tabs. */
export const serverPluginsChanged = "penguin-server-plugins-changed";
export const projectCapabilitiesChanged = "penguin-project-capabilities-changed";
export function notifyProjectChange(
  event: typeof serverPluginsChanged | typeof projectCapabilitiesChanged,
  key: string,
) {
  window.dispatchEvent(new CustomEvent(event, { detail: key }));
  try {
    localStorage.setItem(event, JSON.stringify({ key, at: crypto.randomUUID() }));
  } catch {
    // Views in this window still receive the event when storage is unavailable.
  }
}
