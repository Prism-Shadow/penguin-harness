import type { PromptSection } from "@prismshadow/penguin-core";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Component } from "@prismshadow/penguin-core/kernel";
import type { Assembly } from "../mechanisms/agents.js";

export interface HostAssemblySlots {
  /** A section appended to every Agent's system prompt. */
  promptSections: { title: string; text: string };
}

/**
 * What the host adds to every Session's assembly, built from this component's slots
 * (`HostAssembly.promptSections`): a module — a workflow's prompt, a plugin's — that has
 * something to tell every Agent contributes a section here, and the Session's Agent is
 * assembled with it.
 */
@Component()
export class HostAssembly implements Assembly {
  private sections: PromptSection[] = [];

  /** Sections appended to every Agent's system prompt, under their own headings. */
  promptSections(): PromptSection[] {
    return this.sections;
  }

  setup({ contributions }: ClassCtx) {
    this.sections = (contributions.promptSections ?? []).map(
      (c) => c.data as unknown as PromptSection,
    );
  }
}
