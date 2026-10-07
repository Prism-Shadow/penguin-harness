/**
 * A new ref's draft from its template: the manifest takes the new number, each decision keeps,
 * clears or binds one asset, and anything the template does not hold is refused.
 */
import { describe, expect, it } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { MediaAsset } from "../src/activities/media.js";
import {
  nextFreeRefNum,
  parseRefDecisions,
  refDraftFromTemplate,
} from "../src/activities/ref-template.js";
import { activitySpec } from "./activity-fixtures.js";

const RUN = `run_${"a".repeat(32)}`;
const SHA = "b".repeat(64);
/** The template's media folder, and the new ref's. */
const FROM = "media/loom/words/words-12";
const TO = "media/loom/words/words-13";
/** An asset as the new ref holds it: bound into its own media folder. */
const moved = (asset: MediaAsset): MediaAsset => ({
  ...asset,
  path: asset.path!.replace(FROM, TO),
});
const usage = (sceneId: string, key: string) => ({
  sceneId,
  sourceKey: key,
  occurrence: 1,
  sceneOccurrenceCount: 1,
});

function template(assets: MediaAsset[], extra: Record<string, MediaAsset[]> = {}): ActivityDetail {
  return {
    id: "act_template",
    collectionId: "col",
    productId: "prd",
    productCode: "words",
    refNum: 12,
    title: "Sight words",
    displayName: null,
    stable: true,
    activityType: "standard",
    createdAt: "now",
    updatedAt: "now",
    archived: false,
    tags: [],
    draft: {
      draftId: "draft",
      activityId: "act_template",
      baseVersionId: null,
      contentRevision: "rev",
      status: "valid",
      description: "Practice sight words",
      spec: structuredClone(activitySpec) as Record<string, unknown>,
      mediaPlan: {
        specRevision: "c".repeat(64),
        requirements: { cat: "d".repeat(64) },
        manifest: {
          productCode: "words",
          refNum: 12,
          assets: { "en-US": assets, ...extra },
        },
      },
      updatedAt: "now",
    },
  };
}

const cat: MediaAsset = {
  key: "cat",
  type: "image",
  description: "A cat",
  path: `${FROM}/images/english/cat.png`,
  generatedImage: { runId: RUN, sha256: SHA },
  usages: [usage("intro", "cat")],
};
const hello: MediaAsset = {
  key: "hello",
  type: "audio",
  description: "Greeting",
  script: "Hello there",
  voice: "Kore",
  path: `${FROM}/audios/english/hello.mp3`,
  generatedAudio: { runId: RUN, sha256: SHA, format: "mp3" },
  wordTimings: [{ word: "Hello", startMs: 0, endMs: 200 }],
  durationMs: 400,
  usages: [usage("intro", "hello")],
};

describe("refDraftFromTemplate", () => {
  it("copies the draft and addresses the manifest to the new number", () => {
    const source = template([cat, hello]);
    const draft = refDraftFromTemplate(source, 13, []);
    expect(draft.description).toBe("Practice sight words");
    expect(draft.spec).toEqual(source.draft.spec);
    expect(draft.status).toBe("valid");
    expect(draft.mediaPlan!.manifest.refNum).toBe(13);
    expect(draft.mediaPlan!.manifest.productCode).toBe("words");
    expect(draft.mediaPlan!.specRevision).toBe(source.draft.mediaPlan!.specRevision);
    expect(draft.mediaPlan!.requirements).toEqual(source.draft.mediaPlan!.requirements);
    // Generated media are bound into the new ref's media folder, where its copy of them is.
    expect(draft.mediaPlan!.manifest.assets["en-US"]).toEqual([moved(cat), moved(hello)]);
    // The template itself is untouched.
    expect(source.draft.mediaPlan!.manifest.refNum).toBe(12);
  });

  it("keeps an asset a decision says to keep", () => {
    const draft = refDraftFromTemplate(template([cat]), 13, [
      { language: "en-US", assetKey: "cat", action: "keep", description: "ignored" },
    ]);
    expect(draft.mediaPlan!.manifest.assets["en-US"]![0]).toEqual(moved(cat));
  });

  it("clears a narration with an edited script and voice, dropping its recording", () => {
    const draft = refDraftFromTemplate(template([cat, hello]), 13, [
      { language: "en-US", assetKey: "hello", action: "clear", script: "Hi!", voice: "Puck" },
    ]);
    const asset = draft.mediaPlan!.manifest.assets["en-US"]![1]!;
    expect(asset).toEqual({
      key: "hello",
      type: "audio",
      description: "Greeting",
      script: "Hi!",
      voice: "Puck",
      usages: [usage("intro", "hello")],
    });
  });

  it("clears an image with an edited description", () => {
    const draft = refDraftFromTemplate(template([cat]), 13, [
      { language: "en-US", assetKey: "cat", action: "clear", description: "A dog" },
    ]);
    expect(draft.mediaPlan!.manifest.assets["en-US"]![0]).toEqual({
      key: "cat",
      type: "image",
      description: "A dog",
      usages: [usage("intro", "cat")],
    });
  });

  it("clears without new text, leaving the template's text", () => {
    const draft = refDraftFromTemplate(template([hello]), 13, [
      { language: "en-US", assetKey: "hello", action: "clear" },
    ]);
    const asset = draft.mediaPlan!.manifest.assets["en-US"]![0]!;
    expect(asset.path).toBeUndefined();
    expect(asset.script).toBe("Hello there");
  });

  it("drops a translation's source once its line is rewritten by hand", () => {
    const spanish: MediaAsset = {
      ...hello,
      script: "Hola",
      translatedFrom: "Hello there",
    };
    const kept = refDraftFromTemplate(template([hello], { "es-MX": [spanish] }), 13, [
      { language: "es-MX", assetKey: "hello", action: "clear", script: "Hola" },
    ]);
    expect(kept.mediaPlan!.manifest.assets["es-MX"]![0]!.translatedFrom).toBe("Hello there");
    const rewritten = refDraftFromTemplate(template([hello], { "es-MX": [spanish] }), 13, [
      { language: "es-MX", assetKey: "hello", action: "clear", script: "¡Hola!" },
    ]);
    expect(rewritten.mediaPlan!.manifest.assets["es-MX"]![0]!.translatedFrom).toBeUndefined();
  });

  it("binds an asset to an upload and forgets its generated file", () => {
    const draft = refDraftFromTemplate(template([cat]), 13, [
      { language: "en-US", assetKey: "cat", action: "bind", path: `${FROM}/uploads/dog-1.png` },
    ]);
    expect(draft.mediaPlan!.manifest.assets["en-US"]![0]).toEqual({
      key: "cat",
      type: "image",
      description: "A cat",
      path: expect.stringMatching(/^media\/loom\/words\/words-1[23]\/uploads\/dog-1\.png$/),
      usages: [usage("intro", "cat")],
    });
  });

  it.each([
    [{ language: "en-US", assetKey: "dog", action: "keep" as const }, /no asset dog/],
    [{ language: "fr-FR", assetKey: "cat", action: "clear" as const }, /no asset cat in fr-FR/],
    [
      { language: "en-US", assetKey: "cat", action: "bind" as const, path: "media/loom/x.png" },
      /uploaded file/,
    ],
    [
      { language: "en-US", assetKey: "cat", action: "clear" as const, script: "Hi" },
      /Only a narration takes a script/,
    ],
    [
      { language: "en-US", assetKey: "hello", action: "clear" as const, description: "x" },
      /Only an image/,
    ],
    [
      { language: "en-US", assetKey: "hello", action: "clear" as const, script: "   " },
      /1 to 5000/,
    ],
    [
      { language: "en-US", assetKey: "hello", action: "clear" as const, script: "x".repeat(5001) },
      /1 to 5000/,
    ],
    [
      { language: "en-US", assetKey: "cat", action: "clear" as const, voice: "Kore" },
      /Only a narration takes a voice/,
    ],
    [
      { language: "en-US", assetKey: "hello", action: "clear" as const, voice: "Bad/voice" },
      /voice/,
    ],
  ])("refuses %j", (decision, message) => {
    let caught: unknown;
    try {
      refDraftFromTemplate(template([cat, hello]), 13, [decision]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 422, code: "ref_plan_invalid" });
    expect((caught as Error).message).toMatch(message);
  });

  it("refuses the same asset decided twice", () => {
    expect(() =>
      refDraftFromTemplate(template([cat]), 13, [
        { language: "en-US", assetKey: "cat", action: "keep" },
        { language: "en-US", assetKey: "cat", action: "clear" },
      ]),
    ).toThrow(/decided twice/);
  });

  it("copies a template without a plan, and refuses decisions about it", () => {
    const source = template([cat]);
    delete source.draft.mediaPlan;
    expect(refDraftFromTemplate(source, 13, []).mediaPlan).toBeUndefined();
    expect(() =>
      refDraftFromTemplate(source, 13, [{ language: "en-US", assetKey: "cat", action: "clear" }]),
    ).toThrow(/no media plan/);
  });
});

describe("parseRefDecisions", () => {
  it("reads decisions and leaves out absent fields", () => {
    expect(
      parseRefDecisions([
        { language: "en-US", assetKey: "cat", action: "clear", description: "A dog" },
      ]),
    ).toEqual([{ language: "en-US", assetKey: "cat", action: "clear", description: "A dog" }]);
    expect(parseRefDecisions(undefined)).toEqual([]);
  });

  it.each([
    ["not an array", {}],
    ["too many", Array.from({ length: 2001 }, () => ({}))],
    ["unknown action", [{ language: "en-US", assetKey: "cat", action: "delete" }]],
    ["unknown field", [{ language: "en-US", assetKey: "cat", action: "keep", extra: 1 }]],
    ["no key", [{ language: "en-US", action: "keep" }]],
    ["non-string script", [{ language: "en-US", assetKey: "cat", action: "clear", script: 1 }]],
  ])("refuses %s as a bad request", (_name, value) => {
    expect(() => parseRefDecisions(value)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("nextFreeRefNum", () => {
  it("is one past the highest number, or 0 for none", () => {
    expect(nextFreeRefNum([])).toBe(0);
    expect(nextFreeRefNum([12, 3, 40])).toBe(41);
  });
});
