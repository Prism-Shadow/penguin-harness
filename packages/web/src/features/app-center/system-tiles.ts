/**
 * The system apps as App Center tiles. Each system app the viewer sees (lib/system-apps.ts)
 * becomes a shortcut of the system Agent keyed `system_agent/<page key>`, so the arrangement
 * places it as it places any app: listed before the server's shortcuts, it comes first, in the
 * system apps' order, while the viewer has no layout of their own, and a layout that does not
 * name it gets it appended at the end, as a new app is. It is always ready and draws its page's
 * glyph; the server never lists it, so a machine's tiles never carry one.
 *
 * One a server module contributes as an iframe opens in the App Center's window like any app: its
 * shortcut carries the frame's document, and its `path` is its full page (`systemAppFullPage`).
 * Every other one opens its page, at `path`.
 */
import { SYSTEM_AGENT_ID } from "../../lib/builtin-agents";
import { glyphOf } from "../../lib/nav-icons";
import { systemAppFullPage, type SystemApp } from "../../lib/system-apps";
import type { LocatedShortcut } from "./arrangement";

export function systemShortcutsOf(
  apps: readonly SystemApp[],
  projectId: string | null,
): LocatedShortcut[] {
  return apps.map((app) => {
    // A window is a Project's: without one there is no window to open, nor a full page.
    const windowed = app.frame !== undefined && projectId !== null;
    return {
      agentId: SYSTEM_AGENT_ID,
      agentName: "",
      workbenchId: app.key,
      title: app.title,
      ...(app.titleZh !== undefined ? { titleZh: app.titleZh } : {}),
      path: windowed ? systemAppFullPage(projectId, app.key) : app.path,
      build: "ready",
      system: { glyph: glyphOf(app.icon), ...(windowed ? { frame: app.frame } : {}) },
    };
  });
}
