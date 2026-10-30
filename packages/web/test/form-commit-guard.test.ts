/**
 * Guard: the settings commit model — a switch commits when flipped, a typed form commits on
 * Save, and leaving a form with unsaved edits asks first — holds in the source.
 *
 * The JSX is parsed (TypeScript's parser, no types) rather than remembered, in three checks:
 *
 * 1. **A typed control never commits from its own handler.** On an `Input`, `Textarea`,
 *    `PasswordInput` or `TagInput` under `features/` (and the project dialogs), an `onBlur` fails
 *    outright, and an `onChange` whose handler — the inline arrow, or the function of that name
 *    declared in the module — calls `api.*` or a function named `save*`, `persist*`, `write*`,
 *    `submit*`, `put*`, `post*`, `send*`, `commit*` or `onSave*` fails. An `onBlur` on any other
 *    element (a raw `<input>`, the box around an inline editor) fails when its handler calls one
 *    of those. Typing is a draft; only Save writes it.
 * 2. **A Save form registers with the unsaved-changes registry.** A module there that offers
 *    `S.common.save` or `S.common.create` also calls `useFormDraft` or `useUnsavedChanges`, so
 *    every way of leaving it can find it dirty. Every module in `FORM_MODULES` must still exist
 *    and still take part (those two, or `useGuardedClose` for a dialog shell whose pages hold
 *    the forms).
 * 3. **A dialog that holds a form closes through the guard.** In a `FORM_MODULES` module, every
 *    `<Modal>` and `<PagedDialog>` gets an `onClose` declared from `useGuardedClose(` — Esc, the
 *    ×, the scrim and Cancel all arrive there — unless `EXCUSED_DIALOGS` names its component with
 *    a reason.
 * 4. **A page's save holds the dialog it sits in.** The Settings and Project settings dialogs
 *    cannot see their pages' saves, so a component that registers a form under one of their
 *    scopes (`SHELL_SCOPES`, named in its `useFormDraft` / `useUnsavedChanges` options) and offers
 *    `S.common.save` also calls `useSaving(…, <that scope>)`.
 *
 * Adding a module to `FORM_MODULES` is how a new settings form joins check 3.
 *
 * What the parser cannot follow is on the reviewer: a handler built in a variable, a Save
 * button that is a component of its own, a dialog in a module outside `FORM_MODULES`, a scope
 * passed down as a prop.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { expectEveryRootScanned, scanSources, type SourceFile } from "./helpers/roots";

const SCAN = scanSources([".tsx", ".ts"]);

/** Modules under packages/web/src whose forms follow the model; check 3 runs on each. */
const FORM_MODULES: readonly string[] = [
  "components/account/change-password-dialog.tsx",
  "components/layout/project-dialogs.tsx",
  "features/admin/admin-users-page.tsx",
  "features/agents/agent-settings-page.tsx",
  "features/agents/api-tab.tsx",
  "features/agents/create-agent-dialog.tsx",
  "features/agents/hooks-tab.tsx",
  "features/agents/mcp-server-dialog.tsx",
  "features/agents/memory-tab.tsx",
  "features/agents/prompt-injection-controls.tsx",
  "features/agents/skills-tab.tsx",
  "features/agents/vault-add-dialog.tsx",
  "features/benchmark/benchmark-import-modal.tsx",
  "features/benchmark/create-benchmark-modal.tsx",
  "features/builtin-browser/homepage-dialog.tsx",
  "features/chat/shortcuts-folder.tsx",
  "features/company/calendar-page.tsx",
  "features/company/channel-dialogs.tsx",
  "features/company/employee-dialogs.tsx",
  "features/company/finance-page.tsx",
  "features/company/org-dialogs.tsx",
  "features/company/ticket-dialog.tsx",
  "features/company/tickets-page.tsx",
  "features/machines/add-machine-dialog.tsx",
  "features/machines/ssh-host-dialog.tsx",
  "features/messaging/messaging-binding-modal.tsx",
  "features/messaging/messaging-panel.tsx",
  "features/models/models-page.tsx",
  "features/models/provider-settings-dialog.tsx",
  "features/plugins/plugin-import-modal.tsx",
  "features/plugins/plugin-mcp.tsx",
  "features/schedules/schedule-form-modal.tsx",
  "features/settings/plugin-config-card.tsx",
  "features/settings/profile-section.tsx",
  "features/settings/proxy-section.tsx",
  "features/settings/settings-dialog.tsx",
  "features/settings/uploads-section.tsx",
];

/** [module, component, why its dialog closes without the guard]. */
const EXCUSED_DIALOGS: ReadonlyArray<readonly [string, string, string]> = [
  [
    "features/admin/admin-users-page.tsx",
    "DeleteUserDialog",
    "a two-step confirmation with nothing typed",
  ],
  [
    "features/agents/memory-tab.tsx",
    "MemoryTab",
    "its dialogs build a chat prompt (edit, add) or pick an import mode; none of them writes config",
  ],
  [
    "features/company/org-dialogs.tsx",
    "CreateOrganizationDialog",
    "its draft is kept in the browser on every keystroke and restored on reopen (spec 06), so a close loses nothing",
  ],
  ["features/models/models-page.tsx", "ModelsPage", "the speed-test confirmation: nothing typed"],
  [
    "features/models/models-page.tsx",
    "ModelOAuthDialog",
    "an authorization flow: closing abandons the flow, and its one code field is submitted by its own button",
  ],
];

/** Modules outside the model, each with the reason. */
const EXCUSED_FILES: ReadonlyArray<readonly [string, string]> = [
  [
    "features/chat/context-gauge.tsx",
    "the compaction threshold is a confirmation whose confirm is the Save; nothing is left behind",
  ],
  [
    "features/chat/workspace-browser.tsx",
    "the Workspace file editor keeps its own guard and its file-naming discard prompt",
  ],
];

const TYPED = new Set(["Input", "Textarea", "PasswordInput", "TagInput"]);
const COMMITS = /^(?:save|persist|write|submit|put|post|send|commit|onSave|onSubmit|onCommit)/;

/** The files check 1 and 2 read: everything under features/, and the project dialogs. */
const inReach = (file: SourceFile) =>
  file.root === "web" &&
  file.rel.endsWith(".tsx") &&
  (file.rel.startsWith("features/") || file.rel === "components/layout/project-dialogs.tsx");

/** Each file is parsed once, however many checks read it. */
const parsed = new WeakMap<SourceFile, ts.SourceFile>();
const parse = (file: SourceFile): ts.SourceFile => {
  let sf = parsed.get(file);
  if (sf === undefined) {
    sf = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    parsed.set(file, sf);
  }
  return sf;
};

/** Whether the text names a Save the checks read (`S.common.save`), or a Create too. */
const mentionsSave = (file: SourceFile, create = false) =>
  file.text.includes("S.common.save") || (create && file.text.includes("S.common.create"));

const lineOf = (sf: ts.SourceFile, node: ts.Node) =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

function visit(node: ts.Node, fn: (node: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

const jsxTag = (node: ts.Node): string | null =>
  ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node) ? node.tagName.getText() : null;

function attribute(node: ts.Node, name: string): ts.JsxAttribute | undefined {
  const attrs = (node as ts.JsxSelfClosingElement | ts.JsxOpeningElement).attributes.properties;
  return attrs.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name);
}

const attributeValue = (attr: ts.JsxAttribute | undefined): ts.Expression | undefined =>
  attr?.initializer !== undefined && ts.isJsxExpression(attr.initializer)
    ? attr.initializer.expression
    : undefined;

/** The body a handler expression runs: an inline function's, or the named module-level one's. */
function handlerBody(sf: ts.SourceFile, expr: ts.Expression): ts.Node | undefined {
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return expr.body;
  if (!ts.isIdentifier(expr)) return undefined;
  let found: ts.Node | undefined;
  visit(sf, (node) => {
    if (found !== undefined) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === expr.text) found = node.body;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === expr.text &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer.body;
    }
  });
  return found;
}

/** The calls in `body` that commit: `api.*` or a save-like name. */
function commitCalls(body: ts.Node): string[] {
  const calls: string[] = [];
  visit(body, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression.getText();
    if (callee.startsWith("api.") || COMMITS.test(callee)) calls.push(callee);
  });
  return calls;
}

/** The commits the named handler attribute of `node` makes. */
function commitsFrom(sf: ts.SourceFile, node: ts.Node, name: string): string[] {
  const handler = attributeValue(attribute(node, name));
  const body = handler === undefined ? undefined : handlerBody(sf, handler);
  return body === undefined ? [] : commitCalls(body);
}

/** Check 1: "file:line what" for every typed control that commits from its own handler. */
function handlerCommits(file: SourceFile): string[] {
  // Every finding is an onBlur or an onChange: a file that spells neither has none.
  if (!file.text.includes("onBlur") && !file.text.includes("onChange")) return [];
  const sf = parse(file);
  const found: string[] = [];
  visit(sf, (node) => {
    const tag = jsxTag(node);
    if (tag === null) return;
    const at = `${file.rel}:${lineOf(sf, node)} <${tag}`;
    if (TYPED.has(tag)) {
      if (attribute(node, "onBlur") !== undefined) found.push(`${at} onBlur>`);
      for (const call of commitsFrom(sf, node, "onChange")) {
        found.push(`${at} onChange> calls ${call}`);
      }
      return;
    }
    for (const call of commitsFrom(sf, node, "onBlur")) found.push(`${at} onBlur> calls ${call}`);
  });
  return found;
}

const callsAny = (sf: ts.SourceFile, names: ReadonlySet<string>): boolean => {
  let hit = false;
  visit(sf, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (names.has(node.expression.text)) hit = true;
    }
  });
  return hit;
};

const REGISTERS = new Set(["useFormDraft", "useUnsavedChanges"]);
const TAKES_PART = new Set(["useFormDraft", "useUnsavedChanges", "useGuardedClose"]);

/** The scopes of the dialogs whose pages save on their own: Settings, and Project settings. */
const SHELL_SCOPES = new Set(["SETTINGS_SCOPE", "PROJECT_SETTINGS_SCOPE"]);

/** Check 2's trigger: the module offers Save or Create. */
function offersSave(sf: ts.SourceFile): boolean {
  let hit = false;
  visit(sf, (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const text = node.getText();
      if (text === "S.common.save" || text === "S.common.create") hit = true;
    }
  });
  return hit;
}

/** Check 3: "file:line <Tag> in Component" for every dialog that closes around the guard. */
function unguardedDialogs(file: SourceFile): string[] {
  const sf = parse(file);
  const guarded = new Set<string>();
  visit(sf, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText() === "useGuardedClose"
    ) {
      guarded.add(node.name.text);
    }
  });
  const componentOf = (node: ts.Node): string => {
    for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
      if (ts.isFunctionDeclaration(n) && n.name !== undefined) return n.name.text;
    }
    return "(module)";
  };
  const found: string[] = [];
  visit(sf, (node) => {
    const tag = jsxTag(node);
    if (tag !== "Modal" && tag !== "PagedDialog") return;
    const component = componentOf(node);
    if (EXCUSED_DIALOGS.some(([f, c]) => f === file.rel && c === component)) return;
    const onClose = attributeValue(attribute(node, "onClose"));
    if (onClose !== undefined && ts.isIdentifier(onClose) && guarded.has(onClose.text)) return;
    found.push(`${file.rel}:${lineOf(sf, node)} <${tag}> in ${component}`);
  });
  return found;
}

/** The shell scope a registering call names in its options (`{ scope: SETTINGS_SCOPE }`). */
function shellScopeOf(call: ts.CallExpression): string | null {
  const options = call.arguments[1];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return null;
  for (const property of options.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText() === "scope" &&
      ts.isIdentifier(property.initializer) &&
      SHELL_SCOPES.has(property.initializer.text)
    ) {
      return property.initializer.text;
    }
  }
  return null;
}

/** Check 4: each component that saves a form in a shell scope, and whether it holds the close. */
function shellScopeSaves(file: SourceFile): Array<{ where: string; held: boolean }> {
  if (!mentionsSave(file)) return [];
  const sf = parse(file);
  const found: Array<{ where: string; held: boolean }> = [];
  visit(sf, (node) => {
    if (!ts.isFunctionDeclaration(node) || node.body === undefined) return;
    const scopes = new Set<string>();
    const holds = new Set<string>();
    let offers = false;
    visit(node.body, (inner) => {
      if (ts.isCallExpression(inner)) {
        const callee = inner.expression.getText();
        const scope = REGISTERS.has(callee) ? shellScopeOf(inner) : null;
        if (scope !== null) scopes.add(scope);
        const held = inner.arguments[1];
        if (callee === "useSaving" && held !== undefined && ts.isIdentifier(held)) {
          holds.add(held.text);
        }
      }
      if (ts.isPropertyAccessExpression(inner) && inner.getText() === "S.common.save") {
        offers = true;
      }
    });
    if (!offers) return;
    const at = `${file.rel}:${lineOf(sf, node)} ${node.name?.text ?? "(anonymous)"}`;
    for (const scope of scopes) found.push({ where: `${at} in ${scope}`, held: holds.has(scope) });
  });
  return found;
}

const webFile = (rel: string) => SCAN.files.find((f) => f.root === "web" && f.rel === rel);
const listed = (list: ReadonlyArray<readonly [string, ...unknown[]]>, rel: string) =>
  list.some(([f]) => f === rel);

describe("the settings commit model in the source", () => {
  it("scans every source root", () => {
    expectEveryRootScanned(SCAN);
  });

  it("never commits typed input from the control's own handler", () => {
    const found = SCAN.files
      .filter(inReach)
      .filter((f) => !listed(EXCUSED_FILES, f.rel))
      .flatMap(handlerCommits);
    expect(found).toEqual([]);
  });

  it("registers every form that offers Save or Create", () => {
    const found = SCAN.files
      .filter(inReach)
      .filter((f) => !listed(EXCUSED_FILES, f.rel))
      .filter((f) => {
        if (!mentionsSave(f, true)) return false;
        const sf = parse(f);
        return offersSave(sf) && !callsAny(sf, REGISTERS);
      })
      .map((f) => f.rel);
    expect(found).toEqual([]);
  });

  it("keeps FORM_MODULES current: each exists and takes part", () => {
    const stale = FORM_MODULES.filter((rel) => {
      const file = webFile(rel);
      return file === undefined || !callsAny(parse(file), TAKES_PART);
    });
    expect(stale).toEqual([]);
  });

  it("closes every dialog of a form module through the guard", () => {
    const found = FORM_MODULES.flatMap((rel) => {
      const file = webFile(rel);
      return file === undefined ? [] : unguardedDialogs(file);
    });
    expect(found).toEqual([]);
  });

  it("holds the Settings and Project settings dialogs' close while a page's Save is in flight", () => {
    const saves = SCAN.files.filter(inReach).flatMap(shellScopeSaves);
    // The pages exist and are found: a renamed scope must not turn this check into a no-op.
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.filter((s) => !s.held).map((s) => s.where)).toEqual([]);
  });
});
