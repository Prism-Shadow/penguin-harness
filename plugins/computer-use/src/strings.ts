/**
 * What `penguin computer` prints for help, in the caller's language. The command, option and
 * setting names stay as they are in both: they are what the reader types or looks for.
 */

const HELP = {
  en: `Usage: penguin computer <command> [args]

Operate the apps on this computer's desktop through their accessibility trees, with
agent-desktop {version}. The commands and options are agent-desktop's; each prints one JSON envelope.

  status                      what this machine offers, and whether Computer Use can run here
  snapshot --app <name> -i    read an app's window; refs (@<snapshot>:eN) name its elements
  find --app <name> --name X  search an app's window
  click | type | set-value | select | toggle | check | expand ... <ref>
                              act on an element through its accessibility API
  wait --element <ref> | --text <t> --app <name> | <ms>
                              wait for something to appear
  get | is <ref>              read an element
  screenshot --app <name> [name.png]
                              a PNG of the window, saved here (or in --out-dir <dir>)
  launch | close-app <app>    start (by name, no arguments) or quit an app (ask the user first)
  focus-window | move-window | resize-window | minimize | maximize | restore --app <name>
  press <combo> --app <name>  a key combination, sent to that app only
  clipboard-set [text] | clipboard-clear
  batch '<json>'              several commands in one call
  <command> --help            agent-desktop's help for one command

Options of penguin computer itself:
  --text-file <file>          the text of type, set-value or clipboard-set, read from a file
  --out-dir <dir>             where a screenshot is saved

Name apps exactly as list-apps prints them. By default only administrators (and Agents
working for one) may use this; an administrator can allow members.
Off unless an administrator allows it (Settings → Plugins → Computer Use): physical input
(--headed, mouse-*, hover, drag, double-click, focus, scroll), clipboard-get, list-notifications.
Never run from here: sandbox, mcp, cursor-overlay, session, trace, notification actions,
open-system-surface, and any command aimed at PenguinHarness itself.
`,
  zh: `用法：penguin computer <command> [args]

经无障碍树操作这台电脑桌面上的应用，底层是 agent-desktop {version}。命令与参数都是
agent-desktop 自己的，每条命令打印一个 JSON 信封。

  status                      本机的情况，以及 Computer Use 能否在此运行
  snapshot --app <name> -i    读取应用的窗口；ref（@<snapshot>:eN）指向其中的元素
  find --app <name> --name X  在应用的窗口中查找
  click | type | set-value | select | toggle | check | expand ... <ref>
                              经无障碍接口操作元素
  wait --element <ref> | --text <t> --app <name> | <ms>
                              等待某样东西出现
  get | is <ref>              读取元素
  screenshot --app <name> [name.png]
                              窗口的 PNG，存在当前目录（或 --out-dir <dir>）
  launch | close-app <app>    按名称启动（不带参数）或退出应用（先征得用户同意）
  focus-window | move-window | resize-window | minimize | maximize | restore --app <name>
  press <combo> --app <name>  组合键，只发给该应用
  clipboard-set [text] | clipboard-clear
  batch '<json>'              一次调用执行多条命令
  <command> --help            agent-desktop 对单条命令的帮助

penguin computer 自己的参数：
  --text-file <file>          type、set-value 或 clipboard-set 的文本，从文件读取
  --out-dir <dir>             截图存放的目录

按 list-apps 打印的名称逐字指明应用。缺省只有管理员（及为其工作的 Agent）可以使用，
管理员可以允许成员使用。
需管理员允许才可用（设置 › 插件 › Computer Use）：物理输入（--headed、mouse-*、hover、
drag、double-click、focus、scroll）、clipboard-get、list-notifications。
一律不在此运行：sandbox、mcp、cursor-overlay、session、trace、通知操作、
open-system-surface，以及任何以 PenguinHarness 自身为目标的命令。
`,
};

export function helpText(language: "en" | "zh", version = "1.3.1"): string {
  return HELP[language].replace("{version}", version);
}
