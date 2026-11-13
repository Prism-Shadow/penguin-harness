/**
 * While safe mode is on, a small pill at the bottom centre says so and offers the way out in
 * one click. It sits beside the shell's tree (app.tsx), so it shows over the rescue panel too.
 * Leaving is immediate — the contributions consumer asks the server again — and needs no reload.
 */
import { toneSurface } from "../lib/tone";
import { S } from "../lib/strings";
import { setSafeMode, useSafeMode } from "./safe-mode";

export function SafeModeMarker() {
  const safe = useSafeMode();
  if (!safe) return null;
  return (
    // z-40 with the menus: above the page, below a dialog's overlay.
    <div
      role="status"
      className={`fixed bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200 px-3 py-1 text-xs shadow-sm dark:border-amber-900 ${toneSurface.attention}`}
    >
      <span>{S.rescue.marker}</span>
      <button
        type="button"
        onClick={() => setSafeMode(false)}
        className="rounded-full px-1.5 font-medium underline underline-offset-2 hover:no-underline"
      >
        {S.rescue.leave}
      </button>
    </div>
  );
}
