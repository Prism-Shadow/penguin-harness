/**
 * What the sandbox's settings document means for a NEW Session — the policy reads are
 * `@prismshadow/penguin-library-sandbox`, which reads the table resolver through an injected
 * port; this module re-exports them where the harness has always found them. The resolver
 * itself is the settings machinery's (../plugin/config.js): pass it at each call.
 */
export {
  DEFAULT_PRESET,
  prePresetNotice,
  prePresetStartOf,
  sandboxEnabledOf,
  sandboxPresetsOf,
  sandboxStartOf,
} from "@prismshadow/penguin-library-sandbox/policy";
export type {
  SandboxConfiguration,
  SandboxTableResolver,
} from "@prismshadow/penguin-library-sandbox/policy";
