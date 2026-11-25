/** Installed workbench pages always open through the app's ordinary frame and owner-specific URL. */
import { EARLY_SUPPORT } from "./workbench-revisions";
import { workbenchUiUrl as installedUrl } from "../../../../web/src/lib/workbench-tabs";
export * from "../../../../web/src/lib/workbench-tabs";

export function workbenchUiUrl(tab: Parameters<typeof installedUrl>[0]): string {
  const url = installedUrl(tab);
  if (
    !/^\/(?:server\/[^/]+\/)?api\/projects\/demo\/agents\/(?:default_agent\/workbenches\/(?:images|slides)|penguin_support\/workbenches\/support)\/ui\//.test(
      url,
    )
  )
    return url;
  const page =
    tab.uiRev === EARLY_SUPPORT.revision
      ? url.replace(
          "/penguin_support/workbenches/support/ui/index.html?",
          "/penguin_support/workbenches/support/ui/history-" + EARLY_SUPPORT.revision + ".html?",
        )
      : url;
  return import.meta.env.BASE_URL + "demo-workbenches" + page;
}
