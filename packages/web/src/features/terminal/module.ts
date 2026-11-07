/**
 * The standalone terminal page, outside the app shell, and the runtime of the terminal view
 * pool: the xterm views live in it and are adopted into dock tab bodies by DOM handoff, so
 * navigating between pages never reconnects a terminal.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { TerminalPage } from "./terminal-page";
import { TerminalDockRuntime } from "./terminal-view-pool";

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
  },
})
export class TerminalModule {
  @Bind("terminal.page") page = TerminalPage;
  @Bind("terminal.runtime") runtime = TerminalDockRuntime;
}
