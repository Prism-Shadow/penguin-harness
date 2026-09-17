/**
 * URL hash -> the id of the element it targets. Pure and unit-testable.
 *
 * `location.hash` carries the fragment percent-encoded: a link to the CJK heading
 * `## 升级须知` arrives as `#%E5%8D%87%E7%BA%A7%E9%A1%BB%E7%9F%A5`, while the heading's id
 * (slugifyHeading in toc.ts) holds the decoded text, so the fragment is decoded before
 * any lookup. A malformed escape (`#100%`) cannot be decoded and falls back to the raw
 * fragment instead of throwing — a throw inside a React effect would unmount the page.
 * The leading `#` is optional, and a fragment without escapes comes back unchanged.
 *
 * The docs site carries the same helper (packages/docs/src/lib/hash.ts); the two sites
 * share no package, so keep them aligned.
 */
export function hashTargetId(hash: string): string {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
