/**
 * Selection arithmetic for the multi-select skill panel (pure, unit tested), shared by the
 * composer's dropdown and the Agent create dialog's seed picker.
 *
 * The selection is an ordered list rather than a set because pick order is what the composer
 * renders and sends: a name joins at the end and keeps its place, so nothing reshuffles under
 * the user while they keep picking. Every function returns a new array and never mutates.
 */

/** Adds the name when absent, drops it when present. */
export function toggleSkillName(selected: readonly string[], name: string): string[] {
  return selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name];
}

/** Adds every name not already selected, appended in the order given. */
export function addSkillNames(selected: readonly string[], names: readonly string[]): string[] {
  return [...selected, ...names.filter((n) => !selected.includes(n))];
}

/** Drops every named entry, leaving the rest in their existing order. */
export function removeSkillNames(selected: readonly string[], names: readonly string[]): string[] {
  return selected.filter((n) => !names.includes(n));
}
