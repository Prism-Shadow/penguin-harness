/**
 * The localized names every page prints: the surfaces and their groups, the library topics and
 * their groups, the theme display names, and the breadcrumb's qualifiers — all from the
 * dictionaries.
 */
import type { ThemeId } from "@prismshadow/penguin-ui";
import type { SurfaceGroupId, SurfaceId } from "./app/surfaces";
import { THEME_ACCENT } from "./lib/accents";
import type { TopicGroupId, TopicId } from "./library/topics";
import { useGallery } from "./state";
import type { SurfaceCopy } from "./strings";

export function useText(): {
  surface: (id: SurfaceId) => SurfaceCopy;
  surfaceGroup: (id: SurfaceGroupId) => string;
  topic: (id: TopicId) => { title: string; description: string };
  topicGroup: (id: TopicGroupId) => string;
  /** 通用 / 白领 / 极客, or Primer / Frost / Console. */
  theme: (id: ThemeId) => string;
  /** The breadcrumb's qualifiers: the mode word, the accent id when applied, the phone frame's word. */
  qualifiers: () => { mode: string; accent: string | undefined; view: string | undefined };
} {
  const { S, state, mode, accent } = useGallery();
  return {
    surface: (id) => S.surfaces[id],
    surfaceGroup: (id) => S.surfaceGroups[id],
    topic: (id) => S.library.topics[id],
    topicGroup: (id) => S.library.groups[id],
    theme: (id) => S.rail.themeNames[id],
    qualifiers: () => ({
      mode: S.crumb.modes[mode],
      accent: accent === THEME_ACCENT ? undefined : accent,
      view: state.view === "phone" ? S.crumb.phone : undefined,
    }),
  };
}
