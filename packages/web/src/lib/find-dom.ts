/**
 * Find-in-page's DOM half — regions, the block index, the highlight paint and the reveal — lives
 * in the shared UI package (components/content/find), where the Markdown reader's find shares it
 * with the page's find bar (components/find/find-bar.tsx); this path keeps the app's imports.
 */
export {
  FIND_LOAD_OLDER_EVENT,
  FIND_MORE_ATTR,
  clearHighlights,
  findRegions,
  highlightsSupported,
  hitSnippet,
  indexRegions,
  paintHits,
  revealHit,
} from "@prismshadow/penguin-ui";
export type { FindHit, FindRegion, RevealResult } from "@prismshadow/penguin-ui";
