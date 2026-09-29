/**
 * What an auth guard shows while `GET /api/me` is still in flight.
 *
 * Rendering nothing there leaves the page's body colour on screen — in the dark theme a pure
 * black window (`gray-950` is overridden to `#000000`) with no mark at all, for as long as that
 * request takes. Over a slow link that is seconds, and it cannot be told apart from a dead app.
 *
 * The status fades in only after a short delay (`.anim-boot-pending`), so a fast load goes
 * straight from the empty body to the shell without a word blinking in between. With reduced
 * motion the animation is off and the text is simply there, which is still correct.
 */
import { S } from "../../lib/strings";

export function BootPending() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="anim-boot-pending flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-500"
    >
      {S.common.loading}
    </div>
  );
}
