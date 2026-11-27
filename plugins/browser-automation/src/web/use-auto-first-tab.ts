import { useEffect, useRef } from "react";

/**
 * Opens the panel's first tab by itself when it comes on screen with none, the way the terminal
 * panel allocates its first shell. `offered` is the panel's own "may offer a first tab" verdict
 * (shown, usable, no tab, no guest, nothing opening), so an unavailable browser or an existing
 * tab never reaches `open`.
 *
 * It fires once per time the panel is shown for a conversation: a re-render while the open is
 * outstanding does not repeat it, and closing the last tab leaves the panel's New tab button
 * rather than conjuring another tab under the user's cursor. Hiding the panel or switching
 * conversation re-arms it.
 */
export function useAutoFirstTab(offered: boolean, shown: boolean, scope: string, open: () => void) {
  const fired = useRef<string | null>(null);
  const latestOpen = useRef(open);
  latestOpen.current = open;
  useEffect(() => {
    if (!shown) {
      fired.current = null;
      return;
    }
    if (!offered || fired.current === scope) return;
    fired.current = scope;
    latestOpen.current();
  }, [offered, shown, scope]);
}
