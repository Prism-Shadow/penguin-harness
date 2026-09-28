/**
 * The files an acceptance test run is given, and what its agent is asked to do.
 *
 * A test run's workspace holds, beside the activity's own inputs:
 *   acceptance-input.json   what to test and where: the signed play link, the viewport, the
 *                           criteria, the test browser's executable and the scene ids
 *   activity-harness.mjs    Penguin's harness API over `playwright-core`, the only thing the
 *                           agent's tests may use to drive the player
 *   run-acceptance.mjs      starts the test browser, runs the agent's `acceptance.test.mjs`
 *                           criterion by criterion, and writes `acceptance-results.json`
 *   package.json            pins `playwright-core` to the version this server drives
 *
 * The harness talks to the player through the inspection bridge a WAF module exposes
 * (`window.Activity.Inspection`: its current state, the states and media it went through, and
 * its tap targets), and taps, holds and drags like a learner would. Neither script prints the
 * environment or any request's headers.
 *
 * Raise `HARNESS_VERSION` whenever the harness API changes, so tests written against an older
 * one are written again rather than reused.
 */

export const HARNESS_VERSION = 1;

export const ACCEPTANCE_INPUT_FILE = "acceptance-input.json";
export const ACCEPTANCE_HARNESS_FILE = "activity-harness.mjs";
export const ACCEPTANCE_RUNNER_FILE = "run-acceptance.mjs";
export const ACCEPTANCE_TEST_FILE = "acceptance.test.mjs";
export const ACCEPTANCE_RESULTS_FILE = "acceptance-results.json";
/** Where a run's report goes, inside its workspace. */
export const ACCEPTANCE_REPORT_DIR = "reports";
export const ACCEPTANCE_REPORT_FILE = "test.json";
/** The most bytes an earlier run's test file may have to be reused. */
export const TEST_FILE_MAX_BYTES = 256 * 1024;

export const activityHarnessSource = `// Penguin's acceptance harness: drive the played activity in the test browser.
// Tests import only from this file. Do not edit it.
import fs from "node:fs";

const input = JSON.parse(
  fs.readFileSync(new URL("./${ACCEPTANCE_INPUT_FILE}", import.meta.url), "utf8"),
);

/** The acceptance criteria, in the specification's order. Pass each one to criterion() as it is. */
export const criteria = Object.freeze([...input.criteria]);
/** The specification's scene ids, in order. */
export const scenes = Object.freeze([...input.scenes]);

export const DEFAULT_TIMEOUT_MS = 15000;

const registered = [];
const open = new Set();
let browser = null;

/**
 * Registers the check for one acceptance criterion: criterion(text, fn) or
 * criterion(text, testName, fn). \`text\` is the criterion exactly as listed in \`criteria\`.
 * The check passes when fn resolves and fails with the message of what it throws.
 */
export function criterion(text, testName, fn) {
  if (typeof testName === "function") {
    fn = testName;
    testName = text;
  }
  if (typeof text !== "string" || typeof fn !== "function")
    throw new TypeError("Use criterion(text, fn) or criterion(text, testName, fn).");
  registered.push({ criterion: text, testName: String(testName), fn });
}

class Skipped extends Error {}

/** Ends a check as skipped: only for a criterion the player cannot show, such as art style. */
export function skip(reason) {
  throw new Skipped(String(reason || "Skipped."));
}

/** Fails the check with \`message\` unless \`condition\` holds. */
export function expect(condition, message) {
  if (!condition) throw new Error(message || "Expectation failed.");
}

const READY =
  "!!(window.Activity && window.Activity.Inspection && typeof window.Activity.Inspection.getSnapshot === 'function')";

function selectorFor(id) {
  const quoted = JSON.stringify(String(id));
  return "[data-interactable-id=" + quoted + "], [id=" + quoted + "]";
}

class Activity {
  constructor(page, context) {
    /** The Playwright page, for reading what is on screen; drive the player with the methods below. */
    this.page = page;
    this.context = context;
  }

  async ready(timeoutMs = DEFAULT_TIMEOUT_MS) {
    try {
      await this.page.waitForFunction(READY, undefined, { timeout: timeoutMs });
    } catch {
      throw new Error("The activity did not expose window.Activity.Inspection; it may not have started.");
    }
    const pause = this.page.locator("#pauseOverlay").first();
    if (await pause.isVisible().catch(() => false)) {
      await pause.click();
      await pause.waitFor({ state: "hidden", timeout: timeoutMs });
    }
  }

  /** The current state: { state, sceneId, phase, index, interactive }. */
  state() {
    return this.page.evaluate(() => window.Activity.Inspection.getSnapshot());
  }

  /** Every state entered so far, oldest first: [{ state, sceneId, phase, index, details }]. */
  history() {
    return this.page.evaluate(() => window.Activity.Inspection.getHistory());
  }

  /** Every media event so far, oldest first: [{ kind, key, status, state, index }]. */
  mediaHistory() {
    return this.page.evaluate(() => window.Activity.Inspection.getMediaHistory());
  }

  /** Waits until the activity enters state \`name\` (after state index \`afterIndex\`); the state record. */
  waitForState(name, { timeoutMs = DEFAULT_TIMEOUT_MS, afterIndex = -1 } = {}) {
    return this.page.evaluate(
      (request) =>
        window.Activity.Inspection.waitForState(request.name, {
          timeoutMs: request.timeoutMs,
          afterIndex: request.afterIndex,
        }),
      { name, timeoutMs, afterIndex },
    );
  }

  /**
   * Waits until media \`key\` reaches \`status\` (started, completed, interrupted, failed or
   * unavailable; completed by default) — audio unless \`kind\` says video.
   */
  waitForMedia(
    key,
    { kind = "audio", status = "completed", timeoutMs = DEFAULT_TIMEOUT_MS, afterIndex = -1 } = {},
  ) {
    return this.page.evaluate(
      (request) =>
        window.Activity.Inspection.waitForMedia(request.kind, request.key, request.status, {
          timeoutMs: request.timeoutMs,
          afterIndex: request.afterIndex,
        }),
      { key, kind, status, timeoutMs, afterIndex },
    );
  }

  /** What can be tapped now: [{ id, inputType, event?, description? }]. */
  interactables() {
    return this.page.evaluate(() => {
      const inspection = window.Activity && window.Activity.Inspection;
      try {
        return (inspection && inspection.getCurrentState().interactables) || [];
      } catch {
        return [];
      }
    });
  }

  /** Waits until tap target \`id\` is armed. */
  async waitForInteractable(id, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = (await this.interactables()).find((entry) => entry && entry.id === id);
      if (found) return found;
      if (Date.now() >= deadline) throw new Error("Tap target " + JSON.stringify(id) + " never became available.");
      await this.page.waitForTimeout(100);
    }
  }

  async centre(id) {
    await this.waitForInteractable(id);
    const target = this.page.locator(selectorFor(id)).first();
    await target.waitFor({ state: "visible" });
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error("Tap target " + JSON.stringify(id) + " has no visible box.");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Taps target \`id\` once it is armed. */
  async tap(id) {
    const { x, y } = await this.centre(id);
    await this.page.mouse.click(x, y);
  }

  /** Presses and holds target \`id\` for \`ms\` milliseconds. */
  async hold(id, ms = 1200) {
    const { x, y } = await this.centre(id);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    try {
      await this.page.waitForTimeout(ms);
    } finally {
      await this.page.mouse.up();
    }
  }

  /** Drags target \`id\` onto target \`toId\`. */
  async drag(id, toId) {
    const from = await this.centre(id);
    const to = await this.centre(toId);
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps: 12 });
    await this.page.mouse.up();
  }

  async close() {
    open.delete(this);
    await this.context.close().catch(() => {});
  }
}

/** Opens the played activity, on \`scene\` when given, and waits for it to start. */
export async function openActivity({ url = input.playUrl, viewport = input.viewport, scene, language } = {}) {
  if (!browser) throw new Error("The test browser is not running. Run the tests with node ${ACCEPTANCE_RUNNER_FILE}.");
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  const activity = new Activity(page, context);
  open.add(activity);
  const target = new URL(url);
  if (scene) target.searchParams.set("scene", scene);
  if (language) target.searchParams.set("language", language);
  await page.goto(target.toString(), { waitUntil: "load" });
  await activity.ready();
  return activity;
}

// For run-acceptance.mjs only.
export const runner = {
  attach(value) {
    browser = value;
  },
  registered: () => [...registered],
  isSkip: (error) => error instanceof Skipped,
  async closeAll() {
    for (const activity of [...open]) await activity.close();
  },
};
`;

export const runAcceptanceSource = `// Runs acceptance.test.mjs against the played activity and writes ${ACCEPTANCE_RESULTS_FILE}.
// Do not edit it.
import fs from "node:fs";
import { chromium } from "playwright-core";
import { runner } from "./activity-harness.mjs";

const input = JSON.parse(
  fs.readFileSync(new URL("./${ACCEPTANCE_INPUT_FILE}", import.meta.url), "utf8"),
);
const CHECK_TIMEOUT_MS = 120000;

function withTimeout(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("The check took longer than two minutes.")), CHECK_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

// What went wrong, without the stack's "at ..." lines.
const message = (error) =>
  (error && error.message ? error.message : String(error))
    .split("\\n")
    .filter((line) => !/^\\s+at /.test(line))
    .join("\\n")
    .trim();

let browser;
try {
  browser = await chromium.launch({ executablePath: input.browserPath, headless: true });
  runner.attach(browser);
  await import("./${ACCEPTANCE_TEST_FILE}");
} catch (error) {
  console.error("The acceptance tests could not run: " + message(error));
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
}

const results = [];
for (const entry of runner.registered()) {
  const started = performance.now();
  let status = "passed";
  let error = null;
  try {
    await withTimeout(Promise.resolve().then(() => entry.fn()));
  } catch (caught) {
    status = runner.isSkip(caught) ? "skipped" : "failed";
    error = message(caught).slice(0, 2000);
  } finally {
    await runner.closeAll();
  }
  const durationMs = Math.max(0, Math.round(performance.now() - started));
  results.push({ criterion: entry.criterion, testName: entry.testName, status, durationMs, error });
  console.log(status.toUpperCase() + "  " + entry.testName + (error ? "  - " + error : ""));
}
await browser.close().catch(() => {});
fs.writeFileSync(
  new URL("./${ACCEPTANCE_RESULTS_FILE}", import.meta.url),
  JSON.stringify({ results }, null, 2),
);
const covered = new Set(results.map((result) => result.criterion));
const missing = input.criteria.filter((text) => !covered.has(text));
console.log(results.length + " checks ran; " + missing.length + " criteria have no check.");
`;

const HARNESS_API = `The harness (${ACCEPTANCE_HARNESS_FILE}) exports:
- criteria: the acceptance criteria, in order; scenes: the specification's scene ids.
- criterion(text, testName, fn): registers the check for one criterion; text must be the criterion exactly as it appears in criteria. The check passes when fn resolves and fails with the message of the Error it throws.
- openActivity({ scene?, language? }): opens the played activity (on a scene when given) and waits until it starts; returns activity.
- activity.state() -> { state, sceneId, phase, index, interactive }; activity.history() and activity.mediaHistory() list the states and media events so far.
- activity.waitForState(name, { timeoutMs?, afterIndex? }); activity.waitForMedia(key, { kind?: "audio" | "video", status?: "started" | "completed" | "interrupted" | "failed" | "unavailable", timeoutMs?, afterIndex? }).
- activity.interactables() -> [{ id, inputType, description? }]; activity.tap(id), activity.hold(id, ms), activity.drag(id, toId) act on those tap targets like a learner.
- activity.page is the Playwright page, for reading what is on screen.
- expect(condition, message) fails the check with message; skip(reason) marks a criterion that cannot be checked by playing the activity (for example the style of the art) as skipped.`;

/** What a test run's agent is asked to do when no earlier tests fit. */
export const acceptancePrompt = `Write and run the acceptance tests for this activity. Work in this workspace.
${ACCEPTANCE_INPUT_FILE} lists the acceptance criteria (criteria), the scenes and the viewport. activity-spec.json is the specification and description.md the activity script; read them to learn the states, tap targets and media each criterion is about.
${HARNESS_API}
Write ${ACCEPTANCE_TEST_FILE} as an ES module that imports only from ./${ACCEPTANCE_HARNESS_FILE}. Register exactly one criterion() for each entry of criteria, in order, passing criteria[i] as its text. Each check opens the activity with openActivity(), drives it only through the harness and throws an Error saying what it expected and what it saw when the criterion is not met. Do not use fixed waits as assertions or make network requests.
Then run npm install --ignore-scripts (package.json pins the playwright-core this server uses) and node ${ACCEPTANCE_RUNNER_FILE}, with Harness's normal exec_command approval. The runner writes ${ACCEPTANCE_RESULTS_FILE}. If it says the tests could not run, fix ${ACCEPTANCE_TEST_FILE} and run it again. A failing criterion is a result to report, not a test to change: never weaken a check to make it pass, and never write ${ACCEPTANCE_RESULTS_FILE} yourself.
Do not edit ${ACCEPTANCE_INPUT_FILE}, ${ACCEPTANCE_HARNESS_FILE}, ${ACCEPTANCE_RUNNER_FILE}, package.json or the activity files. Do not print environment variables or credentials. Do not delegate or write outside this workspace.
Finish only after node ${ACCEPTANCE_RUNNER_FILE} has written ${ACCEPTANCE_RESULTS_FILE}.`;

/** What a test run's agent is asked to do when an earlier run's tests fit these criteria. */
export const acceptanceReusePrompt = `Run the acceptance tests for this activity. Work in this workspace.
${ACCEPTANCE_TEST_FILE} was written by an earlier run for these same acceptance criteria and this same specification. Do not rewrite it.
Run npm install --ignore-scripts (package.json pins the playwright-core this server uses) and node ${ACCEPTANCE_RUNNER_FILE}, with Harness's normal exec_command approval. The runner writes ${ACCEPTANCE_RESULTS_FILE}. Only if it says the tests could not run at all, fix ${ACCEPTANCE_TEST_FILE} using the harness described below and run it again.
${HARNESS_API}
A failing criterion is a result to report, not a test to change. Never write ${ACCEPTANCE_RESULTS_FILE} yourself. Do not edit ${ACCEPTANCE_INPUT_FILE}, ${ACCEPTANCE_HARNESS_FILE}, ${ACCEPTANCE_RUNNER_FILE}, package.json or the activity files. Do not print environment variables or credentials. Do not delegate or write outside this workspace.
Finish only after node ${ACCEPTANCE_RUNNER_FILE} has written ${ACCEPTANCE_RESULTS_FILE}.`;
