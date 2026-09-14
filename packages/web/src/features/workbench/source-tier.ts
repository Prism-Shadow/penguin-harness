/**
 * Why a picked element has no source location to show, and which of the four tiers it landed in.
 *
 * `confidence` is the payload's own word for what is known (§6 rule 2), and `"none"` is where four
 * different situations meet:
 *
 * - the page's modules carry no readable map at all — a production build, the case AC-5 names;
 * - the element's creator only exists inside framework or library runtime code, so nothing in the
 *   user's own project wrote it (`moduleIsThirdParty`);
 * - the page's framework never reported where the element was written — an unsupported framework or
 *   build (PRD §9.4);
 * - evidence was there and did not map back to a source position.
 *
 * All four end at the same answer — no location — but they suggest different next moves, and saying
 * which one happened is the difference between a feature that looks broken and one that is honest
 * about its bounds (FR-07). The checks are ordered by how much of the situation each one accounts for:
 * a page-wide fact first (the probe already read it off the page), then the runtime, then the absence
 * of any evidence, and only then "we tried and could not". Nothing here is a guess about *where* the
 * element is; this module only ever explains an answer that has already come out empty.
 *
 * A located element (`exact` / `file-only` / `ambiguous`) has no gap: this returns `null`, and the
 * caller shows the tier itself. The four words are the interface — the copy lives in the strings
 * tables, and both languages key off the same reason.
 */
import { S } from "../../lib/strings";
import type { PayloadSource } from "./element-payload";
import type { PageInspection } from "./dev-server-probe";

/** Why a picked element's source half is empty. Fixed set; the strings tables carry one line each. */
export type SourceGapReason = "page-no-map" | "dependency-runtime" | "no-evidence" | "unresolved";

export interface SourceGapInput {
  /** The payload's source half: what the resolution managed to establish. */
  source: Pick<PayloadSource, "confidence" | "moduleIsThirdParty">;
  /** Whether the page's framework reported *any* origin evidence for this element at all. */
  hasEvidence: boolean;
  /** What the address probe read off the page's own entry module (`dev-server-probe.ts`). */
  pageSourceMap: PageInspection["sourceMap"];
}

export function explainSourceGap(input: SourceGapInput): SourceGapReason | null {
  const { source, hasEvidence, pageSourceMap } = input;
  // Located: there is nothing to explain. Every other tier says where the element is, in its own way.
  if (source.confidence !== "none") return null;
  // A page-wide answer, and the one a user is most likely to have caused: a build with no map in it
  // (production, or a bundler that puts the map somewhere we do not read). Nothing on this page can
  // resolve to a line, no matter which element is picked — which is why it is checked before the
  // element's own particulars.
  if (pageSourceMap === "none") return "page-no-map";
  // The map may well be there, and the element still is not ours: the frame that created it is the
  // framework's or a dependency's runtime. Editing that file changes nothing for this project.
  if (source.moduleIsThirdParty === true) return "dependency-runtime";
  // The framework never told us anything to map (PRD §9.4's unsupported frameworks and builds). This
  // is a limit of what this page can say, not of what we did with it.
  if (!hasEvidence) return "no-evidence";
  // Evidence existed and the position did not survive the map — the only one of the four that is
  // about our own resolution rather than the page.
  return "unresolved";
}

/**
 * The `source` row as the payload card shows it: which of the four tiers the element landed in
 * (FR-07), and — when it is `none` — why, rather than the fact that we have nothing.
 *
 * `pending` is the one honest state in between: the resolution is asynchronous, so from the moment a
 * pick arrives until `resolveSource` returns the panel knows nothing about the source yet, and saying
 * "no location" during that window would be a claim nobody has measured. The tier is always said in
 * words (`精确` / `只到文件` / `有歧义` / `无源码位置：…`); the machine-readable `confidence` rides in the
 * payload JSON right below, which is what an Agent reads and what the message carries.
 *
 * A located element can still be one nobody should edit — a node the page's third-party library built
 * for itself. Its row keeps the location and appends §9.4's warning (`thirdParty`), because "where is
 * it" and "whose is it" are two different answers and the user needs both.
 */
export function sourceRowText(
  source: PayloadSource,
  state: { pending: boolean; gap: SourceGapReason | null },
): string {
  const tier = S.workbench.sourceTier;
  if (state.pending) return tier.locating;
  const where =
    source.file === undefined
      ? ""
      : `${source.file}${
          source.line === undefined
            ? ""
            : `:${source.line}${source.column === undefined ? "" : `:${source.column}`}`
        }`;
  // A location that resolves *inside a dependency* is true and still not editable: the row keeps the
  // location (it is the honest answer to "where is this from") and adds what editing it would change
  // (PRD §9.4, M4.4). The `none` tier needs no marker — `dependency-runtime` already says it there.
  const library = source.moduleIsThirdParty === true ? ` · ${tier.thirdParty}` : "";
  switch (source.confidence) {
    case "exact":
      return tier.exact(where) + library;
    case "file-only":
      return tier.fileOnly(where) + library;
    case "ambiguous":
      return tier.ambiguous(where, source.candidates ?? 0) + library;
    case "none":
      return tier.none[state.gap ?? "unresolved"];
  }
}
