/**
 * Easy for everyone to use: turning what axe and the keyboard probe saw on each scene of the
 * played activity into one accessibility report.
 *
 * Axe checks the page against the WCAG 2.2 AA rules. It cannot tell whether a control can be
 * reached and worked from the keyboard, so a small probe runs in the page as well: it focuses
 * every control it can see, and reports whether the control takes focus, whether focusing it
 * changes how it looks, and whether Enter or Space would work it. Both results come back to
 * the pure functions here, which a test drives without a browser.
 *
 * Impact becomes severity (critical and serious: Must fix; moderate: Should fix; minor:
 * Minor). Must fix and Should fix block. Captions rules, and the rules an admin lists as VPAT
 * exceptions, are still reported but never block: an activity for pre-readers is built to be
 * heard, and says so in its VPAT.
 */
import type {
  QualityFinding,
  QualityReport,
  QualitySeverity,
  QualityStatus,
} from "./quality-types.js";

/** The axe tags a scan runs: WCAG 2.0, 2.1 and 2.2 at levels A and AA. */
export const WCAG_TAGS: readonly string[] = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

/** Axe's captions rules: reported, never blocking. */
export const CAPTION_RULES: readonly string[] = ["video-caption", "audio-caption"];

/** The keyboard rules the probe's results are judged by. */
export const KEYBOARD_RULES = {
  focusable: "keyboard-focusable",
  focusVisible: "keyboard-focus-visible",
  activation: "keyboard-activation",
} as const;

const RANK: Record<QualitySeverity, number> = { note: 0, minor: 1, should: 2, must: 3 };

/** Axe's impact as a severity. Anything axe does not name is Minor. */
export function severityOf(impact: unknown): QualitySeverity {
  if (impact === "critical" || impact === "serious") return "must";
  if (impact === "moderate") return "should";
  return "minor";
}

/** Whether a severity fails the check. */
export function blocks(severity: QualitySeverity): boolean {
  return severity === "must" || severity === "should";
}

/** An axe node's target (a selector, or a chain of them through frames), as one string. */
function targetText(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (!Array.isArray(value)) return null;
  const parts = value.map((part) => targetText(part)).filter((part): part is string => !!part);
  return parts.length ? parts.join(" ") : null;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Axe's violations on one scene, as findings. Anything malformed is left out. */
export function normalizeViolations(results: unknown, scene: string | null): QualityFinding[] {
  const violations =
    results && typeof results === "object"
      ? (results as { violations?: unknown }).violations
      : undefined;
  if (!Array.isArray(violations)) return [];
  const findings: QualityFinding[] = [];
  for (const violation of violations) {
    if (!violation || typeof violation !== "object") continue;
    const entry = violation as Record<string, unknown>;
    const code = text(entry.id);
    if (!code) continue;
    const severity = severityOf(entry.impact);
    const nodes = Array.isArray(entry.nodes) ? (entry.nodes as unknown[]) : [];
    const first =
      nodes[0] && typeof nodes[0] === "object" ? (nodes[0] as { target?: unknown }) : {};
    const helpUrl = text(entry.helpUrl);
    findings.push({
      id: "",
      severity,
      blocking: blocks(severity),
      target: targetText(first.target),
      scene,
      code,
      detail: text(entry.help) || text(entry.description),
      ...(/^https:\/\//.test(helpUrl) ? { helpUrl } : {}),
      count: Math.max(nodes.length, 1),
    });
  }
  return findings;
}

/** One control the keyboard probe found on a scene. */
export interface ProbedControl {
  id: string;
  tag: string;
  role: string;
  /** Natively focusable, or given a tabindex of 0 or more. */
  focusable: boolean;
  /** Focusing it changed its outline or shadow. */
  focusVisible: boolean;
  /** A native control, or one whose role Enter or Space works. */
  keyActivable: boolean;
}

/** What the probe reports: the controls, and the text a learner can see. */
export interface ProbeResult {
  controls: ProbedControl[];
  text: string[];
}

/** The probe's answer, read defensively: it comes back from a page. */
export function readProbe(value: unknown): ProbeResult {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const controls = Array.isArray(raw.controls) ? raw.controls : [];
  const shown = Array.isArray(raw.text) ? raw.text : [];
  return {
    controls: controls
      .filter(
        (control): control is Record<string, unknown> => !!control && typeof control === "object",
      )
      .map((control) => ({
        id: text(control.id).slice(0, 200),
        tag: text(control.tag).slice(0, 40),
        role: text(control.role).slice(0, 40),
        focusable: control.focusable === true,
        focusVisible: control.focusVisible === true,
        keyActivable: control.keyActivable === true,
      })),
    text: shown
      .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
      .map((entry) => entry.trim()),
  };
}

/** Where a control is, as a selector a reader can find it by. */
function controlTarget(control: ProbedControl): string {
  if (control.id) return `#${control.id}`;
  return control.role ? `${control.tag}[role=${control.role}]` : control.tag;
}

/**
 * The keyboard rules. A control that cannot take focus is Must fix, and nothing more is said
 * about it; one that takes focus without showing it, or that Enter and Space may not work,
 * is Should fix.
 */
export function keyboardFindings(
  controls: readonly ProbedControl[],
  scene: string | null,
): QualityFinding[] {
  const findings: QualityFinding[] = [];
  const finding = (code: string, severity: QualitySeverity, control: ProbedControl) =>
    findings.push({
      id: "",
      severity,
      blocking: blocks(severity),
      target: controlTarget(control),
      scene,
      code,
      detail: control.id || control.tag,
      count: 1,
    });
  for (const control of controls) {
    if (!control.focusable) {
      finding(KEYBOARD_RULES.focusable, "must", control);
      continue;
    }
    if (!control.focusVisible) finding(KEYBOARD_RULES.focusVisible, "should", control);
    if (!control.keyActivable) finding(KEYBOARD_RULES.activation, "should", control);
  }
  return findings;
}

/**
 * One finding per rule per scene: the highest severity found, the element counts added up,
 * and the first place it was seen.
 */
export function dedupe(findings: readonly QualityFinding[]): QualityFinding[] {
  const merged = new Map<string, QualityFinding>();
  for (const finding of findings) {
    const key = `${finding.code}\u0000${finding.scene ?? ""}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...finding });
      continue;
    }
    existing.count = (existing.count ?? 1) + (finding.count ?? 1);
    if (RANK[finding.severity] > RANK[existing.severity]) {
      existing.severity = finding.severity;
      existing.blocking = finding.blocking;
      existing.detail = finding.detail || existing.detail;
    }
  }
  return [...merged.values()];
}

/** Lets the rules an admin listed through: still reported, no longer blocking. */
export function applyExceptions(
  findings: readonly QualityFinding[],
  ruleIds: readonly string[],
): QualityFinding[] {
  const listed = new Set(ruleIds.map((rule) => rule.trim().toLowerCase()).filter(Boolean));
  return findings.map((finding) =>
    listed.has(finding.code.toLowerCase()) && !finding.waived
      ? { ...finding, blocking: false, waived: "vpat" }
      : finding,
  );
}

/** Captions rules are warnings, whatever their impact. */
export function captionsAsWarnings(findings: readonly QualityFinding[]): QualityFinding[] {
  return findings.map((finding) =>
    CAPTION_RULES.includes(finding.code) && !finding.waived
      ? { ...finding, blocking: false, waived: "captions" }
      : finding,
  );
}

/** Failed when anything blocks; with warnings when something was found; passed otherwise. */
export function accessibilityStatus(findings: readonly QualityFinding[]): QualityStatus {
  if (findings.some((finding) => finding.blocking)) return "failed";
  return findings.length ? "passed_with_warnings" : "passed";
}

/** Most severe first, then by scene and rule, so a report reads the same each time. */
function ordered(findings: QualityFinding[]): QualityFinding[] {
  return findings.sort(
    (left, right) =>
      Number(right.blocking) - Number(left.blocking) ||
      RANK[right.severity] - RANK[left.severity] ||
      (left.scene ?? "").localeCompare(right.scene ?? "") ||
      left.code.localeCompare(right.code),
  );
}

/** Everything found on every scene, as the accessibility report. */
export function accessibilityReport(input: {
  findings: readonly QualityFinding[];
  scenes: readonly string[];
  exceptions: readonly string[];
  checkedAt: string;
}): QualityReport {
  const findings = ordered(
    applyExceptions(captionsAsWarnings(dedupe(input.findings)), input.exceptions),
  ).map((finding) => ({ ...finding, id: `${finding.code}@${finding.scene ?? ""}` }));
  return {
    check: "accessibility",
    status: accessibilityStatus(findings),
    findings,
    checkedAt: input.checkedAt,
    scenes: [...input.scenes],
  };
}

/**
 * Runs in the played page, as it opened: the keyboard facts about every control a learner
 * can see, and every piece of text they can see. An expression, so it is evaluated as it is.
 */
export const PAGE_PROBE = `(() => {
  const CONTROLS = [
    "a[href]", "button", "input", "select", "textarea",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]",
    "[tabindex]", "#choices > *", "#repeat",
  ].join(",");
  const NATIVE = new Set(["a", "button", "input", "select", "textarea"]);
  const WORKED_BY_KEYS = new Set(["button", "link", "checkbox", "radio"]);
  const SKIPPED = new Set(["script", "style", "noscript", "template"]);
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 || box.height > 0;
  };
  const ring = (style) => [style.outlineStyle, style.outlineWidth, style.boxShadow].join("|");
  const controls = [];
  for (const element of new Set(document.querySelectorAll(CONTROLS))) {
    if (controls.length >= 500) break;
    if (!visible(element)) continue;
    const tag = element.tagName.toLowerCase();
    const native = NATIVE.has(tag);
    const tabindex = element.getAttribute("tabindex");
    const order = tabindex === null ? (native ? 0 : -1) : Number.parseInt(tabindex, 10);
    const before = ring(window.getComputedStyle(element));
    let focusVisible = false;
    try {
      element.focus({ preventScroll: true });
      const after = window.getComputedStyle(element);
      focusVisible =
        (after.outlineStyle !== "none" && after.outlineWidth !== "0px") || ring(after) !== before;
      element.blur();
    } catch (error) {
      focusVisible = false;
    }
    const role = element.getAttribute("role") || "";
    controls.push({
      id: element.id || "",
      tag,
      role,
      focusable: native || order >= 0,
      focusVisible,
      keyActivable: native || WORKED_BY_KEYS.has(role),
    });
  }
  // Text is read block by block, so a sentence with a bold or highlighted word inside it stays
  // one sentence: each text node joins the nearest ancestor that is not laid out inline.
  const blockOf = (element) => {
    for (let current = element; current && current !== document.body; current = current.parentElement) {
      const display = window.getComputedStyle(current).display;
      if (display !== "inline" && display !== "contents") return current;
    }
    return document.body;
  };
  const skipped = (element) => {
    for (let current = element; current; current = current.parentElement)
      if (SKIPPED.has(current.tagName.toLowerCase())) return true;
    return false;
  };
  const blocks = new Map();
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.data.trim() || skipped(parent) || !visible(parent)) continue;
      const block = blockOf(parent);
      if (!blocks.has(block) && blocks.size >= 2000) break;
      blocks.set(block, (blocks.get(block) || "") + node.data);
    }
  }
  const text = [];
  const seen = new Set();
  for (const joined of blocks.values()) {
    if (text.length >= 1000) break;
    const words = joined.replace(/\\s+/g, " ").trim().slice(0, 500);
    if (!words || seen.has(words)) continue;
    seen.add(words);
    text.push(words);
  }
  return { controls, text };
})()`;

/** Runs axe, once injected, on the whole page for the given tags. */
export function axeRunScript(tags: readonly string[]): string {
  return `window.axe.run(document, { runOnly: { type: "tag", values: ${JSON.stringify(tags)} }, resultTypes: ["violations"] })`;
}

/** Whether the player has started: the framework's inspection bridge is there. */
export const PLAYER_READY = "!!(window.Activity && window.Activity.Inspection)";
