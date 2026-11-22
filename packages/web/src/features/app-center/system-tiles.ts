/**
 * The system apps as App Center tiles. Each system app the viewer sees (lib/system-apps.ts)
 * becomes a shortcut of the system Agent keyed `system_agent/<page key>`, so the arrangement
 * places it as it places any app: listed before the server's shortcuts, it comes first, in the
 * system apps' order, while the viewer has no layout of their own, and a layout that does not
 * name it gets it appended at the end, as a new app is. It is always ready, opens its page, and
 * draws its page's glyph; the server never lists it, so a machine's tiles never carry one.
 */
import { SYSTEM_AGENT_ID } from "../../lib/builtin-agents";
import { glyphOf } from "../../lib/nav-icons";
import type { SystemApp } from "../../lib/system-apps";
import type { LocatedShortcut } from "./arrangement";

export function systemShortcutsOf(apps: readonly SystemApp[]): LocatedShortcut[] {
  return apps.map((app) => ({
    agentId: SYSTEM_AGENT_ID,
    agentName: "",
    workbenchId: app.key,
    title: app.title,
    ...(app.titleZh !== undefined ? { titleZh: app.titleZh } : {}),
    path: app.path,
    build: "ready",
    system: { glyph: glyphOf(app.icon) },
  }));
}
