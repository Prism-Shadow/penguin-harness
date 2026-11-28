import {
  S,
  subscribeTerminalPanelOffered,
  terminalPanelOffered,
} from "@prismshadow/penguin-web/internal";
import { ICONS } from "@prismshadow/penguin-ui";

import { terminalApiSupported, watchTerminals } from "./terminal-list";
import { TerminalPanel } from "./terminal-panel";

// The terminal is one panel whose body lists the conversation's shells as tabs. Unlike the
// browser it needs a Session — a shell belongs to the conversation that opened it — so a draft
// does not offer it. It lands at the bottom, where a terminal is expected, and its tile on the
// dock's start page names its toggle's keys.
//
// The id and the glyph are named here rather than read from the web host's internal hub: the
// host's dock code imports this half, so a top-level read of the hub's constants would close a
// cycle and read them before the host's modules have run.
export const mainPanelDefinition = {
  id: "terminal",
  label: () => S.terminal.shellEntry,
  glyph: ICONS.terminalWindow,
  order: 15,
  defaultPosition: "bottom",
  shortcut: "terminal.toggle",
  availableFromAppCenter: terminalApiSupported,
  subscribeAppCenterAvailability: watchTerminals,
  offered: terminalPanelOffered,
  subscribeOffered: subscribeTerminalPanelOffered,
  Body: TerminalPanel,
};
