/**
 * The scene-video experiment's server switch (see composition.ts): off until an admin turns it
 * on, and read per request, so flipping it needs no restart.
 */

/** Key of the switch in `server_settings`; absent means off. */
export const VIDEO_EXPERIMENT_SETTING = "activityVideoExperiment";

/** The switch as stored: on only when it was set to true. */
export function readVideoExperiment(raw: string | null): boolean {
  return raw === "true";
}
