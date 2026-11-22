/**
 * What a contributed page's frame is told about the app it is shown in, beside the appearance
 * (lib/workbench-theme.ts): written on the frame document's root element, which is where the page
 * reads it, and written again whenever it changes.
 *
 * - `lang`: the interface language, as the app's own root carries it (`zh-CN`, `en`).
 * - `data-project-id`: the current Project; absent when there is none.
 *
 * The frame is same-origin (PAGE_FRAME_SANDBOX), so the root is reachable; a frame still loading,
 * or a document of another origin, simply gets nothing until its next load.
 */

export const FRAME_PROJECT_ATTR = "data-project-id";

export interface FrameContext {
  lang: string;
  projectId: string | null;
}

/** Writes `context` on the frame's root, if the frame's document is reachable. */
export function stampFrameContext(frame: HTMLIFrameElement | null, context: FrameContext): void {
  try {
    const root = frame?.contentDocument?.documentElement;
    if (!root || frame?.contentDocument?.readyState === "loading") return;
    if (root.getAttribute("lang") !== context.lang) root.setAttribute("lang", context.lang);
    if (context.projectId === null) root.removeAttribute(FRAME_PROJECT_ATTR);
    else if (root.getAttribute(FRAME_PROJECT_ATTR) !== context.projectId)
      root.setAttribute(FRAME_PROJECT_ATTR, context.projectId);
  } catch {
    // Not our document to write on.
  }
}
