/**
 * A server install's staged bar, at whichever size its surface has room for: the install sheet
 * draws it full width under the plugin's name, the market card draws the same bar under its
 * install action's words, and a package update draws it in its confirmation. One plan and one
 * reading of the server's reports feed all three (install-progress.ts), so they never disagree.
 */
import { useRef } from "react";

import { StagedProgress } from "@prismshadow/penguin-ui";
import type { ProgressBarSize } from "@prismshadow/penguin-ui";
import type { InstallStage } from "@prismshadow/penguin-web/internal";
import {
  furthest,
  installBar,
  installReading,
  placeOf,
  planStages,
  type BarPlace,
  type DownloadProgress,
  type InstallPhase,
  type InstallStep,
} from "./install-progress";

export function InstallProgress({
  plan,
  phase,
  stage,
  progress,
  size = "sm",
  label,
  valueText,
}: {
  plan: readonly InstallStep[];
  phase: InstallPhase;
  /** The server's last report: the running install's, or the one a failed install stopped at. */
  stage: InstallStage | null | undefined;
  progress: DownloadProgress | null | undefined;
  size?: ProgressBarSize;
  label: string;
  valueText?: string | undefined;
}) {
  // The furthest place this attempt has reached: a later report never draws the bar behind it.
  // A new attempt starts over, which is the one time the bar may empty.
  const reached = useRef<BarPlace | null>(null);
  const reported = placeOf(plan, installReading(stage, progress));
  const place = phase === "running" ? furthest(reached.current, reported) : reported;
  reached.current = phase === "running" ? place : null;
  const bar = installBar(plan, phase, phase === "running" || phase === "failed" ? place : null);
  return (
    <StagedProgress
      stages={planStages(plan)}
      current={bar.current}
      {...(bar.value !== undefined ? { value: bar.value } : {})}
      status={bar.status}
      size={size}
      label={label}
      {...(valueText !== undefined ? { valueText } : {})}
    />
  );
}
