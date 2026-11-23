import { createElement as h, type ReactNode } from "react";
import { PageWorkspace } from "../../src/lib/page-workspace";
import { OpenPages } from "../../src/features/page-workspace";
import { AppCenterWindows } from "../../src/features/app-center/app-center-windows";
import { S } from "../../src/lib/strings";
import { button, click } from "./dom";

export function WorkspaceWindows({ children }: { children?: ReactNode }) {
  return h(PageWorkspace, null, h(OpenPages), h(AppCenterWindows), children);
}

export async function pageAction(title: string, action: string) {
  await click(button(S.pageWorkspace.actions + " · " + title));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent?.trim() === action,
  );
  if (!item) throw new Error("No page action named " + action);
  await click(item);
}
