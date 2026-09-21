/**
 * The four media-type marks the scene tree draws, one per asset type. 24x24 paths
 * for `GlyphIcon`, which supplies the stroke and the size from the shared scale.
 * A type is never carried by the mark alone — every row names its type in text.
 */

import type { SceneAssetType } from "./scene-assets";

export const SCENE_ASSET_ICON: Record<SceneAssetType, string> = {
  /** A framed picture with a horizon and a sun. */
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 8.5h.01",
  /** A speaker cone with one radiating arc. */
  audio: "M4 9h4l5-4v14l-5-4H4zM17 9.5a4 4 0 0 1 0 5",
  /** A frame with a lens flare, the film mark. */
  video: "M3 5h18v14H3zM3 10h18M8 5l-2 5M14 5l-2 5M20 5l-2 5",
  /** Stacked frames, the motion mark. */
  animation: "M8 3h13v13M3 8h13v13H3z",
};
