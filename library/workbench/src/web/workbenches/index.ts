export { WorkbenchFrame } from "./workbench-frame";

export { useAppPageTab } from "./use-app-page-tab";

export { WorkbenchExitBall } from "./exit-ball";

export type { AppPageTabQuery } from "./use-app-page-tab";

// The workbench operations and load-failure report live in the host's `lib/` — the features that
// manage workbenches outside the half share them — and reach the half through the host seam.
export {
  useWorkbenchActions,
  useWorkbenchPaletteActions,
  workbenchLoadFailure,
} from "@prismshadow/penguin-web/internal";

export type {
  LoadFailedActions,
  FailedWorkbench,
  WorkbenchLoadError,
} from "@prismshadow/penguin-web/internal";

export { WorkbenchPageStatus } from "./workbench-page-status";
