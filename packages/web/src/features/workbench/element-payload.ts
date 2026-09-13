/**
 * The payload (§6 of the PRD, frozen v1): what one picked element becomes on its way into the
 * conversation.
 *
 * Two halves meet here. The DOM half travels up from the page (the picker's `ElementFacts`), the
 * page half says where it was found (`PageFacts`), and the third thing — the `refId` the workbench
 * issues — is what makes the element *the same element* next round, after an edit moved it. That
 * third thing is why this module is not just field copying: FR-06 freezes `refId` as
 * `hash(canonical source site, semantic key)`, and the hash below is that function, written once
 * and tested against a fixed vector so the id cannot silently drift into a new scheme.
 *
 * What is deliberately *not* here: the source half is an argument rather than something this module
 * works out (`source-resolution.ts` establishes it, the panel explains what it could not establish).
 * A payload whose source nobody resolved says `confidence: "none"` — the honest one of the four frozen
 * values — rather than inventing a location. The `refId` degrades with it: with no file to name, the
 * canonical site falls back to the page URL (`D13`).
 */
import { describeTarget } from "./element-picker";
import type { ElementFacts, PageFacts } from "./element-picker";

/** The fixed discriminator every payload carries — how an Agent tells our element reference apart. */
export const PAYLOAD_KIND = "penguin.ui-element-ref";

/** v1. A payload from the future is a payload a reader must refuse, not guess at. */
export const PAYLOAD_SCHEMA_VERSION = 1;

/**
 * The one sentence the payload has to say about its own selector (§6 rule 5): a CSS path is true of
 * the page as it is at this moment, and a rebuild can move an element out from under it. The
 * `refId` is the durable handle; the selector is the shortcut. An Agent that takes the selector for
 * a fact writes to the right line today and the wrong one tomorrow.
 */
export const SELECTOR_NOTE =
  "cssSelector describes the page as it is right now; after a rebuild re-resolve the element by refId rather than trusting it.";

/** The four honest levels of source knowledge (§6 rule 2) — never a fifth, never a guess. */
export type Confidence = "exact" | "file-only" | "ambiguous" | "none";

export interface PayloadPage {
  url: string;
  /** An absolute path: a relative one is ambiguous the moment the repo has more than one root. */
  projectRoot: string;
  projectName: string;
  viewport: { width: number; height: number; dpr: number };
}

export interface PayloadTarget {
  refId: string;
  cssSelector: string;
  tagName: string;
  role: string | null;
  name: string | null;
  /** Cut to 200 characters by the picker, where the text is read. */
  text: string;
  testId: string | null;
  attributes: Record<string, string>;
  /** Viewport CSS pixels, in the payload's short names. Also the screenshot's crop box. */
  rect: { x: number; y: number; w: number; h: number };
  parentChain: string[];
}

export interface PayloadSource {
  file?: string;
  line?: number;
  column?: number;
  component?: string;
  jsxSnippet?: string;
  confidence: Confidence;
  /** How many candidates an `ambiguous` answer had; omitted otherwise. */
  candidates?: number;
  /** True when the location lands in `node_modules` — editing there changes nothing. */
  moduleIsThirdParty?: boolean;
}

export interface PayloadStyle {
  classes: string[];
  /** A curated set of computed properties, read in Chromium's own terms. */
  computed: Record<string, string>;
  /** The full rule chain goes to a file on the host side; the payload carries only the path. */
  matchedRulesFile?: string;
}

export interface ElementPayload {
  kind: typeof PAYLOAD_KIND;
  schemaVersion: number;
  page: PayloadPage;
  target: PayloadTarget;
  source: PayloadSource;
  style: PayloadStyle;
  note: string;
}

/**
 * The project's own name, from its root — what a person would call the thing they are looking at.
 * Both separators, because the workspace may have come from either platform.
 */
export function projectNameOf(projectRoot: string): string {
  const trimmed = projectRoot.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? trimmed;
}

/** Where an element's source lives — the first half of the `refId`'s input. */
export interface RefSite {
  projectRoot: string;
  /** The fallback anchor while there is no source file to name (M2.5 — see `D13`). */
  url: string;
  file?: string;
  line?: number;
  column?: number;
}

/**
 * The canonical source site: `projectRoot::file:line:column`.
 *
 * The root is part of the site on purpose — the same relative path in two projects is two
 * elements — and `::` keeps a Windows drive letter or a colon in a path from reading as a position.
 * A site with no file (nothing has resolved one yet) falls back to the page URL: not a source
 * location, but a stable name for "this element, on this page", which is the most that is honestly
 * known until M3. Precise position beats file alone, exactly as FR-06 requires.
 */
export function canonicalSite(site: RefSite): string {
  const at = site.file === undefined ? `url:${site.url}` : site.file;
  const position =
    site.line === undefined
      ? ""
      : `:${site.line}${site.column === undefined ? "" : `:${site.column}`}`;
  return `${site.projectRoot}::${at}${position}`;
}

/**
 * An element's semantic key — the second half of the `refId`'s input, in FR-06's order of
 * preference: a `data-testid` is the author saying "this element is an interface", and it survives
 * both a re-style and a rewrite of the text; a role plus an accessible name is the next most
 * stable thing a page actually declares; tag plus a text digest is what is left when a page names
 * nothing, and it is the weakest of the three on purpose — change that text and the element is a
 * different element as far as this key can tell.
 */
export function semanticKey(target: {
  tagName: string;
  role: string | null;
  name: string | null;
  testId: string | null;
  text: string;
}): string {
  if (target.testId !== null && target.testId !== "") return `testid:${target.testId}`;
  if (target.role !== null && target.name !== null) return `role:${target.role}:${target.name}`;
  return `tag:${target.tagName}:${target.text.slice(0, 80)}`;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

/**
 * FNV-1a, 64 bits, as 16 hex digits. This is an identity, not a security boundary: the id only has
 * to be stable and collision-free in practice for the handful of elements a conversation holds.
 * Bytes rather than UTF-16 code units, so the same site hashes the same everywhere.
 */
export function fnv1a64Hex(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Issue the element's id: FR-06's `hash(canonical source site, semantic key)`.
 *
 * The two halves answer two different questions and are joined before hashing, not after: the site
 * says *where the element is written* (stable across a re-style, since styling does not move a
 * line), the key says *which element at that site it is*. Hashing the joined string means an edit
 * that moves the element to another line, or rewrites the only thing naming it, produces a
 * different id — which is the point: an id must never point at two different elements, and a
 * caller that finds the id gone learns the element is gone rather than editing whatever moved
 * into its place.
 */
export function issueRefId(site: RefSite, target: ElementFacts): string {
  return `el-${fnv1a64Hex(`${canonicalSite(site)}\u0000${semanticKey(target)}`)}`;
}

export interface PayloadInput {
  target: ElementFacts;
  page: PageFacts;
  /** The Session's workspace — the project being previewed (PRD:142). */
  projectRoot: string;
  /** The source half. Absent in v1: `{confidence: "none"}` is written instead of inventing one. */
  source?: PayloadSource;
}
/**
 * Assemble the payload. Pure: everything it needs is an argument, so the shape a test asserts is
 * the shape the panel sends.
 */
export function buildPayload(input: PayloadInput): ElementPayload {
  const { target, page, projectRoot } = input;
  const source = input.source ?? { confidence: "none" as Confidence };
  const refId = issueRefId(
    {
      projectRoot,
      url: page.url,
      ...(source.file !== undefined ? { file: source.file } : {}),
      ...(source.line !== undefined ? { line: source.line } : {}),
      ...(source.column !== undefined ? { column: source.column } : {}),
    },
    target,
  );
  return {
    kind: PAYLOAD_KIND,
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    page: {
      url: page.url,
      projectRoot,
      projectName: projectNameOf(projectRoot),
      viewport: { ...page.viewport },
    },
    target: {
      refId,
      cssSelector: target.cssSelector,
      tagName: target.tagName,
      role: target.role,
      name: target.name,
      text: target.text,
      testId: target.testId,
      attributes: { ...target.attributes },
      rect: {
        x: target.rect.x,
        y: target.rect.y,
        w: target.rect.width,
        h: target.rect.height,
      },
      parentChain: [...target.parentChain],
    },
    source,
    style: { classes: [...target.classList], computed: { ...target.computed } },
    note: SELECTOR_NOTE,
  };
}

/**
 * What the chip calls this element: `span.badge "hello"`.
 *
 * The description is the same one the picker paints over the page (`span.badge`), so the chip and
 * the highlight name the element the same way, and the quoted part is what a person would say to
 * point at it — the accessible name when the page declares one, its text otherwise. An element with
 * neither is still named by its description rather than by an empty pair of quotes.
 */
export function elementLabel(target: ElementFacts): string {
  const described = describeTarget(target);
  const quoted = target.name ?? target.text;
  return quoted === null || quoted === "" ? described : `${described} "${quoted}"`;
}

/**
 * What one element reference contributes to the message: the caller's line of prose naming the
 * element, then the payload as a fenced JSON block.
 *
 * The prose comes in as an argument because it is user-facing copy and this module holds none of it
 * (the strings tables do), and it is prose rather than more JSON because a message is read by a
 * person too. The block is fenced and machine-parseable on its own, which is the whole point of a
 * payload: an Agent reads the JSON, the sentence is for whoever is looking at the conversation.
 */
export function elementReferenceText(lead: string, payload: ElementPayload): string {
  return `${lead}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}
