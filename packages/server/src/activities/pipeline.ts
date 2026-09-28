/**
 * The nine generation stages ported from Loom, declared as data.
 *
 * Loom's own order lives in a string array in an Angular component and is passed in by the
 * caller; this list is the server's. The dependencies are what each stage actually reads,
 * taken from Loom's stage implementations rather than from its ordering, because the two
 * are separate statements and `misorderedStages` exists to catch them disagreeing.
 *
 * `sharedModule` marks the three stages Loom gates to the canonical ref: they write the
 * module code every ref of a product shares.
 */
import type { ActivityStage } from "./stages.js";

export const SPEC_STAGE = "generate_activity_spec";
export const MEDIA_SPEC_STAGE = "generate_media_spec";
export const PREPARE_MEDIA_STAGE = "prepare_media_assets";
export const SCAFFOLD_STAGE = "scaffold_module";
export const ASSETS_CONFIG_STAGE = "assets_configuration";
export const ASSESSMENT_STAGE = "generate_assessment";
export const AUDIO_STAGE = "generate_audio";
export const BEHAVIOR_STAGE = "implement_behavior";
export const IMAGES_STAGE = "generate_images";

/**
 * The stages an activity is built through. Two steps are deliberately not stages:
 * `validate_activity`, because Penguin already validates the specification and the
 * manifest, and `test_activity`, whose quality checks and acceptance tests run against the
 * played activity in the test browser as runs of their own (quality-check.ts and
 * acceptance-service.ts, the Module section's Check quality and Run tests) rather than as
 * stages of this list.
 */
export const PIPELINE_STAGES: readonly ActivityStage[] = [
  {
    id: SPEC_STAGE,
    order: 10,
    execution: "agent",
    dependsOn: [],
  },
  {
    id: MEDIA_SPEC_STAGE,
    order: 20,
    execution: "agent",
    dependsOn: [SPEC_STAGE],
  },
  {
    id: PREPARE_MEDIA_STAGE,
    order: 30,
    execution: "deterministic",
    dependsOn: [MEDIA_SPEC_STAGE],
  },
  {
    id: SCAFFOLD_STAGE,
    order: 40,
    execution: "deterministic",
    dependsOn: [SPEC_STAGE],
    sharedModule: true,
  },
  {
    id: ASSETS_CONFIG_STAGE,
    order: 50,
    execution: "deterministic",
    dependsOn: [PREPARE_MEDIA_STAGE, SCAFFOLD_STAGE],
  },
  {
    id: ASSESSMENT_STAGE,
    order: 60,
    execution: "agent",
    dependsOn: [SPEC_STAGE, SCAFFOLD_STAGE],
    sharedModule: true,
  },
  {
    // Calls speech, music and effect providers over HTTP. No workspace, no tools and no
    // approvals, which matters: most people using this are not engineers and should not be
    // approving anything to get narration.
    id: AUDIO_STAGE,
    order: 70,
    execution: "deterministic",
    dependsOn: [ASSETS_CONFIG_STAGE],
  },
  {
    // The heaviest stage in Loom: two agent passes, implement then review.
    id: BEHAVIOR_STAGE,
    order: 80,
    execution: "agent",
    dependsOn: [SCAFFOLD_STAGE, ASSESSMENT_STAGE],
    sharedModule: true,
  },
  {
    // SVG written by the agent, not a diffusion model.
    id: IMAGES_STAGE,
    order: 90,
    execution: "agent",
    dependsOn: [ASSETS_CONFIG_STAGE],
  },
];
