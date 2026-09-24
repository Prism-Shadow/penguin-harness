import { describe, expect, it } from "vitest";
import { activitySpec } from "./activity-fixtures.js";
import { mapImport, type SourceProduct, type SourceRef } from "../src/activities/import-mapping.js";
import {
  applyImport,
  describeOutcome,
  type ExistingProduct,
  type ImportTarget,
} from "../src/activities/import-apply.js";

const product = (overrides: Partial<SourceProduct> = {}): SourceProduct => ({
  productCode: "sight-words",
  moduleFolder: "waf-module-sight-words",
  title: "Sight Words",
  canonicalRefNum: 1,
  activityType: "standard",
  bookMode: null,
  ...overrides,
});

const ref = (refNum: number, overrides: Partial<SourceRef> = {}): SourceRef => ({
  refNum,
  title: `Sight Words ${refNum}`,
  displayName: null,
  stable: false,
  spec: { ...activitySpec },
  manifest: { assets: { "en-US": [] } },
  description: "Practice sight words.",
  languages: ["en-US"],
  ...overrides,
});

interface Call {
  name: string;
  detail: Record<string, unknown>;
}

/** A store that records what it was asked to do, and can be told to refuse one ref. */
function fakeTarget(options: { existing?: ExistingProduct; refuse?: Map<number, string> } = {}) {
  const calls: Call[] = [];
  let nextId = 0;
  const target: ImportTarget = {
    async existingProduct() {
      return options.existing ?? null;
    },
    async createRef(input) {
      calls.push({ name: "createRef", detail: { ...input } });
      const refusal = options.refuse?.get(input.refNum);
      if (refusal) throw new Error(refusal);
      nextId += 1;
      return { activityId: `act${nextId}`, revision: `rev${nextId}-0` };
    },
    async setRefIdentity(activityId, identity) {
      calls.push({ name: "setRefIdentity", detail: { activityId, ...identity } });
    },
    async setDescription(activityId, description, revision) {
      calls.push({ name: "setDescription", detail: { activityId, description, revision } });
      return `${revision}+d`;
    },
    async setSpec(activityId, spec, revision) {
      calls.push({ name: "setSpec", detail: { activityId, spec, revision } });
      return `${revision}+s`;
    },
    async setBookMode(productCode, mode) {
      calls.push({ name: "setBookMode", detail: { productCode, mode } });
    },
    async setImplementationFeatures(activityId, selectedIds) {
      calls.push({ name: "setImplementationFeatures", detail: { activityId, selectedIds } });
    },
    async setMedia(activityId, media, revision) {
      calls.push({ name: "setMedia", detail: { activityId, media, revision } });
      return `${revision}+m`;
    },
  };
  return { target, calls, named: (name: string) => calls.filter((call) => call.name === name) };
}

describe("importing a product", () => {
  it("binds media as Loom had it once the specification is in, and only then", async () => {
    const { target, named } = fakeTarget();
    const bound = {
      ...ref(1),
      manifest: {
        assets: { "en-US": [{ key: "hi", type: "audio", path: "media/a/hi.mp3", script: "Hi" }] },
      },
    };
    await applyImport(mapImport(product(), [bound, { ...bound, refNum: 2, spec: null }]), target);
    const media = named("setMedia").map((call) => call.detail);
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({
      activityId: "act1",
      media: { "en-US": [{ key: "hi", path: "media/a/hi.mp3", script: "Hi" }] },
    });
    // It follows the specification's revision, not the draft's first one.
    expect(String(media[0]!.revision)).toContain("+s");
  });

  it("carries a ref's implementation features, and asks nothing of refs without any", async () => {
    const { target, named } = fakeTarget();
    await applyImport(
      mapImport(product(), [
        { ...ref(1), implementationFeatures: ["r2phcs03l-speaker-audio-choices"] },
        ref(2),
      ]),
      target,
    );
    expect(named("setImplementationFeatures").map((call) => call.detail)).toEqual([
      { activityId: "act1", selectedIds: ["r2phcs03l-speaker-audio-choices"] },
    ]);
  });

  it("creates every ref and reports them", async () => {
    const { target } = fakeTarget();
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2)]), target);
    expect(outcome.created).toEqual([1, 2]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.skipped).toEqual([]);
  });

  it("creates the canonical ref first, because the first ref owns the module", async () => {
    // the-ant-lab-25 has refs 3 and 5; whichever is created first becomes canonical, and
    // three generation stages are gated on that being the right one.
    const { target, named } = fakeTarget();
    await applyImport(mapImport(product({ canonicalRefNum: 5 }), [ref(3), ref(5)]), target);
    expect(named("createRef").map((call) => call.detail.refNum)).toEqual([5, 3]);
  });

  it("carries the module folder on every create, since only the first one reads it", async () => {
    const { target, named } = fakeTarget();
    await applyImport(mapImport(product(), [ref(1)]), target);
    expect(named("createRef")[0]!.detail.moduleFolder).toBe("waf-module-sight-words");
  });

  it("writes the description and then the specification, threading the revision", async () => {
    const { target, calls } = fakeTarget();
    await applyImport(mapImport(product(), [ref(1)]), target);
    // A ref Loom had a manifest for gets a media plan, planned from its specification.
    expect(calls.map((call) => call.name)).toEqual([
      "createRef",
      "setDescription",
      "setSpec",
      "setMedia",
    ]);
    expect(calls[1]!.detail.revision).toBe("rev1-0");
    expect(calls[2]!.detail.revision).toBe("rev1-0+d");
    expect(calls[3]!.detail.revision).toBe("rev1-0+d+s");
  });

  it("sets a ref's name and stability, which creation does not accept", async () => {
    const { target, named } = fakeTarget();
    await applyImport(
      mapImport(product(), [ref(1, { displayName: "Warm-up", stable: true })]),
      target,
    );
    expect(named("setRefIdentity")[0]!.detail).toEqual({
      activityId: "act1",
      displayName: "Warm-up",
      stable: true,
    });
  });

  it("does not touch identity when there is nothing to set", async () => {
    const { target, named } = fakeTarget();
    await applyImport(mapImport(product(), [ref(1)]), target);
    expect(named("setRefIdentity")).toEqual([]);
  });

  it("writes no specification when the ref has none, rather than an empty one", async () => {
    // The mapping already reported this as a loss; an empty spec would make it look imported.
    const { target, named } = fakeTarget();
    await applyImport(mapImport(product(), [ref(1, { spec: null })]), target);
    expect(named("setSpec")).toEqual([]);
  });

  it("writes no description when there is none", async () => {
    const { target, named } = fakeTarget();
    await applyImport(mapImport(product(), [ref(1, { description: "  " })]), target);
    expect(named("setDescription")).toEqual([]);
  });
});

describe("a book", () => {
  it("sets the reading mode once the refs exist", async () => {
    const { target, named } = fakeTarget();
    await applyImport(
      mapImport(product({ activityType: "book", bookMode: "readAlong" }), [ref(1)]),
      target,
    );
    expect(named("createRef")[0]!.detail.activityType).toBe("book");
    expect(named("setBookMode")[0]!.detail).toEqual({
      productCode: "sight-words",
      mode: "readAlong",
    });
  });

  it("sets no reading mode when nothing was created", async () => {
    const { target, named } = fakeTarget({
      existing: { refNums: [1], archivedRefNums: [], canonicalRefNum: 1 },
    });
    await applyImport(
      mapImport(product({ activityType: "book", bookMode: "readAlong" }), [ref(1)]),
      target,
    );
    expect(named("setBookMode")).toEqual([]);
  });

  it("sets nothing when Loom recorded no mode, rather than guessing one", async () => {
    const { target, named } = fakeTarget();
    await applyImport(mapImport(product({ activityType: "book" }), [ref(1)]), target);
    expect(named("setBookMode")).toEqual([]);
  });
});

describe("running an import again", () => {
  it("skips refs that are already there and creates the rest", async () => {
    const { target, named } = fakeTarget({
      existing: { refNums: [1], archivedRefNums: [], canonicalRefNum: 1 },
    });
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2)]), target);
    expect(outcome.skipped).toEqual([1]);
    expect(outcome.created).toEqual([2]);
    expect(named("createRef").map((call) => call.detail.refNum)).toEqual([2]);
  });

  it("reports deleted refs as deleted, and neither recreates them nor calls them present", async () => {
    const { target, named } = fakeTarget({
      existing: { refNums: [2], archivedRefNums: [1, 3], canonicalRefNum: 1 },
    });
    const outcome = await applyImport(
      mapImport(product(), [ref(1), ref(2), ref(3), ref(4)]),
      target,
    );
    expect(outcome.archived).toEqual([1, 3]);
    expect(outcome.skipped).toEqual([2]);
    expect(outcome.created).toEqual([4]);
    expect(outcome.canonicalConflict).toBeNull();
    expect(named("createRef").map((call) => call.detail.refNum)).toEqual([4]);
    expect(describeOutcome(outcome, "words")).toContain(
      "Refs 1, 3 were deleted here earlier and were not imported again",
    );
  });

  it("does nothing at all when everything is there", async () => {
    const { target, calls } = fakeTarget({
      existing: { refNums: [1, 2], archivedRefNums: [], canonicalRefNum: 1 },
    });
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2)]), target);
    expect(outcome.created).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("when something refuses", () => {
  it("keeps importing the other refs, since nine good ones are still worth having", async () => {
    const { target } = fakeTarget({ refuse: new Map([[2, "spec_invalid"]]) });
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2), ref(3)]), target);
    expect(outcome.created).toEqual([1, 3]);
    expect(outcome.failed).toEqual([{ refNum: 2, reason: "spec_invalid" }]);
  });

  it("abandons the product when its canonical ref cannot be created", async () => {
    // Importing the rest would make a different ref the first one, and the first ref owns
    // the shared module.
    const { target, named } = fakeTarget({ refuse: new Map([[1, "activity_exists"]]) });
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2)]), target);
    expect(outcome.abandoned).toBe(true);
    expect(outcome.created).toEqual([]);
    expect(named("createRef")).toHaveLength(1);
  });

  it("does not abandon when the product already exists, since ownership is settled", async () => {
    const { target } = fakeTarget({
      existing: { refNums: [9], archivedRefNums: [], canonicalRefNum: 9 },
      refuse: new Map([[1, "spec_invalid"]]),
    });
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2)]), target);
    expect(outcome.abandoned).toBe(false);
    expect(outcome.created).toEqual([2]);
  });
});

describe("a ref that exists but could not be finished", () => {
  it("is created, reported apart from a failure, and not called complete", async () => {
    const { target } = fakeTarget();
    const failing = {
      ...target,
      setSpec: async () => {
        throw new Error("spec_invalid");
      },
    };
    const outcome = await applyImport(mapImport(product(), [ref(1)]), failing);
    expect(outcome.created).toEqual([1]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.partial).toEqual([{ refNum: 1, reason: "spec_invalid" }]);
    expect(describeOutcome(outcome, "sight-words")).toContain("exists but was not finished");
  });
});

describe("module ownership that does not match", () => {
  it("reports a product whose canonical ref is already a different one", async () => {
    const { target } = fakeTarget({
      existing: { refNums: [9], archivedRefNums: [], canonicalRefNum: 9 },
    });
    const outcome = await applyImport(mapImport(product({ canonicalRefNum: 1 }), [ref(1)]), target);
    expect(outcome.canonicalConflict).toEqual({ loom: 1, penguin: 9 });
    expect(outcome.created).toEqual([1]);
  });

  it("says nothing when they agree", async () => {
    const { target } = fakeTarget({
      existing: { refNums: [1], archivedRefNums: [], canonicalRefNum: 1 },
    });
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2)]), target);
    expect(outcome.canonicalConflict).toBeNull();
  });
});

describe("what an author is told", () => {
  it("counts what happened", async () => {
    const { target } = fakeTarget({
      existing: { refNums: [1], archivedRefNums: [], canonicalRefNum: 1 },
      refuse: new Map([[3, "spec_invalid"]]),
    });
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2), ref(3)]), target);
    const message = describeOutcome(outcome, "sight-words");
    expect(message).toContain("Imported 1 ref");
    expect(message).toContain("1 ref was already there");
    expect(message).toContain("ref 3 (spec_invalid)");
  });

  it("explains an abandoned product by its consequence, not its error code", async () => {
    const { target } = fakeTarget({ refuse: new Map([[1, "disk full"]]) });
    const outcome = await applyImport(mapImport(product(), [ref(1), ref(2)]), target);
    const message = describeOutcome(outcome, "sight-words");
    expect(message).toContain("would give the module to a different ref");
    expect(message).toContain("disk full");
  });

  it("says so when there was nothing left to do", async () => {
    const { target } = fakeTarget({
      existing: { refNums: [1], archivedRefNums: [], canonicalRefNum: 1 },
    });
    const outcome = await applyImport(mapImport(product(), [ref(1)]), target);
    expect(describeOutcome(outcome, "sight-words")).toContain("nothing left to import");
  });
});
