# 插件可从 npm、链接或 zip 导入，并可导出为 zip

- **Date:** 2026-10-09
- **Type:** feature
- **Scope:** `web`, `server`, `core`, `cli`

[English](2026-10-09-plugin-import-export.md)

管理员可在插件页把插件安装到服务端——按 npm 包名或链接、交给 Agent，或上传 zip；任何人都能把插件的包导出为 zip，另一台服务端可原样导入。

## 导入

- 插件页页头新增**导入插件**，仅管理员可见。弹窗先说明插件安装到整个服务端、由所有 Project 共用，再提供三种方式：直接安装 npm 包名或指向 git 仓库或 tarball 的 https 链接；让 Project 的默认 Agent 根据网页、仓库或一段描述找到插件包，审阅后用 `penguin plugin install` 安装；或上传插件包目录的 zip。服务端已有其他版本时，替换前先询问。
- 服务端在运行 npm 之前检查来源：只接受 npm 包名（可带版本、范围或标签）或不含凭据的 https 链接。路径、`file:`、`http:` 和 ssh 链接，以及包名后的 `npm:` 或 `file:` 别名都会被拒绝。
- zip 在安装任何内容之前就会被拒绝的情形：路径越出包目录、带 `node_modules/`、`package.json` 不在根目录或唯一的顶层目录内、包名或版本号不合法，或者包不是插件库能原样读取的插件；上限（2,000 个文件、单个文件 5 MB、合计 50 MB、zip 14 MB）在解压之前检查。服务端用 `npm pack --ignore-scripts` 打包这些文件，安装生成的 tarball，并把它保存在前缀的 `archives/` 中。
- 只含 Skill 或钩子的包进入插件库，标为**服务端安装**，与其他插件一样装到 Agent 上；新建 Project 的默认 Agent 不会预装它。带服务端模块的包还会为该 Project 启用并载入；从链接或 zip 安装的只为本服务端启用，其他机器因此不会按包名取到另一个同名的包。

## 导出与删除

- 插件详情新增**导出**：把插件包目录（不含 `node_modules/`）下载为 `<name>-v<version>.zip`；只要包在服务端上，任何成员都可以导出。
- 管理员可在详情中删除服务端安装的 Skill 或钩子插件；各 Agent 上已安装的 Skill 与钩子副本保持不变。

## CLI

- `penguin plugin install <specifier>`、`penguin plugin remove <name>` 与 `penguin plugin list` 用本地 API token（即管理员身份）安装、移除和列出服务端上的插件。

## API

- `POST /api/projects/:projectId/plugins/installed` 除包名外还接受 https 链接，并在响应中附带 `installed: {name, version, library, modules, unchanged?}`。只含 Skill 或钩子的包不再写入 Project 的 `[plugins]` 表。
- 新增 `POST /api/projects/:projectId/plugins/installed/archive`（管理员；`{dataBase64, overwrite?}`；409 `plugin_exists`）、`GET /api/plugins/:plugin/archive` 与 `GET /api/plugins/registry/archive?name=`（任何已登录用户）。
- `PluginItem` 新增 `package`；管理员安装的插件的 `source` 为 `installed`。注册表列表为每个从链接或 zip 安装的服务端模块包列出一行。
