/**
 * A Project's server plugins were turned on or off in this window: the bindings they declare
 * come and go with them, so the views that read the bindings read them again. Other windows
 * learn of it when they are next shown (use-tool-bindings.ts), and of a binding change from the
 * server's `tool_bindings_changed` event.
 */
const PLUGINS_CHANGED = "penguin-server-plugins-changed";

export function notifyPluginsChanged(projectId: string): void {
  window.dispatchEvent(new CustomEvent(PLUGINS_CHANGED, { detail: projectId }));
}

/** Calls `fn` with the Project of every such change until the returned function is called. */
export function onPluginsChanged(fn: (projectId: string) => void): () => void {
  const listener = (event: Event) => fn((event as CustomEvent<string>).detail);
  window.addEventListener(PLUGINS_CHANGED, listener);
  return () => window.removeEventListener(PLUGINS_CHANGED, listener);
}
