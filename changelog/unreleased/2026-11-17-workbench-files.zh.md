# Workbench：应用与其 Agent 共同读写的文件夹

- **Date:** 2026-11-17
- **Type:** feat
- **Scope:** `server`, `core`, `skills`, `docs`

[English](2026-11-17-workbench-files.md)

应用的处理器可以读写 `.files/`：它位于应用自己的目录内，该应用的 Agent 也用自己的文件工具编辑其中的文件。`WorkbenchHost` 新增 `listFiles()`、`readFile(path)`、`writeFile(path, data)`、`removeFile(path)` 与 `filePath(path?)`，用户在页面里编辑、又让 Agent 修改的文档因此是磁盘上的一个文件，后写的一方即另一方下次读到的内容。AI PPT 工作台是第一个使用者。

## 细节

- `listFiles()` 给出 `.files/` 下全部常规文件的 `{ path, size, mtimeMs }`，按路径排序。`readFile(path)` 在文件不存在时为 `null`。`writeFile(path, data)` 接受字符串或 `Uint8Array`，整份写入（先在旁边写暂存文件再改名），自动建目录，返回写入的文件。`removeFile(path)` 对不存在的文件不做任何事。`filePath(path?)` 给出该文件（不带路径时为该文件夹）在服务端所在机器上的绝对路径，供处理器请 Agent 编辑该文件时指明。
- 不提供监视方法：处理器在有页面连接期间定时调用 `listFiles()`，比较 `mtimeMs` 与 `size`，得知 Agent 的写入。
- 不跟随任何链接。文件本身或其在该文件夹内的任一级上级目录为符号链接时拒绝，列表略过链接。路径以 `/` 分隔，不得越出该文件夹。单个文件至多 50 MB，文件超过 5,000 个时列表抛错。
- 这个文件夹是应用的数据而非源码：写入不触发加载、不记录版本；回滚、插件更新与应用 zip 导入都不动它；移除应用时随 `state.json` 一并删除。
- 导出 Agent 时，`.files/` 与各应用的 `state.json` 一同携带，仅在勾选**含其数据**（`workbenchData`）时带上。覆盖导入时，包内带了某个应用却没带其 `.files/` 的，沿用现有的，与 `state.json` 相同。插件安装可以接手只含 `state.json` 与 `.files/` 的应用目录。新建的 `agent_state.git` 的 git 排除文件列出 `workbenches/*/.files/`。
- 服务端生成的 `.harness/README.md` 新增「Files shared with the Agent」一节，上传的文件改放在 `.files/`。此前写下的 `.harness/plugin.d.ts` 没有 `listFiles`：删除 `.harness/` 即可取得新的类型。
- `penguin-plugin` Skill（`2026.11.17.1`）新增「Files shared with the Agent」一节，在宿主方法中列出这五个成员，上传的文件改用宿主的文件存放，不再放在 scratchpad。Workbench 插件、Agent、服务端 API 与「Session 与 Trace」文档页，以及 CLI `--no-workbench-data` 的帮助文字都说明了该文件夹。
- 设计：[penguin-harness-design PRFC-0028](https://github.com/Prism-Shadow/penguin-harness-design/blob/main/rfcs/PRFC-0028-workbench-files.md)。
