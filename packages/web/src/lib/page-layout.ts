export const PAGE_DRAG_TYPE = "application/x-penguin-open-page";

/** Page identity stays stable when the page changes its inner address or title. */
export interface OpenPage {
  id: string;
  kind: "session" | "window" | "system" | "catalog" | "workbenches";
  title: string;
  path: string;
}

export interface PageLayout {
  pages: OpenPage[];
  visible: string[];
  focus: string | null;
  right: string[];
  recent: string[];
  minimized: string[];
}

export const emptyLayout: PageLayout = {
  pages: [],
  visible: [],
  focus: null,
  right: [],
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
  if (before.title === page.title && before.path === page.path) return layout.pages;
  return layout.pages.map((item) => (item.id === page.id ? page : item));
}

function assigned(right: string[], id: string, side: number) {
  if (right.includes(id) === (side === 1)) return right;
  return side === 1 ? [...right, id] : right.filter((key) => key !== id);
}

/** A link opens in the current pane. A page already open returns to its own pane. */
export function visitPage(layout: PageLayout, page: OpenPage): PageLayout {
  const pages = withPage(layout, page);
  if (layout.visible.includes(page.id)) {
    return pages === layout.pages && layout.focus === page.id
      ? layout
      : { ...layout, ...raised(layout, page.id), pages, focus: page.id };
  }
  const split = layout.visible.length > 1;
  const known = layout.pages.some((item) => item.id === page.id);
  const side =
    split && (known ? layout.right.includes(page.id) : layout.visible[1] === layout.focus) ? 1 : 0;
  const visible = [...layout.visible];
  visible[side] = page.id;
  return {
    ...raised(layout, page.id),
    pages,
    visible,
    focus: page.id,
    right: assigned(layout.right, page.id, side),
  };
}

/** Placing the visible page on the other side exchanges the two. */
export function placePage(layout: PageLayout, page: OpenPage, side: 0 | 1): PageLayout {
  const other = layout.visible[1 - side];
  const beside =
    other && other !== page.id
      ? other
      : (layout.visible.find((id) => id !== page.id) ??
        layout.pages.findLast((item) => item.id !== page.id && !layout.minimized.includes(item.id))
          ?.id);
  if (!beside) return visitPage(layout, page);
  const visible = side === 0 ? [page.id, beside] : [beside, page.id];
  const right = assigned(assigned(layout.right, page.id, side), beside, 1 - side);
  return {
    ...raised(layout, page.id),
    pages: withPage(layout, page),
    visible,
    focus: page.id,
    right,
  };
}

export function closePage(layout: PageLayout, id: string): PageLayout {
  const index = layout.pages.findIndex((page) => page.id === id);
  if (index < 0) return layout;
  const pages = layout.pages.filter((page) => page.id !== id);
  let visible = [...layout.visible];
  const side = visible.indexOf(id);
  if (side >= 0) {
    const candidates = pages.filter(
      (page) =>
        !visible.includes(page.id) &&
        !layout.minimized.includes(page.id) &&
        (visible.length === 1 || layout.right.includes(page.id) === (side === 1)),
    );
    const neighbor =
      candidates.find((page) => layout.pages.indexOf(page) > index) ?? candidates.at(-1);
    if (neighbor) visible[side] = neighbor.id;
    else visible = visible.filter((key) => key !== id);
  }
  const right = visible.length < 2 ? [] : layout.right.filter((key) => key !== id);
  return {
    recent: layout.recent.filter((key) => key !== id),
    minimized: layout.minimized.filter((key) => key !== id),
    pages,
    visible,
    right,
    focus:
      layout.focus === id ? (visible[Math.min(side, visible.length - 1)] ?? null) : layout.focus,
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
