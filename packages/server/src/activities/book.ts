const BOOK_ROLES = new Set(["cover", "title", "story"]);
const ROLE_HEADING =
  /^(?:scene\s+\d+\s*:\s*)?(cover(?:\s+page)?|title(?:\s+page)?|story\s+page(?:\s+\d+)?)$/i;
const NUMBERED_ID = /^scene[-_]\d+[-_](?<label>.+)$/;
const VISIBLE_WORD = /[\p{L}\p{N}]+(?:[\x27\u2019][\p{L}\p{N}]+)*/u;

type JsonObject = Record<string, unknown>;

/** Loom's book page contract, applied after generic ActivitySpec validation. */
export function validateBookSpec(spec: JsonObject): void {
  const rawScenes = sceneRecords(spec);
  if (!rawScenes.length) throw new Error("A book activity must contain at least one scene.");

  const interpreted: Array<{ scene: JsonObject; id: string; role: string }> = [];
  for (const [index, scene] of rawScenes.entries()) {
    const explicitRole = stringValue(scene.role).trim().toLowerCase();
    if (explicitRole && !BOOK_ROLES.has(explicitRole))
      throw new Error(
        `Book scene "${stringValue(scene.id).trim()}" has unsupported role "${explicitRole}".`,
      );
    const inferred = inferRole(scene.id, scene.description);
    const image = firstImage(scene);
    const previousRole = interpreted[index - 1]?.role;
    const role = explicitRole || recoverSpecialRole(inferred, image, index, previousRole);
    interpreted.push({ scene, id: stringValue(scene.id).trim(), role });
  }

  const ids = interpreted.map((entry) => entry.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length)
    throw new Error(`Book scene IDs must be unique: ${duplicates.join(", ")}.`);

  let storyStarted = false;
  for (let index = 0; index < interpreted.length; index++) {
    const { id, role } = interpreted[index]!;
    if (role === "story") {
      storyStarted = true;
      continue;
    }
    if (storyStarted) throw new Error(`Book special page "${id}" cannot appear after story pages.`);
    if (role === "cover" && index !== 0)
      throw new Error('The optional book "cover" scene must be first.');
    const expectedTitleIndex = interpreted[0]?.role === "cover" ? 1 : 0;
    if (role === "title" && index !== expectedTitleIndex)
      throw new Error('The optional book "title" scene must follow the cover or be first.');
  }

  const audioKeys = new Set<string>();
  for (const { scene, id, role } of interpreted) {
    const media = object(scene.media);
    const images = array(media.images);
    const videos = array(media.video);
    const animations = array(media.animations);
    const audio = object(scene.audio);
    const tracks = array(audio.tracks);
    if (images.length !== 1)
      throw new Error(`Book page "${id}" must have exactly one primary image.`);
    if (videos.length || animations.length)
      throw new Error(
        `Book page "${id}" cannot contain scene video or animation assets; the optional intro video is ref-level.`,
      );
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
      const track = tracks[trackIndex];
      if (!isObject(track))
        throw new Error(`Book page "${id}" audio track ${trackIndex + 1} must be an object.`);
      const key = stringValue(track.key).trim();
      if (!key)
        throw new Error(
          `Book page "${id}" audio track ${trackIndex + 1} requires a non-empty key.`,
        );
      if (audioKeys.has(key)) throw new Error(`Book audio track keys must be unique: "${key}".`);
      audioKeys.add(key);
    }
    const image = images[0];
    if (!isObject(image) || !stringValue(image.description).trim())
      throw new Error(`Book page "${id}" requires a meaningful image description.`);
    if (
      role === "story" &&
      tracks.length &&
      !VISIBLE_WORD.test(stringValue((tracks[0] as JsonObject).script))
    )
      throw new Error(`Book story page "${id}" narration must contain visible words.`);
  }
}

function sceneRecords(spec: JsonObject): JsonObject[] {
  const scenes = spec.scenes || spec.stages;
  return Array.isArray(scenes) ? scenes.filter(isObject) : [];
}

function inferRole(id: unknown, description: unknown): string {
  const heading = stringValue(description).trim().split(/\r?\n/, 1)[0]?.trim() ?? "";
  const headingMatch = ROLE_HEADING.exec(heading);
  if (headingMatch) {
    const label = headingMatch[1]!.toLowerCase();
    if (label.startsWith("cover")) return "cover";
    if (label.startsWith("title")) return "title";
    return "story";
  }
  const normalized = stringValue(id)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  const match = NUMBERED_ID.exec(normalized);
  const label = match?.groups?.label ?? normalized;
  if (label === "cover" || label === "cover-page") return "cover";
  if (label === "title" || label === "title-page") return "title";
  return "story";
}

function recoverSpecialRole(
  inferred: string,
  image: JsonObject | undefined,
  index: number,
  previousRole: string | undefined,
): string {
  if (inferred !== "story" || !image) return inferred;
  const key = stringValue(image.key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  if (index === 0 && /(?:^|-)(?:image-cover|cover-image)(?:-|$)/.test(key)) return "cover";
  if (
    /(?:^|-)(?:image-title|title-image)(?:-|$)/.test(key) &&
    (index === 0 || (index === 1 && previousRole === "cover"))
  )
    return "title";
  return inferred;
}

function firstImage(scene: JsonObject): JsonObject | undefined {
  const media = object(scene.media);
  const images = array(media.images);
  return isObject(images[0]) ? images[0] : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function object(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
