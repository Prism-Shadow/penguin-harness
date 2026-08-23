# macOS 安装 penguin 命令时对交给提权 shell 的应用路径做了引号转义

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#411](https://github.com/Prism-Shadow/penguin-harness/pull/411)

[English](2026-08-23-desktop-cli-install-quoting.md)

在 macOS 上安装 `penguin` 命令时，若直接链接 `/usr/local/bin/penguin` 被拒绝，会退回到
`osascript … with administrator privileges`——在没有装 Homebrew 的 Mac 上这是常规路径，那里
该目录并不存在，创建它需要 root。此前拼出来的命令把应用包自身的路径未加转义地插进单引号
shell 词里，于是一个放在名字含撇号的目录下的应用包会生成一条冲出引号、并以 root 身份执行的
命令。现在两层引号转义都由 `launcher.ts` 里的生成函数负责，与启动脚本放在一起，由同一批单测
覆盖。

## 细节

- `shellQuote` 把一个值渲染成单个 POSIX shell 词，内嵌的单引号按 `'\''` 拼接；
  `appleScriptString` 再把得到的命令渲染成 AppleScript 字符串字面量，转义前一步引入的反斜杠。
- `adminSymlinkAppleScript` 把两者组合成 `cli-install.ts` 传给 `osascript` 的
  `do shell script …` 源码，转义规则因此只在一处决定、并被直接断言，而不是在调用点重述。
- 链接目录改为从链接路径推导，不再写两遍。
- AppImage 包装脚本对含引号路径的拒绝保持不变：它把路径写进一个长期留在磁盘上的脚本，暴露面
  与一次性命令不同。
