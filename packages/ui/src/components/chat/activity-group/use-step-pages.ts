import { useSyncExternalStore } from "react";
import { currentActivityIsPaged, subscribeAppliedTheme } from "../../../themes/applied";

const list = () => false;
const idle = () => () => {};

/** Only an on-screen run or one watched here needs to react. All of them share one observer. */
export function useStepPages(live: boolean): boolean {
  return useSyncExternalStore(
    live ? subscribeAppliedTheme : idle,
    live ? currentActivityIsPaged : list,
    list,
  );
}
