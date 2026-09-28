/**
 * What an author typed as a ref's new number, checked against the refs already loaded, so
 * the obvious refusals are said before anything is sent. The server checks again, including
 * the numbers deleted refs keep, which the header never lists.
 */
export type RefNumberCheck =
  | { ok: true; refNum: number }
  | { ok: false; problem: "invalid" | "unchanged" }
  | { ok: false; problem: "taken"; refNum: number };

export function checkRefNumber(
  text: string,
  current: number,
  taken: readonly number[],
): RefNumberCheck {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, problem: "invalid" };
  const refNum = Number(trimmed);
  if (!Number.isSafeInteger(refNum)) return { ok: false, problem: "invalid" };
  if (refNum === current) return { ok: false, problem: "unchanged" };
  if (taken.includes(refNum)) return { ok: false, problem: "taken", refNum };
  return { ok: true, refNum };
}

/**
 * Carry unsaved media manifest text over to a ref's new number.
 *
 * The server checks a saved manifest against the ref's number, so edits still naming the
 * old one could never be saved after a renumber. Only a manifest that parses and names the
 * old number is rewritten; anything else is returned unchanged for the author to fix.
 */
export function renumberManifestText(text: string, from: number, to: number): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return text;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return text;
  const manifest = value as Record<string, unknown>;
  if (manifest.refNum !== from) return text;
  return JSON.stringify({ ...manifest, refNum: to }, null, 2);
}
