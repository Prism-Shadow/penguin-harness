/**
 * The payload (features/workbench/element-payload.ts): what one picked element becomes.
 *
 * Two things here are worth more than the rest, and each has its own group below. The `refId` —
 * FR-06's `hash(canonical source site, semantic key)` — is an identity, so the hash is pinned to
 * FNV-1a's published vectors and every way the id could drift is spelled out as its own assertion;
 * and the payload's *shape* is the frozen §6 v1, so the field-by-field test is the contract rather
 * than a description of the code. What the payload honestly cannot say yet (`source`) is asserted to
 * say `none` instead of guessing a location.
 */
import { describe, expect, it } from "vitest";
import {
  PAYLOAD_KIND,
  PAYLOAD_SCHEMA_VERSION,
  SELECTOR_NOTE,
  buildPayload,
  canonicalSite,
  elementLabel,
  elementReferenceText,
  fnv1a64Hex,
  issueRefId,
  projectNameOf,
  semanticKey,
} from "../src/features/workbench/element-payload";
import type { RefSite } from "../src/features/workbench/element-payload";
import type { ElementFacts, PageFacts } from "../src/features/workbench/element-picker";

const badge: ElementFacts = {
  tagName: "span",
  id: null,
  classList: ["badge", "badge-blue"],
  cssSelector: "div.card > span.badge",
  role: null,
  name: "Active users",
  testId: "card-title",
  attributes: { class: "badge badge-blue" },
  text: "Active users",
  computed: { "font-size": "12px", color: "rgb(17, 24, 39)" },
  rect: { x: 10, y: 20, width: 40, height: 18 },
  parentChain: ["div.card", "main#content"],
};

const page: PageFacts = {
  url: "http://127.0.0.1:5199/",
  title: "fixture",
  viewport: { width: 512, height: 526, dpr: 1 },
};

const site: RefSite = {
  projectRoot: "/opt/OH-WorkSpace/my-app",
  url: "http://127.0.0.1:5199/",
  file: "src/components/Badge.jsx",
  line: 5,
  column: 6,
};

describe("fnv1a64Hex", () => {
  it("matches FNV-1a's published vectors, so the id cannot drift into a new scheme unnoticed", () => {
    expect(fnv1a64Hex("")).toBe("cbf29ce484222325");
    expect(fnv1a64Hex("abc")).toBe("e71fa2190541574b");
  });

  it("always answers 16 hex digits", () => {
    expect(fnv1a64Hex("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("canonicalSite", () => {
  it("names root, file and position — the position exactly as far as it is known", () => {
    expect(canonicalSite(site)).toBe("/opt/OH-WorkSpace/my-app::src/components/Badge.jsx:5:6");
  });

  it("degrades to the file alone when there is no position, per FR-06", () => {
    expect(canonicalSite({ ...site, line: undefined, column: undefined })).toBe(
      "/opt/OH-WorkSpace/my-app::src/components/Badge.jsx",
    );
    expect(canonicalSite({ ...site, column: undefined })).toBe(
      "/opt/OH-WorkSpace/my-app::src/components/Badge.jsx:5",
    );
  });

  it("falls back to the page URL while nothing has resolved a source file", () => {
    expect(canonicalSite({ projectRoot: "/app", url: "http://localhost:5173/x" })).toBe(
      "/app::url:http://localhost:5173/x",
    );
  });

  it("keeps the root in the site: the same relative path in two projects is two elements", () => {
    expect(canonicalSite({ ...site, projectRoot: "/other" })).not.toBe(canonicalSite(site));
  });

  it("reads a Windows root unambiguously, colon and all", () => {
    expect(canonicalSite({ ...site, projectRoot: "C:\\dev\\app" })).toBe(
      "C:\\dev\\app::src/components/Badge.jsx:5:6",
    );
  });
});

describe("semanticKey", () => {
  it("prefers data-testid: the author saying 'this element is an interface'", () => {
    expect(semanticKey(badge)).toBe("testid:card-title");
    // With a test id, the text and the name are not part of the identity.
    expect(semanticKey({ ...badge, text: "别的文本", name: "other" })).toBe("testid:card-title");
  });

  it("then role plus accessible name", () => {
    expect(semanticKey({ ...badge, testId: null, role: "heading" })).toBe(
      "role:heading:Active users",
    );
    // A role with no name to pair with it is not half a key: it falls through to the weakest one.
    expect(semanticKey({ ...badge, testId: null })).toBe("tag:span:Active users");
    // An empty test id is no test id.
    expect(semanticKey({ ...badge, testId: "" })).toBe("tag:span:Active users");
  });

  it("finally the tag and a digest of the text — the weakest key, and it is used as such", () => {
    expect(semanticKey({ ...badge, testId: null, name: null })).toBe("tag:span:Active users");
    expect(semanticKey({ ...badge, testId: null, name: null, text: "x".repeat(200) })).toBe(
      `tag:span:${"x".repeat(80)}`,
    );
  });
});

describe("issueRefId", () => {
  it("is the same id for the same element at the same place", () => {
    expect(issueRefId(site, badge)).toBe(issueRefId(site, badge));
    expect(issueRefId(site, badge)).toMatch(/^el-[0-9a-f]{16}$/);
    // A fixed site and key, so the id itself is pinned rather than merely self-consistent.
    expect(issueRefId(site, badge)).toBe("el-ad0b8146cda21735");
  });

  it("changes when the element moves to another place in the source", () => {
    const id = issueRefId(site, badge);
    expect(issueRefId({ ...site, file: "src/components/Other.jsx" }, badge)).not.toBe(id);
    expect(issueRefId({ ...site, line: 6 }, badge)).not.toBe(id);
    expect(issueRefId({ ...site, column: 7 }, badge)).not.toBe(id);
    expect(issueRefId({ ...site, projectRoot: "/opt/OH-WorkSpace/other-app" }, badge)).not.toBe(id);
  });

  it("changes when the only thing naming the element changes", () => {
    // No test id: the text is this element's name, so different text is a different element.
    const textKeyed = { ...badge, testId: null, name: null };
    expect(issueRefId(site, textKeyed)).not.toBe(
      issueRefId(site, { ...textKeyed, text: "Active sessions" }),
    );
    // A test-id-keyed element is unmoved by a copy change — that is the whole point of the anchor.
    expect(issueRefId(site, { ...badge, text: "Active sessions" })).toBe(issueRefId(site, badge));
  });

  it("separates the two halves, so half an input cannot read as a different whole", () => {
    // The site and key are joined before hashing with a separator a site cannot contain: without it,
    // "/a::b" + "c" and "/a::" + "bc" would be the same string.
    expect(fnv1a64Hex("/a::b\u0000c")).not.toBe(fnv1a64Hex("/a::\u0000bc"));
  });

  it("is issued even with no source file at all, on the page's URL instead", () => {
    const degraded = issueRefId({ projectRoot: "/app", url: page.url }, badge);
    expect(degraded).toMatch(/^el-[0-9a-f]{16}$/);
    expect(degraded).not.toBe(issueRefId(site, badge));
  });
});

describe("projectNameOf", () => {
  it("takes the last segment, whichever separator and however it was written", () => {
    expect(projectNameOf("/opt/OH-WorkSpace/my-app")).toBe("my-app");
    expect(projectNameOf("/opt/OH-WorkSpace/my-app/")).toBe("my-app");
    expect(projectNameOf("C:\\dev\\app")).toBe("app");
  });
});

describe("buildPayload", () => {
  const payload = buildPayload({ target: badge, page, projectRoot: "/opt/OH-WorkSpace/my-app" });

  it("is the frozen §6 shape, field for field", () => {
    expect(payload).toEqual({
      kind: PAYLOAD_KIND,
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      page: {
        url: "http://127.0.0.1:5199/",
        projectRoot: "/opt/OH-WorkSpace/my-app",
        projectName: "my-app",
        viewport: { width: 512, height: 526, dpr: 1 },
      },
      target: {
        // No source yet, so the site is the page URL (D13): the id is the degraded one, and it is
        // pinned here so a change to that fallback shows up as a change, not as a mystery.
        refId: "el-2f32fd81a1e20d77",
        cssSelector: "div.card > span.badge",
        tagName: "span",
        role: null,
        name: "Active users",
        text: "Active users",
        testId: "card-title",
        attributes: { class: "badge badge-blue" },
        rect: { x: 10, y: 20, w: 40, h: 18 },
        parentChain: ["div.card", "main#content"],
      },
      source: { confidence: "none" },
      style: {
        classes: ["badge", "badge-blue"],
        computed: { "font-size": "12px", color: "rgb(17, 24, 39)" },
      },
      note: SELECTOR_NOTE,
    });
  });

  it("survives JSON.parse — it is a message payload, not a runtime object", () => {
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  it("always carries the min set the Agent may rely on", () => {
    expect(payload.kind).toBe("penguin.ui-element-ref");
    expect(payload.schemaVersion).toBe(1);
    expect(payload.page.url).not.toBe("");
    expect(payload.page.projectRoot).not.toBe("");
    expect(payload.target.tagName).not.toBe("");
    expect(payload.source.confidence).toBe("none");
  });

  it("says `none` rather than inventing a location, and takes the source when there is one", () => {
    const located = buildPayload({
      target: badge,
      page,
      projectRoot: "/opt/OH-WorkSpace/my-app",
      source: { file: "src/components/Badge.jsx", line: 5, column: 6, confidence: "exact" },
    });
    expect(located.source).toEqual({
      file: "src/components/Badge.jsx",
      line: 5,
      column: 6,
      confidence: "exact",
    });
    // The id follows the place: the same element, now located, is a different refId than the
    // degraded one — which is why a chip minted before M3 will not resolve after it.
    expect(located.target.refId).toBe("el-ad0b8146cda21735");
    expect(located.target.refId).not.toBe(payload.target.refId);
  });

  it("warns the reader that the selector is only good for this round", () => {
    expect(payload.note).toContain("refId");
    expect(payload.note).toContain("cssSelector");
  });

  it("copies what it was given: the payload cannot be changed by whoever holds the facts", () => {
    const facts: ElementFacts = { ...badge, classList: [...badge.classList] };
    const built = buildPayload({ target: facts, page, projectRoot: "/app" });
    facts.classList.push("mutated");
    facts.attributes["class"] = "mutated";
    facts.parentChain.push("mutated");
    facts.computed["font-size"] = "99px";
    expect(built.style.classes).toEqual(["badge", "badge-blue"]);
    expect(built.target.attributes).toEqual({ class: "badge badge-blue" });
    expect(built.target.parentChain).toEqual(["div.card", "main#content"]);
    expect(built.style.computed["font-size"]).toBe("12px");
  });
});

describe("elementLabel", () => {
  it("names the element the way the highlight does, then quotes what a person would call it", () => {
    // `describeTarget` is the picker's own naming (tag, id, first two classes) — the chip and the
    // highlight over the page call the element the same thing on purpose.
    expect(elementLabel(badge)).toBe('span.badge.badge-blue "Active users"');
  });

  it("falls back to the text, then to the description alone rather than to empty quotes", () => {
    expect(elementLabel({ ...badge, name: null })).toBe('span.badge.badge-blue "Active users"');
    expect(elementLabel({ ...badge, name: "", text: "" })).toBe("span.badge.badge-blue");
  });
});

describe("elementReferenceText", () => {
  const payload = buildPayload({ target: badge, page, projectRoot: "/opt/OH-WorkSpace/my-app" });

  it("is the prose line, then the payload as a fenced block an Agent can parse out", () => {
    const text = elementReferenceText('选中的 UI 元素：span.badge "Active users"', payload);
    const [lead, block] = text.split("\n\n");
    expect(lead).toBe('选中的 UI 元素：span.badge "Active users"');
    expect(block?.startsWith("```json\n")).toBe(true);
    expect(block?.endsWith("\n```")).toBe(true);
    const json = block?.slice("```json\n".length, -"\n```".length) ?? "";
    expect(JSON.parse(json)).toEqual(payload);
  });

  it("carries the payload, not a summary of it: the block is the same object the panel showed", () => {
    const text = elementReferenceText("lead", payload);
    expect(text).toContain(`"refId": "${payload.target.refId}"`);
    expect(text).toContain(`"projectRoot": "/opt/OH-WorkSpace/my-app"`);
    expect(text).toContain('"confidence": "none"');
  });
});
