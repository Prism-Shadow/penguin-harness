/**
 * Origin hint for an App Center request: the `[app_center]` block at the start of the message
 * is not rendered verbatim; it collapses into one line reading "App Center: restart <app>" (the
 * App Center's grid glyph + static text, no navigation — the app's row lives on the App Center
 * page). The request's instruction body after the block is rendered as usual by the caller.
 */
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { APP_CENTER_ICON } from "../../components/ui/icons";
import type { AppCenterOrigin } from "./agent-handoff";

export function AppCenterBanner({ origin }: { origin: AppCenterOrigin }) {
  return (
    <p className="anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      <GlyphIcon d={APP_CENTER_ICON} className="text-gray-400 dark:text-gray-500" />
      {S.chat.appCenterAction(origin.appName ?? origin.appId, origin.action)}
    </p>
  );
}
