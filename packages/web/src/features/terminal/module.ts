/**
 * The standalone terminal page, outside the app shell, and the runtime of the terminal view
 * pool: the xterm views live in it and are adopted into dock tab bodies by DOM handoff, so
 * navigating between pages never reconnects a terminal. The terminal is also one dock panel
 * (main-dock-panel.tsx): its body lists the conversation's shells as tabs.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { TerminalPage } from "./terminal-page";
import { TerminalDockRuntime } from "./terminal-view-pool";
import { mainPanelDefinition as mainPanelTerminal } from "./main-dock-panel";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "terminal.page",
        key: "terminal",
        path: "/terminal",
        frame: "bare",
        nav: "none",
        admin: false,
        released: true,
        order: 100,
      },
    ],
    "WebAppModule.layers": [{ id: "terminal.runtime", order: 10 }],
    "DockModule.panels": [
      {
        id: "terminal.panel",
        kind: "terminal",
        title: "Command-line terminal",
        titleZh: "命令行终端",
        icon: "terminalWindow",
        order: 15,
      },
    ],
  },
})
export class TerminalModule {
  @Bind("terminal.page") page = TerminalPage;
  @Bind("terminal.runtime") runtime = TerminalDockRuntime;
  @Bind("terminal.panel") panel = { mainDefinitions: [mainPanelTerminal] };
}
