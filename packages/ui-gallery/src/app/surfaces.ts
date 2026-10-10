/**
 * The app's surfaces: what the gallery frames, one page each (`/s/<id>`), grouped the way the
 * index and the left nav list them. A surface is a route of the real Web App plus how the
 * frame opens it — signed in or out, and a dialog to open once it is up. The titles and
 * descriptions are chrome copy (`S.surfaces`), keyed by these ids.
 *
 * Pure data with no value imports, so Node can import this file as it is (the screenshot
 * script does): the ids the routes name are spelled here, and a test holds them to the demo
 * store's (src/app/mock/ids.ts).
 */

export const SURFACE_GROUP_IDS = [
  "conversation",
  "workbench",
  "resources",
  "measure",
  "system",
] as const;
export type SurfaceGroupId = (typeof SURFACE_GROUP_IDS)[number];

export const SURFACE_IDS = [
  "chat",
  "chat-running",
  "chat-thinking",
  "chat-streaming",
  "chat-approval",
  "chat-harness",
  "chat-org",
  "chat-new",
  "agents",
  "agent-settings",
  "schedules",
  "plugins",
  "models",
  "machines",
  "usage",
  "benchmark",
  "benchmark-detail",
  "settings",
  "settings-appearance",
  "login",
] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

/** A dialog the frame asks the app to open once it is up: Settings, on the page named after the dot. */
export type SurfaceOpen = "settings" | `settings.${string}`;

export interface Surface {
  id: SurfaceId;
  group: SurfaceGroupId;
  /** The app route the frame opens on (path, query and all). */
  route: string;
  /** Start signed out: the frame lands on the login page and signs in from there. */
  signedOut?: true;
  open?: SurfaceOpen;
}

export const SURFACES: readonly Surface[] = [
  { id: "chat", group: "conversation", route: "/chat/s-hooks-index" },
  { id: "chat-running", group: "conversation", route: "/chat/s-link-check" },
  { id: "chat-thinking", group: "conversation", route: "/chat/s-release-plan" },
  { id: "chat-streaming", group: "conversation", route: "/chat/s-citation-guard" },
  { id: "chat-approval", group: "conversation", route: "/chat/s-publish" },
  { id: "chat-harness", group: "conversation", route: "/chat/s-harness-rows" },
  { id: "chat-org", group: "conversation", route: "/chat/s-org-digest" },
  { id: "chat-new", group: "conversation", route: "/chat" },
  { id: "agents", group: "workbench", route: "/agents" },
  { id: "agent-settings", group: "workbench", route: "/agents/docs-expert" },
  { id: "schedules", group: "workbench", route: "/agents/docs-expert?tab=schedules" },
  { id: "plugins", group: "resources", route: "/plugins" },
  { id: "models", group: "resources", route: "/models" },
  { id: "machines", group: "resources", route: "/machines" },
  { id: "usage", group: "measure", route: "/usage" },
  { id: "benchmark", group: "measure", route: "/benchmark" },
  { id: "benchmark-detail", group: "measure", route: "/benchmark/docs-qa-v1" },
  { id: "settings", group: "system", route: "/chat/s-hooks-index", open: "settings" },
  {
    id: "settings-appearance",
    group: "system",
    route: "/chat/s-hooks-index",
    open: "settings.appearance",
  },
  { id: "login", group: "system", route: "/login", signedOut: true },
];

const BY_ID = new Map<string, Surface>(SURFACES.map((surface) => [surface.id, surface]));

export const isSurfaceId = (id: string): id is SurfaceId => BY_ID.has(id);

export function surfaceById(id: string): Surface | undefined {
  return BY_ID.get(id);
}

/** The groups in index order, each listing its surfaces in `SURFACES` order. */
export const SURFACE_GROUPS: readonly { id: SurfaceGroupId; surfaces: readonly Surface[] }[] =
  SURFACE_GROUP_IDS.map((id) => ({
    id,
    surfaces: SURFACES.filter((surface) => surface.group === id),
  }));

/** The surface the home page frames: the finished conversation, the app's everyday view. */
export const HOME_SURFACE: SurfaceId = "chat";
