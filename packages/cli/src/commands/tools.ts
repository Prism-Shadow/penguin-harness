import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";
import type { Command } from "commander";
import { registerModelToolTransport, type Messages } from "@prismshadow/penguin-server/cli";

@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.tools",
        key: "tools",
        summary: {
          en: "Use model tools provided by this project’s plugins",
          zh: "调用项目插件提供的模型工具",
        },
      },
    ],
  },
})
export class ToolsCommand {
  @Bind("cli.tools") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command: CliCommandProgram, ctx) =>
        registerModelToolTransport(command as unknown as Command, ctx.messages),
    };
  }
}
