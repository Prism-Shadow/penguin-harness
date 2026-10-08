import { describe, expect, it } from "vitest";
import {
  expectedPrimarySceneCount,
  extractAcceptanceCriteria,
  mediaContractIssues,
  normalizeActivitySpec,
  normalizeActivitySpecUpdate,
  normalizeMediaSpec,
  normalizeScenes,
  parseAudioCue,
  readableAssetKey,
  reconcileAssetKeys,
} from "../src/activities/spec-normalization.js";
import { specOfPass } from "../src/activities/generation.js";
import {
  activitySpecPrompt,
  mediaSpecPrompt,
  repairPrompt,
} from "../src/activities/spec-prompts.js";
import { planMedia } from "../src/activities/media.js";
import type { ActivityDetail } from "../src/activities/domain.js";

const runtime = {
  engine: "html",
  layout: "mainOnly",
  theme: "park",
  resolution: "640x480",
  usesAssessment: false,
};
const empty = { images: [], video: [], animations: [] };

/** test10's first scene: a tagged video in the description. */
const introDescription =
  "Intro. <video>A colorful island; the treasure chest slowly opens and glows.</video> " +
  "Then the activity moves on.";

describe("normalizing scenes the way Loom does", () => {
  it("drops media an agent put straight on a scene, so it never hides from the media plan", () => {
    // What the spec pass wrote for test10: `videos` and `tracks` on the scene itself.
    const [scene] = normalizeScenes([
      {
        id: "scene-1-intro",
        description: introDescription,
        videos: [{ key: "intro-island", description: "Island" }],
        tracks: [{ key: "intro-line", description: "Line", script: "Hi" }],
      },
    ]);
    expect(scene).toEqual({
      id: "scene-1-intro",
      description: introDescription,
      media: empty,
      audio: { tracks: [] },
    });
  });

  it("fills ids, descriptions and keys, keeps roles, and puts the general scene first", () => {
    const scenes = normalizeScenes([
      {
        id: "scene-2-play",
        description: "Play",
        role: "story",
        media: { images: ["A red ball on grass", { key: "", description: "" }] },
        audio: {
          tracks: [
            { key: "s2", description: "Prompt", script: "empty", interruptible: 1, voice: "Auto" },
          ],
        },
      },
      { description: "Shared" },
      { id: "general", description: "Shared media" },
    ]);
    expect(scenes.map((scene) => [scene.id, scene.role])).toEqual([
      ["general", "general"],
      ["scene-2-play", "story"],
      ["scene-2", undefined],
    ]);
    expect(scenes[1]!.media.images).toEqual([
      { key: "scene-2-image-red-ball-grass", description: "A red ball on grass" },
      { key: "scene-2-image-image-scene-scene-2", description: "Image for scene scene-2-play." },
    ]);
    // Loom's "empty" placeholder is not a script Penguin should speak.
    expect(scenes[1]!.audio.tracks).toEqual([
      { key: "s2", description: "Prompt", interruptible: true, voice: "auto" },
    ]);
  });

  it("keys assets <scene>-<kind>-<subject> from four content words", () => {
    expect(
      readableAssetKey("scene-12-rocks", "audio", "The narrator names the other letters"),
    ).toBe("scene-12-audio-narrator-names-other-letters");
    expect(readableAssetKey("Intro Page", "image", "")).toBe("intro-page-image-asset");
  });

  it("parses audio tags as Loom does, refusing the ones it would refuse", () => {
    expect(parseAudioCue("Say hello")).toEqual({
      kind: "speech",
      prompt: "Say hello",
      voice: null,
    });
    expect(
      parseAudioCue('<audio kind="music" loop="true" volume="0.4">calm &amp; slow</audio>'),
    ).toEqual({ kind: "music", prompt: "calm & slow", voice: null });
    expect(parseAudioCue('<audio voice="Puck">Hi</audio>')).toMatchObject({ voice: "Puck" });
    expect(parseAudioCue('<audio kind="sfx" voice="Puck">pop</audio>')).toBeNull();
    expect(parseAudioCue('<audio kind="sfx" volume="2">pop</audio>')).toBeNull();
    expect(parseAudioCue('<audio kind="choir">la</audio>')).toBeNull();
  });

  it("counts the scenes a script asks for, with the general scene", () => {
    expect(expectedPrimarySceneCount("Scene 1: a\nScene 2: b\nScene 2a: c")).toBe(2);
    expect(expectedPrimarySceneCount("<image>bg</image>\nScene 1: a")).toBe(2);
    expect(expectedPrimarySceneCount("No headings")).toBeNull();
  });

  it("reads acceptance criteria under their heading, stopping at the next one", () => {
    expect(
      extractAcceptanceCriteria(
        "Intro\n## Acceptance Criteria\n- [x] It starts.\n2. It ends.\n\n## Notes\n- not this",
      ),
    ).toEqual(["It starts.", "It ends."]);
  });
});

describe("the first specification pass", () => {
  it("normalizes a first specification and renames keys into each scene's prefix", () => {
    const spec = normalizeActivitySpec(
      {
        id: "words",
        title: "Words",
        runtime,
        audience: null,
        stages: [
          {
            id: "scene-1",
            description: '<audio voice="Puck">Hello</audio>',
            audio: { tracks: [{ key: "intro", description: "Greeting", script: "Hello" }] },
          },
        ],
      },
      'Scene 1: hello\n"usesAssessment": true\nAcceptance Criteria:\n- Says hello',
    );
    expect(spec).toEqual({
      id: "words",
      title: "Words",
      audience: null,
      runtime: { ...runtime, usesAssessment: true },
      activityDescription:
        'Scene 1: hello\n"usesAssessment": true\nAcceptance Criteria:\n- Says hello',
      acceptance_criterias: ["Says hello"],
      scenes: [
        {
          id: "scene-1",
          description: '<audio voice="Puck">Hello</audio>',
          media: empty,
          audio: {
            tracks: [
              {
                key: "scene-1-audio-greeting",
                description: "Greeting",
                script: "Hello",
                voice: "Puck",
              },
            ],
          },
        },
      ],
    });
  });

  it("keeps the asset keys a regenerated scene already had", () => {
    const existing = {
      runtime,
      scenes: [
        {
          id: "scene-1",
          description: "a",
          media: {
            images: [{ key: "scene-1-image-cat", description: "Cat", targetPath: "cat.png" }],
          },
        },
      ],
    };
    const updated = normalizeActivitySpecUpdate(
      existing,
      {
        scenes: [
          {
            id: "scene-1",
            description: "a",
            media: { images: [{ key: "renamed", description: "Cat" }] },
          },
          { id: "scene-2", description: "b" },
        ],
      },
      "",
    );
    expect((updated.scenes as { media: { images: unknown[] } }[])[0]!.media.images).toEqual([
      { key: "scene-1-image-cat", description: "Cat", targetPath: "cat.png" },
    ]);
    expect(updated.runtime).toEqual(runtime);
  });

  it("matches renamed assets by path, script or description before falling back to position", () => {
    const old = [
      { key: "a", description: "Apple", script: "one" },
      { key: "b", description: "Ball", script: "two" },
    ];
    expect(
      reconcileAssetKeys(old, [
        { key: "x", description: "Ball", script: "two" },
        { key: "y", description: "New" },
        { key: "z", description: "Newer" },
      ]).map((asset) => asset.key),
    ).toEqual(["b", "y", "z"]);
    expect(
      reconcileAssetKeys(old, [{ key: "x", description: "Changed" }]).map((asset) => asset.key),
    ).toEqual(["a"]);
  });
});

describe("the media pass", () => {
  it("plans authored voices with their provider and retains reviewed overrides on re-plan", () => {
    for (const [voice, provider] of [
      ["abcdefghijklmno", "elevenlabs"],
      ["Puck", "gemini"],
      ["af_heart", "kokoro"],
    ]) {
      const spec = normalizeActivitySpec(
        {
          runtime,
          scenes: [
            {
              id: "scene-1",
              description: `<audio voice="${voice}">Hello</audio>`,
              audio: { tracks: [{ key: "hello", description: "Hello", script: "Hello" }] },
            },
          ],
        },
        "",
      );
      const activity = {
        productCode: "test",
        refNum: 1,
        draft: { spec, status: "valid" },
      } as unknown as ActivityDetail;
      const plan = planMedia(activity);
      expect(plan.manifest.assets["en-US"]![0]).toMatchObject({ voice, speechProvider: provider });
      plan.manifest.assets["en-US"]![0]!.voice = "Charon";
      plan.manifest.assets["en-US"]![0]!.speechProvider = "gemini";
      activity.draft.mediaPlan = plan;
      expect(planMedia(activity).manifest.assets["en-US"]![0]).toMatchObject({
        voice: "Charon",
        speechProvider: "gemini",
      });
      const scene = (spec.scenes as { audio: { tracks: { voice: string }[] } }[])[0]!;
      scene.audio.tracks[0]!.voice = "Aoede";
      expect(planMedia(activity).manifest.assets["en-US"]![0]).toMatchObject({
        voice: "Aoede",
        speechProvider: "gemini",
      });
    }
  });

  it("keeps a book's page media, roles and narration when a tag-only pass empties them", () => {
    const book = {
      runtime,
      scenes: [
        {
          id: "cover",
          role: "cover",
          description: "A cat on the cover",
          media: { images: [{ key: "cover-image", description: "Cat" }] },
          audio: { tracks: [] },
        },
        {
          id: "story",
          role: "story",
          description: "The cat sat.",
          media: { images: [{ key: "story-image", description: "Cat sitting" }] },
          audio: {
            tracks: [
              { key: "story-line", description: "Narration", script: "The cat sat." },
              { key: "story-followup", description: "Prompt", script: "Where is the cat?" },
            ],
          },
        },
      ],
    };
    const enriched = specOfPass(
      "media-spec",
      {
        scenes: book.scenes.map((scene) => ({
          id: scene.id,
          description: scene.description,
          media: empty,
          audio: { tracks: [] },
        })),
      },
      {
        activityType: "book",
        draft: { spec: book, description: "" } as unknown as ActivityDetail["draft"],
      },
    );
    expect(enriched.scenes).toMatchObject(book.scenes);
    expect(mediaSpecPrompt(["cover", "story"], true, true)).toContain(
      "Do not remove media or narration because tags are absent",
    );
    expect(mediaSpecPrompt(["cover", "story"], true, true)).not.toContain("keep that list empty");
  });

  const existing = {
    id: "test10",
    title: "test10",
    runtime,
    activityDescription: "d",
    scenes: [
      { id: "scene-1-intro", description: introDescription },
      {
        id: "scene-2-start",
        description:
          '<audio>We are going on a treasure hunt.</audio> <audio kind="music" loop="true">pirate shanty</audio>',
      },
    ],
  };

  it("lists the tagged media where planMedia reads it, so the storyboard has assets", () => {
    const enriched = normalizeMediaSpec(existing, {
      ...existing,
      scenes: [
        {
          id: "scene-1-intro",
          description: introDescription,
          media: { video: [{ key: "island", description: "Island chest opens" }] },
        },
        {
          id: "scene-2-start",
          description: existing.scenes[1]!.description,
          audio: {
            tracks: [
              { key: "hunt", description: "Narration", script: "We are going on a treasure hunt." },
            ],
          },
        },
      ],
    });
    expect(enriched.scenes).toEqual([
      {
        id: "scene-1-intro",
        description: introDescription,
        media: {
          ...empty,
          video: [{ key: "scene-1-video-island-chest-opens", description: "Island chest opens" }],
        },
        audio: { tracks: [] },
      },
      {
        id: "scene-2-start",
        description: existing.scenes[1]!.description,
        media: empty,
        audio: {
          tracks: [
            {
              key: "scene-2-audio-narration",
              description: "Narration",
              script: "We are going on a treasure hunt.",
            },
            // The music tag the pass left out, added back with its tag as the script.
            {
              key: "scene-2-audio-music-cue-pirate-shanty",
              description: "music cue: pirate shanty",
              script: '<audio kind="music" loop="true">pirate shanty</audio>',
            },
          ],
        },
      },
    ]);
    expect(mediaContractIssues(enriched)).toEqual([]);
    const plan = planMedia({
      productCode: "test10",
      refNum: 1,
      draft: { spec: enriched, status: "valid" },
    } as unknown as ActivityDetail);
    expect(
      plan.manifest.assets["en-US"]!.map((asset) => [
        asset.key,
        asset.type,
        asset.usages[0]!.sceneId,
      ]),
    ).toEqual([
      ["scene-1-video-island-chest-opens", "video", "scene-1-intro"],
      ["scene-2-audio-narration", "audio", "scene-2-start"],
      ["scene-2-audio-music-cue-pirate-shanty", "audio", "scene-2-start"],
    ]);
  });

  it("refuses a pass that changed the scene set", () => {
    expect(() =>
      normalizeMediaSpec(existing, { scenes: [{ id: "scene-1-intro", description: "x" }] }),
    ).toThrow(/Expected 2 scenes \["scene-1-intro","scene-2-start"\], but got 1 scenes/);
  });

  it("reports untagged-for media and keys listed twice", () => {
    expect(
      mediaContractIssues({
        scenes: [
          {
            id: "a",
            description: "<image>cat</image><image>dog</image>",
            media: { images: [{ key: "k", description: "cat" }] },
          },
          { id: "b", description: "", audio: { tracks: [{ key: "k", description: "again" }] } },
        ],
      }),
    ).toEqual([
      "a:1:1: description contains 2 <image> element(s), but the scene defines 1 image asset(s)",
      'b:1:1: asset key "k" is already defined in scene "a"',
    ]);
  });
});

describe("what a specification pass saves", () => {
  const draft = (spec: Record<string, unknown> | null, description = "Scene 1: a\nScene 2: b") => ({
    draft: { spec, description } as ActivityDetail["draft"],
  });

  it("asks the first pass for the scenes the script names", () => {
    expect(() =>
      specOfPass("spec", { scenes: [{ id: "only", description: "a" }] }, draft(null)),
    ).toThrow(
      "The specification has 1 scenes. It must include a non-empty top-level scenes list. The description defines 2 primary scenes, so it must contain exactly that many.",
    );
    expect(() => specOfPass("spec", [], draft(null))).toThrow(/one JSON object/);
  });

  it("refuses a media pass whose media does not cover its tags", () => {
    const spec = { scenes: [{ id: "scene-1-intro", description: introDescription }] };
    // The test10 mistake, made by the media pass itself: video beside the scene, not in it.
    expect(() =>
      specOfPass(
        "media-spec",
        { scenes: [{ ...spec.scenes[0], videos: [{ key: "v", description: "Island" }] }] },
        draft(spec),
      ),
    ).toThrow(
      "The listed media does not match the scene tags: scene-1-intro:1:1: description contains 1 <video> element(s), but the scene defines 0 video asset(s).",
    );
  });
});

describe("the prompts", () => {
  it("spell out where media goes, and fill the template or update the current spec", () => {
    const first = activitySpecPrompt("<image>bg</image>\nScene 1: a", false);
    expect(first).toContain("activity-spec-template.json");
    expect(first).toContain("exactly 2 scenes");
    expect(first).toContain('id "general" and role "general"');
    expect(first).toContain(
      "Never put images, video, videos, animations or tracks directly on a scene.",
    );
    const update = activitySpecPrompt("Scene 1: a", true);
    expect(update).toContain("current-activity-spec.json");
    expect(update).toContain("do NOT rename any scene id");
  });

  it("give the media pass the scene list, and a retry the reason", () => {
    const prompt = mediaSpecPrompt(["general", "scene-1"], true);
    expect(prompt).toContain('Expected scene IDs in order: ["general","scene-1"]');
    expect(prompt).toContain("Populate scene.media.video only from <video>...</video> tags.");
    expect(prompt).toContain("do NOT rename any key");
    expect(repairPrompt(prompt, "It broke.", ["scene-1"])).toMatch(
      /^Your previous attempt did not preserve the media spec scene list\. It broke\.\n\nRetry now\./,
    );
  });
});
