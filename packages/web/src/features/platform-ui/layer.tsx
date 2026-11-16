/**
 * The platform UI layer: the page's identity on the bridge, the poll that keeps it reachable,
 * and the element picker's overlay.
 *
 * It is one of the app's `layers` — mounted once beside the shell and never inside a page, so
 * a route change does not reconnect it and a conversation switch does not drop a held poll.
 * That is also why the picker can cover the whole window: this component is outside every
 * scroll container and every stacking context the pages build.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useProject } from "../../state/project";
import { startPlatformUiBridge } from "./bridge";
import { PickOverlay, setPickerPageId } from "./picker";

const PAGE_ID_KEY = "penguin.platformUi.pageId";

/** This tab's bridge id: stable across reloads, distinct per tab. */
function pageIdForTab(): string {
  try {
    const stored = sessionStorage.getItem(PAGE_ID_KEY);
    if (stored !== null && stored !== "") return stored;
    const made = `page-${crypto.randomUUID()}`;
    sessionStorage.setItem(PAGE_ID_KEY, made);
    return made;
  } catch {
    return `page-${Math.random().toString(36).slice(2)}`;
  }
}

/** What the bridge reports as "the screen": the route the app is on and the document's title. */
export function PlatformUiLayer() {
  const location = useLocation();
  const { currentProject } = useProject();
  const [pageId] = useState(pageIdForTab);
  const whereRef = useRef({ route: `${location.pathname}${location.search}`, title: "" });
  whereRef.current = {
    route: `${location.pathname}${location.search}${location.hash}`,
    title: typeof document === "undefined" ? "" : document.title,
  };
  const projectRef = useRef<string | null>(currentProject?.projectId ?? null);
  projectRef.current = currentProject?.projectId ?? null;

  useEffect(() => {
    setPickerPageId(pageId);
    const bridge = startPlatformUiBridge({
      pageId,
      projectId: projectRef.current,
      where: () => ({
        route: whereRef.current.route,
        title: typeof document === "undefined" ? "" : document.title,
      }),
    });
    return () => bridge.stop();
  }, [pageId]);

  return <PickOverlay />;
}
