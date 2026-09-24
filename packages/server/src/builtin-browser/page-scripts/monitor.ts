// Ported from GenericAgent's simphtml.py (MIT, Copyright (c) 2025 lsdefine) — https://github.com/lsdefine/genericagent
/**
 * What an action did to the page, measured in the page (execute_js_rich's monitoring):
 *
 * - The transient-text monitor (`startStrMonitor` / `stopStrMonitor`): text that appears while
 *   the action runs and may be gone again by the time anyone looks — a toast, a flash, a
 *   "Saved". It samples the page's text every 450 ms and reports what was new.
 * - The change diff: a baseline of the simplified page is kept in the page itself
 *   (`window.__penguinSnap`) before the action, and compared with the page after it —
 *   find_changed_elements, on DOMParser instead of BeautifulSoup. It reports how many elements
 *   changed and the largest changed subtree (at most 2000 characters).
 *
 * Both live in the page's window, so a navigation takes them with it: the end script then
 * answers `{ lost: true }`, which the action reports as a reload. JavaScript SOURCE STRINGS,
 * for the reason simplify.ts gives.
 */
import { SIMPLIFY_LIBRARY } from "./simplify.js";

const STR_MONITOR = String.raw`function startStrMonitor(interval) {
  if (window.__penguinTm && window.__penguinTm.id) clearInterval(window.__penguinTm.id);
  window.__penguinTm = {extract: () => {
    const texts = new Set(), walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    let node, t, s; while (node = walker.nextNode())
      ((t = node.textContent.trim()) && t.length > 10 && !(s = t.substring(0, 20)).includes('_')) && texts.add(s);
    return texts;
  }};
  window.__penguinTm.init = window.__penguinTm.extract();
  window.__penguinTm.all = new Set();
  window.__penguinTm.id = setInterval(() => window.__penguinTm.extract().forEach(t => window.__penguinTm.all.add(t)), interval);
}
function stopStrMonitor() {
  const tm = window.__penguinTm;
  if (!tm) return null;
  clearInterval(tm.id);
  const final = tm.extract();
  const newlySeen = [...tm.all].filter(t => !tm.init.has(t));
  let result;
  if (newlySeen.length < 8) {
    result = newlySeen;
  } else {
    result = newlySeen.filter(t => !final.has(t));
  }
  delete window.__penguinTm;
  return result;
}`;

const FIND_CHANGED = String.raw`function findChangedElements(beforeHtml, afterHtml) {
  const before = __penguinParse(beforeHtml), after = __penguinParse(afterHtml);
  const directText = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.data.trim()).join('').trim();
  const sig = (el) => el.localName + ':' + JSON.stringify(Array.from(el.attributes).filter((a) => a.name !== 'data-track-id').map((a) => [a.name, a.value])) + ':' + directText(el);
  const elements = (parsed) => parsed.wrapped ? __penguinTags(parsed) : Array.from(parsed.doc.body.querySelectorAll('*'));
  const bySig = (els) => {
    const map = new Map();
    for (const el of els) {
      const key = sig(el);
      const list = map.get(key);
      if (list) list.push(el); else map.set(key, [el]);
    }
    return map;
  };
  const beforeEls = elements(before), afterEls = elements(after);
  const beforeSigs = bySig(beforeEls), afterSigs = bySig(afterEls);
  const changed = [];
  for (const [key, els] of afterSigs) {
    const prev = beforeSigs.get(key);
    if (!prev) changed.push(...els);
    else if (els.length > prev.length) changed.push(...els.slice(0, els.length - prev.length));
  }
  if (changed.length === 0 && __penguinSerialize(before) !== __penguinSerialize(after)) {
    for (let i = 0; i < Math.min(beforeEls.length, afterEls.length); i++) {
      if (sig(beforeEls[i]) !== sig(afterEls[i])) changed.push(afterEls[i]);
    }
  }
  // The change's boundaries: changed elements whose parent did not change
  const ids = new Set(changed);
  const boundaries = changed.filter((el) => !el.parentElement || !ids.has(el.parentElement));
  let top = null, topLen = -1;
  for (const el of boundaries) {
    const len = el.outerHTML.length;
    if (len > topLen) { top = el; topLen = len; }
  }
  const result = { changed: changed.length };
  if (top) {
    const h = top.outerHTML;
    result.topChange = h.length <= 2000 ? h : h.slice(0, 2000) + '...[TRUNCATED]';
  }
  return result;
}`;

/**
 * Before an action: start the transient monitor, then keep the baseline. The monitor starts
 * even when the baseline cannot be taken; the end then reports transients without a diff.
 */
export const MONITOR_BEGIN_SCRIPT = [
  SIMPLIFY_LIBRARY,
  STR_MONITOR,
  "startStrMonitor(450);",
  "try { window.__penguinSnap = __penguinSnapshotHtml(); } catch (e) { window.__penguinSnap = null; }",
  "return true;",
].join("\n");

/**
 * After it: `{ transients, changed?, topChange? }`, or `{ lost: true }` when the document the
 * monitor started in is gone.
 */
export const MONITOR_END_SCRIPT = [
  SIMPLIFY_LIBRARY,
  STR_MONITOR,
  FIND_CHANGED,
  String.raw`const snap = window.__penguinSnap;
delete window.__penguinSnap;
const transients = stopStrMonitor();
if (transients === null) return { lost: true };
const out = { transients };
if (typeof snap === 'string') {
  try {
    const diff = findChangedElements(snap, __penguinSnapshotHtml());
    out.changed = diff.changed;
    if (diff.topChange) out.topChange = diff.topChange;
  } catch (e) {}
}
return out;`,
].join("\n");

/** Stops a monitor an action started but could not finish (its target was never clicked). */
export const MONITOR_STOP_SCRIPT = [
  STR_MONITOR,
  "stopStrMonitor();",
  "delete window.__penguinSnap;",
  "return true;",
].join("\n");
