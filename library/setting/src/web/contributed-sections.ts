/**
 * The Settings pages other modules contributed (`SettingsModule.sections`), recorded by the
 * settings module at boot and read by every Settings dialog — the one the layer opens, and the
 * ones a page opens on a section of its own. Each keeps the module that contributed it, whose
 * server-module gate decides whether the page is there (lib/module-gate.ts).
 */
import type { SettingsSectionCode, SettingsSectionData } from "@prismshadow/penguin-web-plugin";
import { contributionShown } from "@prismshadow/penguin-web/internal";

export interface ContributedSection {
  data: SettingsSectionData;
  code: SettingsSectionCode;
  /** The contributing module. */
  from: string;
}

let sections: readonly ContributedSection[] = [];

/**
 * The settings module's side, at boot. Two contributors naming one key would make one rail entry
 * open the other's page: the first in contribution order keeps it, the later one is dropped and
 * said on the console.
 */
export function setContributedSections(next: readonly ContributedSection[]): void {
  const seen = new Map<string, string>();
  sections = next.filter((section) => {
    const first = seen.get(section.data.key);
    if (first === undefined) {
      seen.set(section.data.key, section.from);
      return true;
    }
    console.warn(
      `${section.from}: a Settings page keyed "${section.data.key}" is already contributed by ${first}; this one is dropped`,
    );
    return false;
  });
}

export function contributedSections(): readonly ContributedSection[] {
  return sections;
}

/** The contributed pages drawn now: those whose module's server half runs, or needs none. */
export function shownSections(): readonly ContributedSection[] {
  return sections.filter((section) => contributionShown(section.from));
}
