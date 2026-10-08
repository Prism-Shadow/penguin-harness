import { describe, expect, it } from "vitest";
import {
  activityPayload,
  hasLanguageGroups,
  isLanguageCode,
  moduleSummaries,
  PREVIEW_ACTIVITY_VERSION,
  scopeConfigurationToLanguage,
  unwrapModuleConfiguration,
  withPreviewStartScene,
  type PayloadInput,
} from "../src/activities/sandbox-configuration.js";

describe("unwrapping a module's configuration", () => {
  it("takes the contents when the file wraps them in the module id", () => {
    expect(unwrapModuleConfiguration({ sightWords: { scenes: [] } }, "sightWords")).toEqual({
      scenes: [],
    });
  });

  it("takes the contents wrapped in the product code, as Penguin's assembly writes them", () => {
    const wrapped = { test10: { stateMachine: { id: "m" }, rounds: {} } };
    expect(unwrapModuleConfiguration(wrapped, "act_1", ["test10"])).toEqual(wrapped.test10);
    // Without the product code named, the same file is contents.
    expect(unwrapModuleConfiguration(wrapped, "act_1")).toEqual(wrapped);
  });

  it("leaves a configuration that merely has one key of its own", () => {
    // A single key named after something else is contents, not a wrapper.
    expect(unwrapModuleConfiguration({ scenes: [] }, "sightWords")).toEqual({ scenes: [] });
  });

  it("leaves a configuration with several keys", () => {
    const configuration = { sightWords: { a: 1 }, other: 2 };
    expect(unwrapModuleConfiguration(configuration, "sightWords")).toEqual(configuration);
  });

  it("treats anything that is not an object as empty", () => {
    expect(unwrapModuleConfiguration(null, "x")).toEqual({});
    expect(unwrapModuleConfiguration([1, 2], "x")).toEqual({});
  });
});

describe("language codes", () => {
  it("recognises the form the manifest and configuration both use", () => {
    expect(isLanguageCode("en-US")).toBe(true);
    expect(isLanguageCode("ro-RO")).toBe(true);
    expect(isLanguageCode("en")).toBe(false);
    expect(isLanguageCode("scenes")).toBe(false);
    expect(isLanguageCode("EN-us")).toBe(false);
  });

  it("knows whether a configuration is grouped by language at all", () => {
    expect(hasLanguageGroups({ scenes: [] })).toBe(false);
    expect(hasLanguageGroups({ "en-US": {} })).toBe(true);
  });
});

describe("scoping a configuration to one language", () => {
  const configuration = {
    resolution: "640x480",
    "en-US": { intro: "Hello", outro: "Goodbye" },
    "es-MX": { intro: "Hola" },
  };

  it("leaves an untranslated configuration alone", () => {
    const flat = { scenes: [{ id: "intro" }] };
    expect(scopeConfigurationToLanguage(flat, "es-MX")).toBe(flat);
  });

  it("layers the requested language over the default", () => {
    // A translated activity carries only what differs; the requested group alone would be
    // a half-translated activity missing scenes.
    const scoped = scopeConfigurationToLanguage(configuration, "es-MX");
    expect(scoped["es-MX"]).toEqual({ intro: "Hola", outro: "Goodbye" });
  });

  it("still sends the default group, which the module expects to find", () => {
    const scoped = scopeConfigurationToLanguage(configuration, "es-MX");
    expect(scoped["en-US"]).toEqual({ intro: "Hello", outro: "Goodbye" });
  });

  it("keeps everything that is not a language group", () => {
    expect(scopeConfigurationToLanguage(configuration, "es-MX").resolution).toBe("640x480");
  });

  it("sends only the default when that is what was asked for", () => {
    const scoped = scopeConfigurationToLanguage(configuration, "en-US");
    expect(Object.keys(scoped)).toEqual(["resolution", "en-US"]);
  });

  it("falls back to the default for a language this activity does not have", () => {
    // Visibly wrong and therefore reportable, rather than not playing at all.
    const scoped = scopeConfigurationToLanguage(configuration, "ro-RO");
    expect(scoped["ro-RO"]).toBeUndefined();
    expect(scoped["en-US"]).toEqual({ intro: "Hello", outro: "Goodbye" });
  });

  it("treats a missing language as the default", () => {
    expect(Object.keys(scopeConfigurationToLanguage(configuration, null))).toEqual([
      "resolution",
      "en-US",
    ]);
  });

  it("does not alter what it was given", () => {
    const before = JSON.stringify(configuration);
    scopeConfigurationToLanguage(configuration, "es-MX");
    expect(JSON.stringify(configuration)).toBe(before);
  });
});

describe("the scene a preview starts on", () => {
  it("writes the key the generated modules already read", () => {
    // Not a name chosen here: the module templates read configuration.__loomPreview
    // .startSceneId before the state machine boots.
    expect(withPreviewStartScene({ a: 1 }, "scene-3")).toEqual({
      a: 1,
      __loomPreview: { startSceneId: "scene-3" },
    });
  });

  it("keeps whatever else the preview object held", () => {
    const scoped = withPreviewStartScene({ __loomPreview: { other: true } }, "scene-3");
    expect(scoped.__loomPreview).toEqual({ other: true, startSceneId: "scene-3" });
  });

  it("does nothing without a scene", () => {
    const configuration = { a: 1 };
    expect(withPreviewStartScene(configuration, null)).toBe(configuration);
    expect(withPreviewStartScene(configuration, "  ")).toBe(configuration);
  });

  it("does not mutate, so two previews on different scenes do not collide", () => {
    const configuration: Record<string, unknown> = { a: 1 };
    const first = withPreviewStartScene(configuration, "scene-1");
    const second = withPreviewStartScene(configuration, "scene-9");
    expect(configuration.__loomPreview).toBeUndefined();
    expect(first.__loomPreview).toEqual({ startSceneId: "scene-1" });
    expect(second.__loomPreview).toEqual({ startSceneId: "scene-9" });
  });
});

describe("the payload the runtime fetches", () => {
  const input = (overrides: Partial<PayloadInput> = {}): PayloadInput => ({
    moduleId: "sightWords",
    title: "Sight Words",
    layout: "mainOnly",
    resolution: "640x480",
    declaration: { id: "sightWords", assets: [] },
    navBarDeclaration: { id: "navBar" },
    configuration: { intro: "Hello" },
    navBarConfiguration: { visible: true },
    hasAssessment: false,
    ...overrides,
  });

  it("marks a preview so nothing mistakes it for a deployed activity", () => {
    // The same payload shape reaches the same runtime; this is the only thing separating
    // them.
    expect(activityPayload(input()).id).toBe("preview:sightWords");
    expect(activityPayload(input()).version).toBe(PREVIEW_ACTIVITY_VERSION);
  });

  it("files each compartment's configuration under that compartment's id", () => {
    const payload = activityPayload(input());
    expect(payload.configuration.sightWords).toEqual({ intro: "Hello" });
    expect(payload.configuration.navBar).toEqual({ visible: true });
    expect(payload.configuration.resolution).toBe("640x480");
  });

  it("carries the layout and both compartments", () => {
    const payload = activityPayload(input());
    expect(payload.layout.name).toBe("mainOnly");
    expect(payload.layout.compartments.main.id).toBe("sightWords");
    expect(payload.layout.compartments.navBar.id).toBe("navBar");
  });

  it("omits the assessment keys rather than nulling them", () => {
    // Their presence is what tells the runtime to open a session, so an empty key would
    // open one with nothing in it.
    const payload = activityPayload(input());
    expect("assessmentKey" in payload).toBe(false);
    expect("assessmentVersion" in payload).toBe(false);
  });

  it("names the assessment when the activity has one", () => {
    const payload = activityPayload(input({ hasAssessment: true }));
    expect(payload.assessmentKey).toBe("sightWords");
    expect(payload.assessmentVersion).toBe(PREVIEW_ACTIVITY_VERSION);
  });
});

describe("what the module chooser lists", () => {
  it("sorts by id and falls back to the id for a label", () => {
    expect(
      moduleSummaries([
        { id: "zebra", label: "  " },
        { id: "apple", label: "Apple", hasAssessment: true },
      ]),
    ).toEqual([
      { id: "apple", label: "Apple", hasAssessment: true },
      { id: "zebra", label: "zebra", hasAssessment: false },
    ]);
  });
});
