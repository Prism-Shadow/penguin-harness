/**
 * The Settings pages other modules contributed (`SettingsModule.sections`), recorded by the
 * settings module at boot and read by every Settings dialog — the one the layer opens, and the
 * ones a page opens on a section of its own. Each keeps the module that contributed it, whose
 * server-module gate decides whether the page is there (lib/module-gate.ts).
 */
import type { SettingsSectionCode, SettingsSectionData } from "@prismshadow/penguin-web-plugin";
import { contributionShown } from "../../lib/module-gate";

export interface ContributedSection {
  data: SettingsSectionData;
  code: SettingsSectionCode;
  /** The contributing module. */
  from: string;
}

let sections: readonly ContributedSection[] = [];

export function setContributedSections(next: readonly ContributedSection[]): void {
  sections = next;
}

export function contributedSections(): readonly ContributedSection[] {
  return sections;
}

/** The contributed pages drawn now: those whose module's server half runs, or needs none. */
export function shownSections(): readonly ContributedSection[] {
  return sections.filter((section) => contributionShown(section.from));
}
