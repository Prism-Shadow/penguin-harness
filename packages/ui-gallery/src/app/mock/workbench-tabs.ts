/** Installed workbench pages always open through the app's ordinary frame and owner-specific URL. */
import { workbenchUiUrl as installedUrl } from "../../../../web/src/lib/workbench-tabs";
export * from "../../../../web/src/lib/workbench-tabs";

export function workbenchUiUrl(tab: Parameters<typeof installedUrl>[0]): string {
  const url = installedUrl(tab);
  if (!/^\/(?:server\/[^/]+\/)?api\/projects\/demo\/agents\/(?:default_agent\/workbenches\/(?:images|slides)|penguin_support\/workbenches\/support)\/ui\//.test(url)) return url;
  return import.meta.env.BASE_URL + "demo-workbenches" + url;
}
