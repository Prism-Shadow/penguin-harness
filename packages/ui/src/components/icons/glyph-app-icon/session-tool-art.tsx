import type { ReactNode } from "react";
import { APP_MARK_PATHS } from "../icons";

/** Original app marks on the same mask as the other system applications. All detail is
 * internal to the silhouette so the folder tab, prompt and needle still read at 16px. */
export const sessionToolArt = new Map<string, ReactNode>([
  [
    "session-tools-terminal",
    <svg aria-hidden="true" viewBox="0 0 32 32" className="block size-full">
      <rect
        width="32"
        height="32"
        fill="color-mix(in oklab, var(--ui-icon-tint-slate) 28%, black)"
      />
      <path
        d={APP_MARK_PATHS.terminal.divider}
        stroke="white"
        strokeOpacity=".18"
        strokeWidth="1.5"
      />
      <path
        d={APP_MARK_PATHS.terminal.prompt}
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={APP_MARK_PATHS.terminal.cursor}
        stroke="color-mix(in oklab, var(--ui-icon-tint-green) 45%, white)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>,
  ],
  [
    "session-tools-workspace",
    <svg aria-hidden="true" viewBox="0 0 32 32" className="block size-full">
      <rect
        width="32"
        height="32"
        fill="color-mix(in oklab, var(--ui-icon-tint-blue) 10%, white)"
      />
      <path
        d={APP_MARK_PATHS.workspace.back}
        fill="color-mix(in oklab, var(--ui-icon-tint-blue) 72%, black)"
      />
      <path d={APP_MARK_PATHS.workspace.paper} fill="white" />
      <path d={APP_MARK_PATHS.workspace.front} fill="var(--ui-icon-tint-blue)" />
    </svg>,
  ],
  [
    "session-tools-builtin-browser",
    <svg aria-hidden="true" viewBox="0 0 32 32" className="block size-full">
      <rect
        width="32"
        height="32"
        fill="color-mix(in oklab, var(--ui-icon-tint-blue) 14%, white)"
      />
      <circle
        cx="16"
        cy="16"
        r="12.9"
        fill="color-mix(in oklab, var(--ui-icon-tint-blue) 78%, black)"
      />
      <path
        d={APP_MARK_PATHS.browser.ticks}
        fill="none"
        stroke="white"
        strokeOpacity=".85"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d={APP_MARK_PATHS.browser.needleSouth} fill="white" />
      <path
        d={APP_MARK_PATHS.browser.needleNorth}
        fill="color-mix(in oklab, var(--ui-icon-tint-red) 70%, white)"
      />
    </svg>,
  ],
]);
