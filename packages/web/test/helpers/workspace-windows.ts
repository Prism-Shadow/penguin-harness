import { createElement as h, type ReactNode } from "react";
import * as dock from "../../src/features/dock";
import { PageWorkspace } from "../../src/lib/page-workspace";
import { MainSidebarApps } from "../../src/features/session-list/main-sidebar-apps";
import { AppCenterWindows } from "../../src/features/app-center/app-center-windows";
import { click } from "./dom";

export function WorkspaceWindows({ children }: { children?: ReactNode }): ReactNode {
  return h(PageWorkspace, { dock }, h(MainSidebarApps), h(AppCenterWindows), children);
}

export async function pageAction(title: string, action: string) {
  const row = [...document.querySelectorAll<HTMLElement>("button[data-app-row]")]
    .find((element) => element.querySelector(".truncate")?.textContent === title)
    ?.closest("li");
  const trigger = row?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  if (!trigger) throw new Error("No running app named " + title);
  await click(trigger);
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent?.trim() === action,
  );
  if (!item) throw new Error("No page action named " + action);
  await click(item);
}
