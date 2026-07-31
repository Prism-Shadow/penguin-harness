/** Platform-specific label for the global documentation search shortcut. */
export function getSearchShortcutLabel(platform: string | undefined): string {
  return platform && /(Mac|iPhone|iPad|iPod)/i.test(platform) ? "⌘ K" : "Ctrl K";
}

/** Read the current browser platform without making module evaluation browser-only. */
export function currentSearchShortcutLabel(): string {
  const platform =
    typeof navigator === "undefined" ? undefined : navigator.platform || navigator.userAgent;
  return getSearchShortcutLabel(platform);
}
