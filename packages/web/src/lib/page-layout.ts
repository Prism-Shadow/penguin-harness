import type { SessionInfo } from "@prismshadow/penguin-server/api";
export const PAGE_DRAG_TYPE = "application/x-penguin-open-page";

/** Whether a drag carries one of this window's open pages, such as a running app's row. */
export const isOpenPageDrag = (data: Pick<DataTransfer, "types"> | null | undefined) =>
  !!data?.types.includes(PAGE_DRAG_TYPE);

/** Page identity stays stable when the page changes its inner address or title. */
export interface OpenPage {
  id: string;
  kind: "session" | "window" | "system" | "catalog" | "workbenches";
  title: string;
  path: string;
  /** Launched from the App Center inside a conversation, including its Session directories. */
  catalogDock?: boolean;
  /** An explicitly selected resource group can belong to another conversation. */
  resourceHost?: OpenPage["sessionHost"];
  /** Metadata already authorized by the exact machine's Session endpoint. Window-local only. */
  sessionHost?: { session: SessionInfo; machineId: string | null; isolatedDraft: boolean };
}

export const pageSessionId = (page: OpenPage) =>
  page.sessionHost?.session.sessionId ??
  decodeURIComponent(new URL(page.path, "http://localhost").pathname.slice("/chat/".length));

export const scopedChatId = (projectId: string, machineId: string | null, sessionId: string) =>
  "scoped-chat:" + JSON.stringify([projectId, machineId, sessionId]);

export interface PageLayout {
  pages: OpenPage[];
  visible: string[];
  focus: string | null;
  recent: string[];
  minimized: string[];
}

export const emptyLayout: PageLayout = {
  pages: [],
  visible: [],
  focus: null,
  recent: [],
  minimized: [],
};

function raised(layout: PageLayout, id: string) {
  return {
    recent:
      layout.recent[0] === id ? layout.recent : [id, ...layout.recent.filter((key) => key !== id)],
    minimized: layout.minimized.includes(id)
      ? layout.minimized.filter((key) => key !== id)
      : layout.minimized,
  };
}

function withPage(layout: PageLayout, page: OpenPage): OpenPage[] {
  const before = layout.pages.find((item) => item.id === page.id);
  if (!before) return [...layout.pages, page];
  if (
    before.title === page.title &&
    before.path === page.path &&
    before.catalogDock === page.catalogDock &&
    before.resourceHost === page.resourceHost &&
    before.sessionHost === page.sessionHost
  )
    return layout.pages;
  return layout.pages.map((item) => (item.id === page.id ? page : item));
}

/** An ordinary navigation shows one page. Only an explicit Session dock can present two. */
export function visitPage(layout: PageLayout, page: OpenPage): PageLayout {
  const pages = withPage(layout, page);
  if (pages === layout.pages && layout.focus === page.id && layout.visible.length === 1)
    return layout;
  return { ...layout, ...raised(layout, page.id), pages, visible: [page.id], focus: page.id };
}

export function closePage(layout: PageLayout, id: string): PageLayout {
  const index = layout.pages.findIndex((page) => page.id === id);
  if (index < 0) return layout;
  const pages = layout.pages.filter((page) => page.id !== id);
  const visible = layout.visible.filter((key) => key !== id);
  if (!visible.length && layout.visible.includes(id)) {
    const candidates = pages.filter((page) => !layout.minimized.includes(page.id));
    const neighbor =
      candidates.find((page) => layout.pages.indexOf(page) > index) ?? candidates.at(-1);
    if (neighbor) visible.push(neighbor.id);
  }
  return {
    recent: layout.recent.filter((key) => key !== id),
    minimized: layout.minimized.filter((key) => key !== id),
    pages,
    visible,
    focus: layout.focus === id ? (visible[0] ?? null) : layout.focus,
  };
}

export function reorderPage(layout: PageLayout, id: string, before: string): PageLayout {
  if (id === before) return layout;
  const page = layout.pages.find((item) => item.id === id);
  if (!page || !layout.pages.some((item) => item.id === before)) return layout;
  const pages = layout.pages.filter((item) => item !== page);
  pages.splice(
    pages.findIndex((item) => item.id === before),
    0,
    page,
  );
  return { ...layout, pages };
}
