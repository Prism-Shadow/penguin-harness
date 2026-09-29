/**
 * How the site groups the modules: the home page's index, the left nav and a page's eyebrow all
 * read this one list. Every module id is in exactly one group (a test holds it to `MODULE_IDS`),
 * and within a group the modules keep `MODULE_IDS` order. Group titles are chrome copy
 * (`S.groups`); the ids here are the keys into that dictionary.
 */
import { MODULE_IDS } from "../../../ui/src/module";
import type { ModuleId } from "../../../ui/src/module";

export const GROUP_IDS = [
  "foundations",
  "conversation",
  "navigation",
  "actions",
  "forms",
  "data",
  "content",
  "flows",
  "screens",
] as const;
export type GroupId = (typeof GROUP_IDS)[number];

export interface ModuleGroup {
  id: GroupId;
  modules: readonly ModuleId[];
}

const MEMBERS: Readonly<Record<GroupId, readonly ModuleId[]>> = {
  foundations: ["foundations"],
  conversation: ["conversation", "composer"],
  navigation: ["navigation", "pages"],
  actions: ["actions", "status"],
  forms: ["forms", "overlays", "dialogs"],
  data: ["tables", "stats"],
  content: ["content", "files"],
  flows: ["hero", "create-with-ai", "empty-states", "company"],
  screens: ["screens"],
};

const inIndexOrder = (a: ModuleId, b: ModuleId) => MODULE_IDS.indexOf(a) - MODULE_IDS.indexOf(b);

/** The groups in index order, each listing its modules in `MODULE_IDS` order. */
export const MODULE_GROUPS: readonly ModuleGroup[] = GROUP_IDS.map((id) => ({
  id,
  modules: [...MEMBERS[id]].sort(inIndexOrder),
}));

const GROUP_OF = new Map<string, GroupId>(
  MODULE_GROUPS.flatMap((group) => group.modules.map((id) => [id, group.id] as const)),
);

/** The group a module belongs to; an id no group lists (never, by the test) reads as `flows`. */
export function groupOf(moduleId: string): GroupId {
  return GROUP_OF.get(moduleId) ?? "flows";
}
