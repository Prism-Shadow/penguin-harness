/**
 * Which profile this instance runs as — release, or the dev instance beside it — as the desktop
 * shell hands it to its server (`PENGUIN_PROFILE`; layout.ts says what a profile decides).
 *
 * Its own module, importing nothing: the plugin face exports `profileFromEnv`, and a code plugin
 * bundles what it imports from the face, so this rule must not bring core's barrel (layout.ts's
 * port defaults) into every plugin that asks which profile it runs under.
 */
export type Profile = "release" | "dev";

/** `PENGUIN_PROFILE=dev` selects the dev profile; anything else is release. */
export function profileFromEnv(env: NodeJS.ProcessEnv): Profile {
  return env.PENGUIN_PROFILE?.trim() === "dev" ? "dev" : "release";
}
