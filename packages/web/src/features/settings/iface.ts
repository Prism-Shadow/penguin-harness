/**
 * The settings module's interface and its slot: a page of the Settings dialog that another module
 * brings (`sections`), with its key, group, visibility, glyph and place as data and its name,
 * explanation and body as code. The interface itself carries nothing; the kernel hangs the slot on
 * it (`SettingsPagesSlots` beside `SettingsPages`), and the module keeps the contributions for the
 * dialog (contributed-sections.ts). The types are the plugin face's, so a plugin's web half and the
 * boot check judge one shape.
 */
import { Interface, type Slot } from "@prismshadow/penguin-core/kernel";
import type { SettingsSectionCode, SettingsSectionData } from "@prismshadow/penguin-web-plugin";

@Interface()
export abstract class SettingsPages {}

export interface SettingsPagesSlots {
  /** A page of the Settings dialog, among the app's own. */
  sections: Slot<SettingsSectionData, SettingsSectionCode>;
}
