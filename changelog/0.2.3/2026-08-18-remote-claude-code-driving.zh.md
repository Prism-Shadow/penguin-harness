# remote-claude-code skill v2：逐字转发与逐键截屏确认

- **Date:** 2026-08-18
- **Type:** process
- **Scope:** `skills`, `docs`
- **PR:** [#317](https://github.com/Prism-Shadow/penguin-harness/pull/317)
- **Issue:** [#307](https://github.com/Prism-Shadow/penguin-harness/issues/307)

[English](2026-08-18-remote-claude-code-driving.md)

`remote-claude-code` 库 Skill 升到 v2，修补了真实转发会话中反馈上来的四处缺口：本地 Agent 越俎代庖替 Claude Code 作答、把「模型 + 档位」的切换请求当成一个不认识的模型名、成批按键与 TUI 抢跑，以及把一轮结束后残留的建议文本误认成用户尚未发出的输入。故障排查表、验证清单、Skill 的 frontmatter 描述与中英两份 `skills` 文档表格同步更新，并为这批新规则补了一个契约测试。

## 转发契约

- 新增的「Relaying a conversation」一节把「转发」落到字面：会话建立之后，用户消息逐字送达 Claude Code，本地 Agent 既不作答、也不改写、更不代做任务的任何一部分，只对会话控制类请求——切换、打断、attach 与 detach——直接动手。
- 工具权限提示、澄清提问与计划确认改由用户拍板，原样带到用户面前，再按他选定的键作答；此前那条「出现时用 `send-keys` 顺手答掉」的指示被删除，`--dangerously-skip-permissions` 仍是唯一一项长期授权。
- 一轮进行中到达的消息会先扣住，等这轮结束再发；用户想立刻叫停时，改为按一次 `Escape` 后再发。`capture-pane` 报 `can't find pane` 或 `no server running` 被明确认定为会话已死，用 `claude --continue` 重建。
- 回复改用带回滚缓冲的 `capture-pane -p -S -200` 读取，不再用只能拿回片段的 `tail`；任务与控制的边界按主题划定：关于会话本身的问题就地看一眼截屏作答，关于工作内容的一律原样转发。
- 一轮结束后仍留在输入行里的文本，被写明是 Claude 生成的建议消息，截屏无法把它与用户真正未提交的输入区分开——不得提交，也不得当成用户的未发草稿回报；直接键入新消息即可让它消失。

## 逐字传输

`send-keys -l` 会把消息里嵌的换行当成 Return 送出，将一条用户消息劈成 Claude Code 的两轮；tmux 的命令解析器还会吞掉用来结束参数的 `;`。多行、长文以及标点密集的消息改走引号 heredoc 的 `load-buffer` 加 `paste-buffer -d -p`，「是否落到位」的检查也改成严格判定——输入行必须只显示这条消息、别无他物——并为「粘连成一行」和「粘贴时自行提交」两种情形各给了具名的补救办法。

## 逐键推进

`send-keys Up s` 这类成批按键会与 TUI 抢跑，按键落在上一次的选中项上。所有菜单、选择器与对话框一律改为：一次 `send-keys` 只发一个键，键与键之间插一次 `capture-pane`，确认到达预期状态再发下一个键；并配一条界限清楚的失败分支——被吞掉的键重发一次，走错的一步用反向键纠正，连续两次纠正仍不奏效就停手，把屏幕摆给用户看，而不是继续凭感觉敲下去。第 3 节的对话示例也拆成「文本」与「Enter」两步，中间隔一次截屏。

## 模型与思考档位切换

「switch to fable5 max」被明确为两项设置——模型与思考档位——而不是一个不认识的模型名，也一律不作为聊天内容转发。这条规则是按请求的形态写的，而非只认这一个例子：它覆盖任意语言，包括该问题原本使用的中文说法，也覆盖只切档位与只切模型的请求；档位词汇逐一列出，收尾还要求截屏确认——所请求的那一项确已改变，未被触及的那一项保持原样。
