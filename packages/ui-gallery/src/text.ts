/**
 * The localized names every page prints: the surfaces and their groups, the library topics and
 * their groups and the breadcrumb's qualifiers, from the dictionaries; a theme's display name, from
 * its pack's manifest (`names`), which is where every picker reads it.
 */
import { builtinPack } from "@prismshadow/penguin-ui";
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
  /** The pack's name in the page's language, from its manifest. */
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
    theme: (id) => builtinPack(id).names[state.lang],
    qualifiers: () => ({
      mode: S.crumb.modes[mode],
      accent: accent === THEME_ACCENT ? undefined : accent,
      view: state.view === "phone" ? S.crumb.phone : undefined,
    }),
  };
}
