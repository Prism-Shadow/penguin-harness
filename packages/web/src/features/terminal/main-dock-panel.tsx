import { NAV_ICONS } from "../../lib/nav-icons";
import { S } from "../../lib/strings";
import {
  TERMINAL_PANEL,
  subscribeTerminalPanelOffered,
  terminalPanelOffered,
} from "../dock/index";

import { TerminalPanel } from "./terminal-panel";

// The terminal is one panel whose body lists the conversation's shells as tabs. Unlike the
// browser it needs a Session — a shell belongs to the conversation that opened it — so a draft
// does not offer it. It lands at the bottom, where a terminal is expected, and the picker
// names its toggle's keys.
export const mainPanelDefinition = {
  id: TERMINAL_PANEL,
  label: () => S.terminal.shellEntry,
  glyph: NAV_ICONS.terminal,
  order: 15,
  defaultPosition: "bottom",
  shortcut: "terminal.toggle",
  offered: terminalPanelOffered,
  subscribeOffered: subscribeTerminalPanelOffered,
  Body: TerminalPanel,
};
