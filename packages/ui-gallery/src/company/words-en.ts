import type { Words } from "./words";

export const en: Words = {
  appName: "Company",
  draftNote:
    "Design draft: company mode as a plugin app in the App Center. The data is for demonstration.",
  org: {
    switch: "Switch organization",
    create: "New organization",
  },
  jobs: {
    newJob: "New job",
    newJobHint: "Opens a new conversation in the chat page, for a member of the organization",
    groups: {
      waiting: (n: number) => `Waiting on you (${n})`,
      running: (n: number) => `In progress (${n})`,
      done: (n: number) => `Done (${n})`,
    },
    empty: "No jobs yet. Use New job to open a conversation for the lead.",
    waitingApproval: "Needs approval",
    approvalHint: (n: number) =>
      `${n} ${n === 1 ? "action is" : "actions are"} waiting for your approval; open the conversation to answer`,
    running: "Running",
    scheduled: "Opened by a scheduled task",
    more: "More actions",
    copyId: "Copy session ID",
    copied: "Session ID copied",
    stop: "Stop",
    stopped: (title: string) => `Stopped "${title}"`,
  },
  create: {
    title: "New organization",
    description:
      "Say the goal in a sentence; the lead settles the details with you in the first conversation.",
    goal: "Goal",
    goalPlaceholder:
      "For example: keep the PenguinHarness docs site current, within two days of every release",
    toLead: "Hand it to the lead",
    templates: "Start from a template",
    templatesInfo:
      "A template is an organization package you can import and export: the members, their models and Skills, and when they open conversations on their own.",
    plan: "Plan",
    planTeam: "Members",
    planTrigger: "Opens conversations",
    cancel: "Cancel",
    createOrg: "Create organization",
    otherPlugin: "Another plugin",
    otherPluginHint:
      "A real-company mirror depends on a chat entry point, so a messaging plugin carries it, outside the company app's main flow",
    created: (name: string) => `Created "${name}"`,
  },
};
