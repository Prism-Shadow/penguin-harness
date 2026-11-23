import type { ReactNode } from "react";

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
      <path d="M5 7h22" stroke="white" strokeOpacity=".18" strokeWidth="1.5" />
      <path
        d="m7 13 5.5 5-5.5 5"
        fill="none"
        stroke="white"
        strokeWidth="2.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 23h7"
        stroke="color-mix(in oklab, var(--ui-icon-tint-green) 45%, white)"
        strokeWidth="2.8"
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
        d="M4 10a2.3 2.3 0 0 1 2.3-2.3h5.5l3.1 2.7h10.7a2.2 2.2 0 0 1 2.2 2.2v10.8H4z"
        fill="color-mix(in oklab, var(--ui-icon-tint-blue) 72%, black)"
      />
      <path d="M6.6 13h18.8v4H6.6z" fill="white" />
      <path
        d="M3.7 15a1.8 1.8 0 0 1 1.8-1.8h21a1.8 1.8 0 0 1 1.8 1.8l-1 8.3a2.3 2.3 0 0 1-2.3 2H7a2.3 2.3 0 0 1-2.3-2z"
        fill="var(--ui-icon-tint-blue)"
      />
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
        d="M16 4.8v2M27.2 16h-2M16 27.2v-2M4.8 16h2"
        fill="none"
        stroke="white"
        strokeOpacity=".85"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="m7.5 24.5 5.9-11.1 5.2 5.2z" fill="white" />
      <path
        d="m24.5 7.5-5.9 11.1-5.2-5.2z"
        fill="color-mix(in oklab, var(--ui-icon-tint-red) 70%, white)"
      />
    </svg>,
  ],
]);
