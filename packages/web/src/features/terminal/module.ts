/** The standalone terminal page, outside the app shell. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { TerminalPage } from "./terminal-page";

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
  },
})
export class TerminalModule {
  @Bind("terminal.page") page = TerminalPage;
}
