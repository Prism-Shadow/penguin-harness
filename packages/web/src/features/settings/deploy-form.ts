/**
 * The Deploy settings page's form, apart from its view: which fields there are, in which
 * group, what the form holds for a saved view, and the update a save sends. Pure, so web
 * vitest can pin it without a DOM.
 *
 * Tokens are never in the view (only whether one is set), so the form holds what was typed
 * for them, empty meaning "keep the saved one", and a separate flag to forget a saved one.
 */
import type {
  DeploySettingsUpdate,
  DeploySettingsView,
  DeployTarget,
} from "@prismshadow/penguin-server/api";
import type { Strings } from "../../lib/strings";

export type DeployGroupKey = "qa" | "prod" | "jobs" | "repos" | "git" | "timeouts";

/** A plain field: its dotted path in the settings, and its label and hint keys. */
export interface DeployField {
  path: string;
  label: keyof DeployFieldWords;
  hint?: keyof DeployFieldWords;
  kind: "text" | "minutes";
}

type DeployFieldWords = Omit<
  Strings["settings"]["deploy"],
  "groups" | "testConnection" | "testOk" | "testFailed" | "targets" | "reasons"
>;

export interface DeployGroup {
  key: DeployGroupKey;
  /** The Jenkins whose token and connection test this group carries, if any. */
  target: DeployTarget | null;
  fields: DeployField[];
}

export const DEPLOY_GROUPS: readonly DeployGroup[] = [
  {
    key: "qa",
    target: "qa",
    fields: [
      { path: "qa.jenkinsUrl", label: "jenkinsUrl", hint: "jenkinsUrlHint", kind: "text" },
      { path: "qa.username", label: "username", kind: "text" },
      { path: "qa.tier", label: "tier", kind: "text" },
      { path: "qa.environment", label: "environment", kind: "text" },
      {
        path: "qa.frameworkVersion",
        label: "frameworkVersion",
        hint: "frameworkVersionHint",
        kind: "text",
      },
      {
        path: "qa.activityBaseUrl",
        label: "activityBaseUrl",
        hint: "activityBaseUrlHint",
        kind: "text",
      },
    ],
  },
  {
    key: "prod",
    target: "prod",
    fields: [
      { path: "prod.jenkinsUrl", label: "jenkinsUrl", hint: "jenkinsUrlHint", kind: "text" },
      { path: "prod.username", label: "username", kind: "text" },
      { path: "prod.tier", label: "tier", kind: "text" },
      { path: "prod.environment", label: "environment", kind: "text" },
      {
        path: "prod.frameworkVersion",
        label: "frameworkVersion",
        hint: "frameworkVersionHint",
        kind: "text",
      },
    ],
  },
  {
    key: "jobs",
    target: null,
    fields: [
      { path: "jobs.moduleBuild", label: "moduleBuildJob", hint: "jobHint", kind: "text" },
      { path: "jobs.activityDeploy", label: "activityDeployJob", hint: "jobHint", kind: "text" },
    ],
  },
  {
    key: "repos",
    target: null,
    fields: [
      {
        path: "repos.mediaPublicBase",
        label: "mediaPublicBase",
        hint: "mediaPublicBaseHint",
        kind: "text",
      },
    ],
  },
  {
    key: "git",
    target: null,
    fields: [
      { path: "git.userName", label: "gitUserName", kind: "text" },
      { path: "git.userEmail", label: "gitUserEmail", kind: "text" },
    ],
  },
  {
    key: "timeouts",
    target: null,
    fields: [
      {
        path: "timeouts.buildMinutes",
        label: "buildMinutes",
        hint: "minutesHint",
        kind: "minutes",
      },
      {
        path: "timeouts.deployMinutes",
        label: "deployMinutes",
        hint: "minutesHint",
        kind: "minutes",
      },
    ],
  },
];

/** The form's plain fields, by dotted path, as text. */
export type DeployFormValues = Record<string, string>;

/** What was typed for each token (empty keeps the saved one) and whether to forget it. */
export interface DeployTokenDrafts {
  qa: { value: string; forget: boolean };
  prod: { value: string; forget: boolean };
}

export function emptyTokenDrafts(): DeployTokenDrafts {
  return { qa: { value: "", forget: false }, prod: { value: "", forget: false } };
}

function read(view: DeploySettingsView, path: string): string {
  const [group, key] = path.split(".") as [keyof DeploySettingsView, string];
  const value = (view[group] as unknown as Record<string, unknown>)[key];
  return value === undefined || value === null ? "" : String(value);
}

/** The form for a saved view. */
export function formFromView(view: DeploySettingsView): DeployFormValues {
  const values: DeployFormValues = {};
  for (const group of DEPLOY_GROUPS)
    for (const field of group.fields) values[field.path] = read(view, field.path);
  return values;
}

/**
 * The update a save sends: only the fields that differ from the saved view, and the tokens
 * that were typed or forgotten. Null when nothing changed. A minutes field that is not a
 * whole number is sent as typed, so the server's refusal names it.
 */
export function deployUpdate(
  values: DeployFormValues,
  view: DeploySettingsView,
  tokens: DeployTokenDrafts,
): DeploySettingsUpdate | null {
  const update: Record<string, Record<string, unknown>> = {};
  const put = (group: string, key: string, value: unknown) => {
    (update[group] ??= {})[key] = value;
  };
  for (const group of DEPLOY_GROUPS)
    for (const field of group.fields) {
      const typed = (values[field.path] ?? "").trim();
      if (typed === read(view, field.path)) continue;
      const [groupKey, key] = field.path.split(".") as [string, string];
      const number = Number(typed);
      put(
        groupKey,
        key,
        field.kind === "minutes" && typed !== "" && Number.isFinite(number) ? number : typed,
      );
    }
  for (const target of ["qa", "prod"] as const) {
    const draft = tokens[target];
    if (draft.value.trim() !== "") put(target, "token", draft.value.trim());
    else if (draft.forget && view[target].token.set) put(target, "token", null);
  }
  return Object.keys(update).length ? (update as DeploySettingsUpdate) : null;
}
