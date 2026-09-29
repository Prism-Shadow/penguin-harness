/**
 * The gallery's words for what the app also prints are the app's words.
 *
 * A stand-in imitates a real component, so a label it shares with the app — a nav row, a composer
 * trigger, a page title, a dock tab — must read exactly as the app's dictionaries have it, in both
 * languages. The package cannot import the web app (the dependency points the other way), so this
 * reads the dictionaries' source: `packages/web/src/lib/strings.ts` (the `zh` object) and
 * `strings-en.ts` (the `en` object), parsed with the TypeScript compiler, and walks each to the
 * key the app prints the label from. A function-valued entry is rendered with the same arguments
 * the fixture's function is called with.
 *
 * The pairs are what the gallery's stand-ins actually show. Words the gallery prints that the app
 * has no counterpart for (a proposed surface, a planned component) are not listed; neither are
 * fixture entries whose app key names a different concept.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { en, zh } from "../src/fixtures";
import type { AppCopy } from "../src/fixtures";
import { WEB_DIR } from "./helpers/paths";

/** A fixture path in `AppCopy`, the app's dictionary path, and the arguments of a template. */
type Pair = readonly [fixture: string, web: string, args?: readonly (string | number)[]];

const PAIRS: readonly Pair[] = [
  // The sidebar and the collapsed rail.
  ["nav.newChat", "chat.newSessionMenu"],
  ["nav.agents", "nav.agents"],
  ["nav.plugins", "nav.plugins"],
  ["nav.models", "nav.models"],
  ["nav.usage", "nav.usage"],
  ["nav.benchmark", "nav.benchmark"],
  ["nav.traces", "nav.traces"],
  ["nav.sessions", "chat.sessionList"],
  ["nav.collapseSidebar", "nav.collapseSidebar"],
  ["nav.expandSidebar", "nav.expandSidebar"],
  ["nav.collapseGroup", "nav.collapseGroup"],
  ["nav.expandGroup", "nav.expandGroup"],
  ["nav.lastConversation", "nav.lastConversation"],
  ["nav.userSettings", "nav.userSettings"],
  ["nav.search", "chat.searchSessions"],
  ["nav.filterSessions", "chat.listSettings"],
  ["nav.newFolder", "chat.newWorkspaceEntity"],
  ["nav.tempWorkspaces", "chat.tempWorkspaces"],
  ["nav.pin", "chat.pinSession"],
  ["auth.admin", "auth.admin"],
  // The composer and the transcript.
  ["chat.plusMenu", "chat.plusMenu"],
  ["chat.approvalMode", "chat.approvalMode"],
  ["chat.approvalModes.allow-all", "chat.approvalModeNames.allow-all"],
  ["chat.approvalModes.read-only", "chat.approvalModeNames.read-only"],
  ["chat.approvalModes.deny-all", "chat.approvalModeNames.deny-all"],
  ["chat.approvalModes.always-ask", "chat.approvalModeNames.always-ask"],
  ["chat.thinkingLevel", "chat.thinkingLevel"],
  ["chat.thinkingLevels.low", "chat.thinkingLevelNames.low"],
  ["chat.thinkingLevels.medium", "chat.thinkingLevelNames.medium"],
  ["chat.thinkingLevels.high", "chat.thinkingLevelNames.high"],
  ["chat.model", "chat.model"],
  ["chat.skills", "chat.skillsSelect"],
  ["chat.slashHint", "chat.slashHint"],
  ["chat.inputPlaceholder", "chat.inputPlaceholder"],
  ["chat.send", "chat.send"],
  ["chat.steerSend", "chat.steerSend"],
  ["chat.stop", "chat.stop"],
  ["chat.contextUsage", "chat.contextUsage"],
  ["chat.copyReply", "chat.copyReply"],
  ["chat.fork", "chat.forkSession"],
  ["chat.statTokens", "chat.statTokens"],
  ["chat.runStates.running", "chat.statusRunning"],
  ["chat.running", "chat.workRunning"],
  ["chat.done", "chat.workDone"],
  ["chat.steps", "chat.workGroupSteps", [2]],
  ["chat.thinking", "chat.thinking"],
  ["chat.approvalWaiting", "chat.approvalWaiting"],
  ["chat.approve", "chat.approve"],
  ["chat.deny", "chat.deny"],
  ["chat.toolAliases.read_file", "chat.toolAliases.read_file"],
  ["chat.toolAliases.edit_file", "chat.toolAliases.edit_file"],
  ["chat.toolAliases.exec_command", "chat.toolAliases.exec_command"],
  ["chat.toolAliases.run_subagent", "chat.toolAliases.run_subagent"],
  ["traces.inputTokens", "chat.statInput"],
  ["traces.outputTokens", "chat.statOutput"],
  ["traces.elapsed", "chat.statElapsed"],
  ["traces.outputTps", "chat.statTps"],
  ["traces.cost", "common.cost"],
  // The dock, its tabs and the launcher ball.
  ["dock.agentsPanel", "chat.openAgents"],
  ["dock.filesPanel", "chat.workspacePanel"],
  ["dock.topology", "subagentPanel.topologyLabel"],
  ["dock.nodeRunning", "subagentPanel.nodeRunning"],
  ["dock.nodeDone", "subagentPanel.nodeDone"],
  ["dock.openAsSession", "subagentPanel.openAsSession"],
  ["dock.newPanel", "dock.addTab"],
  ["dock.moveToRight", "dock.moveToRight"],
  ["dock.moveToBottom", "dock.moveToBottom"],
  ["dock.bottomDock", "dock.bottomDock"],
  ["dock.rightDock", "dock.rightDock"],
  ["dock.closeTab", "dock.closeTab"],
  ["dock.hideDock", "dock.hideDock"],
  ["dock.launcher", "dock.launcherCaption"],
  // The settings dialog.
  ["settings.title", "settings.title"],
  ["settings.launcher", "settings.launcher"],
  ["settings.launcherInfo", "settings.launcherInfo"],
  ["settings.toolAliases", "settings.toolAliases"],
  ["settings.toolAliasesInfo", "settings.toolAliasesInfo"],
  // The Plugins page.
  ["plugins.title", "plugins.pageTitle"],
  ["plugins.info", "plugins.pageDesc"],
  ["plugins.search", "plugins.searchPlaceholder"],
  ["plugins.install", "plugins.install"],
  ["plugins.uninstall", "plugins.uninstall"],
  ["plugins.installedSection", "plugins.installedSection", [13]],
  ["plugins.availableSection", "plugins.availableSection", [4]],
  ["plugins.running", "plugins.stateActive"],
  ["plugins.notInstalled", "plugins.notInstalled"],
  ["plugins.filters.categories", "plugins.filterCategories"],
  ["plugins.filters.kind", "plugins.filterKind"],
  ["plugins.filters.state", "plugins.filterState"],
  ["plugins.kinds.skills", "plugins.kindLabel.skills"],
  ["plugins.kinds.hooks", "plugins.kindLabel.hooks"],
  ["plugins.kinds.modules", "plugins.kindLabel.modules"],
  ["plugins.states.installed", "plugins.stateLabel.installed"],
  ["plugins.states.available", "plugins.stateLabel.available"],
  // The Agents page and its create paths.
  ["agents.title", "agent.listTitle"],
  ["agents.search", "agent.searchPlaceholder"],
  ["agents.newAgent", "agent.createTitle"],
  ["agents.createWithAi", "aiCreate.withAi"],
  ["agents.createManually", "aiCreate.manual"],
  ["agents.aiCreateTitle", "agent.aiCreateTitle"],
  ["agents.delete", "agent.deleteAgent"],
  ["agents.builtinUndeletable", "agent.builtinUndeletable"],
  ["agents.empty.title", "agent.firstAgentTitle"],
  ["agents.empty.body", "agent.firstAgentDesc"],
  ["common.cancel", "common.cancel"],
  ["common.settings", "common.settings"],
  ["common.confirm", "common.confirm"],
  ["common.create", "common.create"],
  // The Models page.
  ["models.title", "models.title"],
  ["models.search", "models.searchPlaceholder"],
  ["models.setDefault", "models.setDefault"],
  ["models.providerDocs", "models.homepage"],
  // The Files panel.
  ["files.search", "files.searchPlaceholder"],
  ["files.upload", "files.upload"],
  ["files.copyPath", "files.copyPath"],
  ["files.empty.title", "files.selectFile"],
  ["files.dropTitle", "files.dropToUpload", ["src"]],
  // Company mode.
  ["company.ticketStatus.proposed", "company.tickets.columns.proposed"],
  ["company.ticketStatus.in_progress", "company.tickets.columns.in_progress"],
  ["company.ticketStatus.review", "company.tickets.columns.review"],
  ["company.ticketStatus.done", "company.tickets.columns.done"],
  ["company.ticketStatus.rejected", "company.tickets.columns.rejected"],
  ["company.blocked", "company.tickets.blocked"],
  ["company.outcomes.fired", "company.calendarOutcomes.fired"],
  ["company.outcomes.queued", "company.calendarOutcomes.queued"],
  ["company.outcomes.paused", "company.calendarOutcomes.paused"],
  ["company.outcomes.missed", "company.calendarOutcomes.missed"],
  ["company.outcomes.error", "company.calendarOutcomes.error"],
  ["company.upcoming", "company.overview.upcoming"],
  ["company.employeeStates.running", "company.employeeStates.running"],
  ["company.employeeStates.idle", "company.employeeStates.idle"],
  ["company.employeeStates.paused", "company.employeeStates.paused"],
  ["company.noBudget", "company.noBudget"],
  ["company.members", "company.channels.memberCount", [3]],
  ["company.messagePlaceholder", "company.channels.placeholder"],
  ["company.allHands", "company.channels.allHands"],
];

/** A dictionary entry: a string, or a function rendered with the pair's arguments. */
type Entry = string | ((args: readonly (string | number)[]) => string | null);

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)
    ? unwrap(node.expression)
    : node;

const keyOf = (name: ts.PropertyName): string | null =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;

/**
 * A function entry as a renderer: its own source, types stripped, evaluated on its own. The
 * dictionaries' functions are pure templates of their parameters (plurals included), so this is
 * the function the app calls; one that reaches outside itself throws, and reads as `null`, which
 * the pair then reports rather than guesses at.
 */
function rendererOf(fn: ts.ArrowFunction, source: ts.SourceFile): Entry {
  const js = ts.transpile(`(${fn.getText(source)})`, { target: ts.ScriptTarget.ES2022 });
  return (args) => {
    try {
      const render = (0, eval)(js) as (...a: readonly (string | number)[]) => unknown;
      const out = render(...args);
      return typeof out === "string" ? out : null;
    } catch {
      return null;
    }
  };
}

/** Every leaf of a dictionary object by its dotted path. */
function readDictionary(file: string, name: string): Map<string, Entry> {
  const text = readFileSync(join(WEB_DIR, "src", "lib", file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const leaves = new Map<string, Entry>();
  const walk = (node: ts.ObjectLiteralExpression, prefix: string) => {
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = keyOf(property.name);
      if (key === null) continue;
      const path = prefix === "" ? key : `${prefix}.${key}`;
      const value = unwrap(property.initializer);
      if (ts.isObjectLiteralExpression(value)) walk(value, path);
      else if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
        leaves.set(path, value.text);
      else if (ts.isArrowFunction(value)) leaves.set(path, rendererOf(value, source));
    }
  };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer && unwrap(declaration.initializer);
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && init) {
        if (ts.isObjectLiteralExpression(init)) walk(init, "");
      }
    }
  }
  return leaves;
}

/** A fixture value by its path, called with the pair's arguments when it is a function. */
function fixtureValue(copy: AppCopy, path: string, args: readonly (string | number)[]): unknown {
  let value: unknown = copy;
  for (const key of path.split(".")) {
    value =
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return typeof value === "function" ? (value as (...a: unknown[]) => unknown)(...args) : value;
}

const DICTIONARIES = {
  zh: { copy: zh.copy, web: readDictionary("strings.ts", "zh") },
  en: { copy: en.copy, web: readDictionary("strings-en.ts", "en") },
} as const;

describe("the fixtures' copy", () => {
  it("reads the app's two dictionaries", () => {
    // A parse that found nothing would pass every pair vacuously wrong; say so first.
    expect(DICTIONARIES.zh.web.size).toBeGreaterThan(500);
    expect(DICTIONARIES.en.web.size).toBeGreaterThan(500);
  });

  it("names what the app also prints exactly as the app does, in both languages", () => {
    const drift: string[] = [];
    for (const [lang, { copy, web }] of Object.entries(DICTIONARIES)) {
      for (const [fixturePath, webPath, args = []] of PAIRS) {
        const entry = web.get(webPath);
        const expected = typeof entry === "function" ? entry(args) : entry;
        const actual = fixtureValue(copy, fixturePath, args);
        if (expected === undefined || expected === null) {
          drift.push(`${lang} ${webPath}: no string the test can read in the app's dictionary`);
        } else if (actual !== expected) {
          const ours = JSON.stringify(actual);
          const theirs = JSON.stringify(expected);
          drift.push(`${lang} copy.${fixturePath} = ${ours}, the app's ${webPath} = ${theirs}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });
});
