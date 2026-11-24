import type { WorkbenchInfo, WorkbenchVersion } from "@prismshadow/penguin-server/api";
import type { DemoStore } from "./store";

/** The shipped Support page before live replies, preserved from penguin-harness commit 5d01f6a48. */
export const EARLY_SUPPORT = {
  revision: "2026.10.14.3",
  commit: "5d01f6a48a85",
  savedAt: "2026-10-14T23:06:52+08:00",
} satisfies WorkbenchVersion;

const records = new WeakMap<DemoStore, Map<string, WorkbenchVersion[]>>();

/** Each browser demo (including each machine) owns its history for the life of its store. */
export function workbenchVersions(store: DemoStore, agent: string, workbench: WorkbenchInfo) {
  const key = agent + "/" + workbench.id;
  let catalog = records.get(store);
  if (!catalog) {
    catalog = new Map();
    records.set(store, catalog);
  }
  let versions = catalog.get(key);
  if (!versions) {
    versions = [
      {
        commit: "installed-" + workbench.revision,
        savedAt: new Date().toISOString(),
        revision: workbench.revision,
      },
    ];
    if (key === "penguin_support/support") versions.push(EARLY_SUPPORT);
    catalog.set(key, versions);
  }
  return versions;
}
