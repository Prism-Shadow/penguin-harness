/**
 * The two specification passes' prompts, Loom's (`activity_spec_prompts.py`) adapted to how
 * a Penguin run works: the agent reads its inputs from the workspace and writes
 * `activity-spec.json`, rather than answering with the JSON.
 *
 * The first pass writes the scenes and keeps each description's media tags verbatim; the
 * second, `generate_media_spec`, lists the media those tags ask for in the exact places the
 * media plan reads (`scene.media.images`, `scene.media.video`, `scene.media.animations`,
 * `scene.audio.tracks`).
 */
import {
  GENERAL_SCENE_ID,
  GENERAL_SCENE_ROLE,
  expectedPrimarySceneCount,
  hasGeneralMediaSection,
} from "./spec-normalization.js";

/** The specification a first pass fills in, Loom's `activity_spec_template.json`. */
export const SPEC_TEMPLATE_FILE = "activity-spec-template.json";
export const SPEC_TEMPLATE = {
  id: "",
  title: "",
  runtime: {
    engine: "html",
    layout: "mainOnly",
    theme: "park",
    resolution: "640x480",
    usesAssessment: false,
  },
  activityDescription: "",
  scenes: [
    {
      id: "",
      description: "",
      media: { images: [], video: [], animations: [] },
      audio: { tracks: [] },
    },
  ],
  acceptance_criterias: [],
};

/** The specification a pass starts from, when there is one. */
export const CURRENT_SPEC_FILE = "current-activity-spec.json";

const WORKSPACE_RULES =
  "Work in this workspace. Write activity-spec.json as one JSON object, without Markdown fences. " +
  "Do not edit the input files or any activity collection. Do not delegate this task. " +
  "Use Harness's normal approval flow for tool actions. Finish only after writing valid JSON.";

const CONTRACT = `The specification contract:
- id: safe letters/numbers/dots/underscores/hyphens, starting and ending with a letter or number.
- title: non-empty string; activityDescription: string.
- moduleFolder, if present: waf-module- followed by a safe id.
- runtime: { "engine": "html", "layout": "mainOnly", "theme": "park", "resolution": "640x480", "usesAssessment": false }. Choose layout, theme and resolution appropriate to the description.
- scenes: a non-empty array of scene objects, each exactly { "id", "description", "media": { "images": [], "video": [], "animations": [] }, "audio": { "tracks": [] } }.
- scene.media.images, scene.media.video and scene.media.animations hold { key, description, targetPath? } objects with string values.
- scene.audio.tracks holds { key, description, script?, voice?, targetPath?, interruptible? } objects; interruptible is boolean.
- Media belongs only in those four lists. Never put images, video, videos, animations or tracks directly on a scene.
- Optional acceptance_criterias: string array; audience: null or { gradeBand: string or null }.`;

const BOOK_CLAUSE =
  "If input.json declares activityType book, scene order is page order. Give every page an explicit role: cover, title, or story. Cover is optional and first; title is optional and follows cover or is first; all remaining pages are story pages. Use unique scene IDs, exactly one image per page in scene.media.images with a meaningful description, and no scene videos or animations. Each audio track must have a globally unique non-empty key. The first audio cue on a story page is its visible narration text and must contain words; later cues are hidden follow-up prompts. Cover/title lettering is baked into the image; story images contain no story text. Preserve authored narration order and wording.";

function generalSceneClause(description: string): string {
  if (!hasGeneralMediaSection(description))
    return `The description declares no asset tags before the first Scene section, so do not create a "${GENERAL_SCENE_ID}" scene. `;
  return (
    "The description declares asset tags before the first Scene section. " +
    `Create one extra scene as the FIRST entry with id "${GENERAL_SCENE_ID}" and role "${GENERAL_SCENE_ROLE}". ` +
    "Its description is that pre-scene text copied verbatim, and it owns every asset tagged there. " +
    `Name its assets "${GENERAL_SCENE_ID}-<role>-<subject>", for example ${GENERAL_SCENE_ID}-image-forest-background. ` +
    'Never name any of its assets "activity-cover"; that key is reserved for the generated activity cover image ' +
    "and must not be used for shared media such as a submit button image. " +
    "This scene defines shared media reused by later scenes; it has no interaction of its own. " +
    "Do not duplicate those shared assets into the numbered scenes. " +
    `If a "${GENERAL_SCENE_ID}" scene already exists, keep its id, role, position, and asset keys unchanged. `
  );
}

const ITEM_MARKER_CLAUSE =
  "Plain-text <items><item>...</item></items> blocks mark assessment item candidates " +
  "for assessed activities. Do not treat <items> or <item> as media, audio, animation, " +
  "or video asset tags. Keep item marker text available in descriptions when relevant, " +
  "but do not create media/audio entries from those tags. " +
  'If the description explicitly sets usesAssessment true, for example "usesAssessment": true, ' +
  "set runtime.usesAssessment to true in the activity spec. ";

const TAG_CLAUSE =
  "Media and audio planning is tag-driven only. " +
  "The only valid asset markers in the description are <audio>...</audio>, <image>...</image>, <animation>...</animation>, and <video>...</video>. " +
  'Audio tags may include a kind attribute (kind="music" for background music, kind="sfx" for a sound effect, or kind="speech" for narration); every kind is a valid audio tag. ' +
  'A speech tag may select an adapter-native voice with <audio voice="adapter-voice-id">spoken words</audio>; copy that value verbatim to the corresponding scene.audio.tracks entry\'s voice field. ' +
  "A literal `(interruptible)` immediately after an audio tag is behavioral metadata: preserve it verbatim in the scene description, set interruptible=true on the corresponding scene.audio.tracks entry, and do not include it in the audio track script or spoken words. " +
  "Only those exact valid tag pairs count for asset planning. " +
  "Do not infer media and audio assets from plain prose descriptions. " +
  "If prose mentions a sound, image, animation, or video without one of those valid tags, do not create an asset for it. " +
  "Malformed tags are invalid and must be ignored for asset creation, including mistyped closing tags such as </videos>. ";

function sceneCountClause(description: string): string {
  const expected = expectedPrimarySceneCount(description);
  if (expected === null) return "";
  return (
    `The activity description requires exactly ${expected} scenes in total, ` +
    "counting each primary Scene N section" +
    (hasGeneralMediaSection(description) ? ` plus the leading "${GENERAL_SCENE_ID}" scene` : "") +
    `. Create exactly ${expected} scenes; subsections such as Scene 8a are part of their primary scene. `
  );
}

/**
 * The first pass. With no specification yet it fills in the template; with one, it updates
 * it to the changed description, keeping scene ids and asset keys.
 */
export function activitySpecPrompt(description: string, hasCurrentSpec: boolean): string {
  const shared =
    sceneCountClause(description) +
    generalSceneClause(description) +
    TAG_CLAUSE +
    ITEM_MARKER_CLAUSE +
    "Keep scene descriptions verbatim, including any valid asset tags, so later media enrichment can rely on them. " +
    "If the description contains an Acceptance Criteria section, populate acceptance_criterias " +
    "with one entry per listed criterion line. ";
  const task = hasCurrentSpec
    ? "Update the WAF HTML activity specification in " +
      `${CURRENT_SPEC_FILE} to the changed activity description in description.md (input.json holds the rest of the activity). ` +
      "Write the full updated specification, not a summary of changes. " +
      shared +
      "Preserve all existing scene IDs exactly as they are — do NOT rename any scene id. " +
      "Preserve all existing media asset keys and audio track keys exactly — do NOT rename any key. " +
      "Do NOT rename keys like correct-feedback, incorrect-feedback, intro, prompt, or background " +
      "that already exist in the spec; keep them verbatim. " +
      "If new scenes are needed based on the updated description, add them with new unique IDs. " +
      "If scenes from the existing spec are no longer described, remove them. " +
      "If valid tagged assets disappear from the updated description, the updated spec should no longer imply those removed assets. " +
      "Update scene descriptions to match the new activity description. " +
      "For descriptions, copy the given descriptions verbatim without making any changes to them."
    : "Generate a WAF HTML activity specification from description.md and input.json by populating " +
      `the template in ${SPEC_TEMPLATE_FILE}. You only need to determine how many scenes there are and populate them. ` +
      shared +
      "Make sure the generated activity spec does not contain duplicate keys for scene media assets or audio tracks. " +
      "Treat those keys as globally unique across the entire activity spec, not just unique within a single scene. " +
      "Give every new asset a readable, lowercase kebab-case key in the form <scene-id>-<role>-<subject>, " +
      "for example scene-2-image-rabbit, scene-2-video-rabbit-arrives, or scene-2-audio-narration. " +
      "The key is shown to authors in the scene tree, so describe the asset's role and subject rather than using ordinal names such as image-1 or audio-1. " +
      "Do not reuse generic keys like correct-feedback, incorrect-feedback, intro, prompt, or background across scenes; " +
      "instead generate scene-specific keys such as scene-1-correct-feedback. " +
      "For descriptions, copy the given descriptions verbatim without making any changes to them.";
  return `${task}\n${CONTRACT}\n${BOOK_CLAUSE}\n${WORKSPACE_RULES}`;
}

/** The media pass: list the media each scene's tags ask for, changing nothing else. */
export function mediaSpecPrompt(
  expectedSceneIds: string[],
  hasExistingMedia: boolean,
  book = false,
): string {
  if (book)
    return (
      `Copy the existing book specification from ${CURRENT_SPEC_FILE} to activity-spec.json. ` +
      `Expected scene IDs in page order: ${JSON.stringify(expectedSceneIds)}. ` +
      "Preserve every page's id, role, description, media and audio exactly, including asset keys, narration wording and audio track order. " +
      "Books use untagged prose: each page already requires exactly one image, even without an image tag. Do not remove media or narration because tags are absent. " +
      BOOK_CLAUSE +
      "\n" +
      WORKSPACE_RULES
    );
  const keyPreservation = hasExistingMedia
    ? "Preserve all existing media asset keys and audio track keys exactly as they are — " +
      "do NOT rename any key. " +
      "If an asset is no longer relevant to the updated description, remove it from the list. " +
      "You may add new entries but must not change the key of any existing entry. "
    : "";
  return (
    `You are updating the existing activity specification in ${CURRENT_SPEC_FILE}. ` +
    "Write the full updated specification to activity-spec.json. " +
    "Preserve all existing top-level fields, scene ids, scene descriptions, and any existing media/audio entries. " +
    "Do not add, remove, rename, or reorder scenes. " +
    `Expected scene IDs in order: ${JSON.stringify(expectedSceneIds)}. ` +
    "Return every expected scene in this exact order. " +
    `A scene with id "${GENERAL_SCENE_ID}" and role "${GENERAL_SCENE_ROLE}" holds shared media declared before the first Scene section; ` +
    "keep its id, role, and role field intact and enrich its media from its own description tags like any other scene. " +
    keyPreservation +
    "For each scene, use only the scene description's explicit valid asset tags to enrich media planning. " +
    "The only valid asset tags are <audio>...</audio>, <image>...</image>, <animation>...</animation>, and <video>...</video>. " +
    'Audio tags may include a kind attribute: <audio kind="music" loop="true" volume="0.4">...</audio> is looping background music, ' +
    '<audio kind="sfx">...</audio> is a one-shot sound effect, and plain <audio>...</audio> or <audio kind="speech">...</audio> is spoken narration. ' +
    'Spoken narration may select an adapter-native voice with <audio voice="adapter-voice-id">spoken words</audio>; copy that value verbatim to the corresponding scene.audio.tracks entry\'s voice field. ' +
    "A literal `(interruptible)` immediately after an audio tag is behavioral metadata: preserve it in the scene description, set interruptible=true on the corresponding scene.audio.tracks entry, and exclude it from the audio track script and spoken prompt. " +
    "Every one of these variants is a valid audio tag and must become its own scene.audio.tracks entry. " +
    "Only those exact valid tag pairs count. " +
    "Do not infer or add media from untagged prose mentions. " +
    "Malformed tags are invalid and must be ignored for asset creation, including mistyped closing tags such as </videos>. " +
    'Populate scene.audio.tracks from every <audio>...</audio> tag, including kind="music" and kind="sfx" tags. ' +
    "Populate scene.media.images only from <image>...</image> tags. " +
    "Populate scene.media.animations only from <animation>...</animation> tags. " +
    "Populate scene.media.video only from <video>...</video> tags. " +
    "Ensure scene.audio.tracks is a list of objects with key, description, script, optional voice, and interruptible boolean metadata when applicable. " +
    "Ensure scene.media.images is a list of objects with key and description. " +
    "Ensure scene.media.video and scene.media.animations are lists of objects with key and description. " +
    "Never put images, video, videos, animations or tracks directly on a scene; they belong inside scene.media and scene.audio. " +
    "If a scene has no valid tags of a given type, keep that list empty. " +
    "Use empty lists where nothing is needed. " +
    "Make sure the generated activity spec does not contain duplicate keys for scene media assets or audio tracks. " +
    "Treat those keys as globally unique across the entire activity spec, not just unique within a single scene. " +
    "Give every new asset a readable, lowercase kebab-case key in the form <scene-id>-<role>-<subject>, " +
    "for example scene-2-image-rabbit, scene-2-video-rabbit-arrives, or scene-2-audio-narration. " +
    "The key is shown to authors in the scene tree, so never use ordinal-only names such as image-1 or audio-1. " +
    "For a plain narration audio tag, set that track's script to the spoken words inside the tag. " +
    'For a kind="music" or kind="sfx" audio tag, set that track\'s script to the ENTIRE audio tag copied verbatim, ' +
    "including the kind, loop, and volume attributes and the inner prompt text, and never leave it empty. " +
    "Only use an empty string for a narration script when the spoken words are genuinely not provided.\n" +
    WORKSPACE_RULES
  );
}

/**
 * Loom's repair prompts: the previous attempt's failure, then the original request. The
 * media pass's reminds it of the scene list it has to keep.
 */
export function repairPrompt(original: string, reason: string, expectedSceneIds?: string[]) {
  const head = expectedSceneIds
    ? "Your previous attempt did not preserve the media spec scene list. " +
      `${reason}\n\nRetry now. ` +
      `Expected scene IDs in order: ${JSON.stringify(expectedSceneIds)}. ` +
      "Return every expected scene in this exact order. " +
      "Do not add, remove, rename, or reorder scenes. "
    : "Your previous attempt did not satisfy the activity spec JSON contract. " +
      `${reason}\n\nRetry now. ` +
      "The JSON object must include a non-empty top-level scenes list. ";
  return (
    head +
    "Write the full activity spec JSON object to activity-spec.json, not a summary of changes.\n\n" +
    `Original request:\n${original}`
  );
}
