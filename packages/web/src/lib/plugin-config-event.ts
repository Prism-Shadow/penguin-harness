/**
 * Same-tab notification that a settings group was saved on the Plugins page. The composer's
 * permission menu is drawn from the Sandbox card (its switch, presets, default preset), but
 * reaches it through the Session's and the chat defaults' sandbox view, which a page reads
 * once: without this, a draft or an open conversation kept the menu it had before the save —
 * approval modes only after the switch was turned on, the old presets after an edit — until
 * the page was reloaded. The Plugins page dispatches after its PUT lands; a mounted draft and
 * conversation read their view again.
 */
export const PLUGIN_CONFIG_SAVED_EVENT = "penguin:plugin-config-saved";

export interface PluginConfigSavedDetail {
  /** The saved group's name (`sandbox`), and the card it is drawn in. */
  group: string;
  card: string;
}

export function dispatchPluginConfigSaved(detail: PluginConfigSavedDetail): void {
  window.dispatchEvent(
    new CustomEvent<PluginConfigSavedDetail>(PLUGIN_CONFIG_SAVED_EVENT, { detail }),
  );
}

/** Calls `cb` after every save of the card named `card`; returns the unsubscribe. */
export function onPluginConfigSaved(card: string, cb: () => void): () => void {
  const listener = (e: Event) => {
    if ((e as CustomEvent<PluginConfigSavedDetail>).detail?.card === card) cb();
  };
  window.addEventListener(PLUGIN_CONFIG_SAVED_EVENT, listener);
  return () => window.removeEventListener(PLUGIN_CONFIG_SAVED_EVENT, listener);
}
