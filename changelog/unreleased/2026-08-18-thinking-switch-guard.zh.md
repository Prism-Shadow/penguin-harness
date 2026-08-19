# Web App：会话中途切换思考等级需确认，且所选档位不再丢失

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `web`, `server`, `docs`
- **PR:** [#320](https://github.com/Prism-Shadow/penguin-harness/pull/320)
- **Issue:** [#310](https://github.com/Prism-Shadow/penguin-harness/issues/310)

[English](2026-08-18-thinking-switch-guard.md)

进行中会话输入区的思考等级拾取器原本直接应用所选档位，哪怕对话已经很长——而中途切换会降低服务商的提示词缓存命中率，抬高下一次请求的成本。现在，凡是会改变档位的选择都会弹出标准确认卡片，用一句话把这件事说清楚，并给出三个选择。所选档位同时落到 Session 上，刷新页面不再丢失。

## 对话框的三个选择

- **压缩后切换**——推荐操作，位于卡片的主按钮。它会沿输入区 `/compact` 命令相同的路径发起一次上下文压缩，并在压缩结束后应用新档位。压缩失败或被中断时档位照样切换（切换本来就是用户要的），同时提示压缩未成功完成，不会让人误以为上下文已被重写。会话繁忙时压缩既无法启动也不会排队，因此除非会话空闲，该选项会置灰并说明原因，另外两项照常可用。
- **仍要切换**——旁边的普通按钮，立即应用所选档位。
- **取消**——保持当前档位。

`POST /compact` 返回 `202`，结果稍后经流式通道送达，因此压缩期间所选档位被暂存——暂存是为了顺序，而不是为了否决：压缩进行到一半就应用新档位，会让这期间发出的任何消息带上新档位，正好毁掉这次压缩想要收缩的那份缓存。`compactionTally` 在发起请求时记下已结束与已成功的压缩计数，`compactionSettledSince` 判断新一次压缩如何收场，`heldThinkingSwitch` 据此给出释放决定（是否应用、附带哪种提示）。这里采用计数而非比对条目 id，是为了在流式重连后依然正确。

## 所选档位可跨刷新保留

档位此前只存在 React 状态里：刷新一次，拾取器就按 Agent 配置重新初始化，用户的选择被悄悄退回。现在它是 Session 的一个字段。

- 新增可空列 `sessions.thinking_level`（走既有的 `ensureColumn` 升级路径，无需迁移）支撑新的 `SessionInfo.thinkingLevel`，由 `PATCH /api/sessions/:sessionId { thinkingLevel }` 写入（`none | low | medium | high | xhigh`，其余取值 400）。
- 服务端会把它应用到所有自身未携带等级的运行——普通 Task、排队的跟进消息、目标模式运行一视同仁，均在启动时解析——于是回退链变为：请求自带的档位 → 该 Session 固定的档位 → Agent 配置的档位。
- 未固定（新会话的默认状态）与此前行为完全一致：拾取器显示并自动跟随 Agent 配置的档位，运行也回退到它。一旦固定，Agent 配置再改也不会带走这个会话——这正是固定的意义。

## 不弹框的情况

- 会话尚无消息，全新会话的初次选择照常自由选取。
- 所选档位与拾取器当前显示的一致，这只是把档位固定到本会话。
- 时间线以一次成功的压缩收尾，即走过「压缩后切换」路径的用户不会被二次提醒。

草稿态拾取器（尚未创建会话，直接写回 Agent 设置）保持原样。

## 细节

- 守卫、时序与显示规则以纯函数形式落在 `thinking-level.ts`——`prefixCacheAtRisk`、`needsThinkingSwitchConfirm`、`compactionTally`、`compactionSettledSince`、`heldThinkingSwitch`、`sessionThinkingLevel`——并配有单元测试，其中包括「压缩失败也照样切换」与「已固定的档位压过被改动的 Agent 配置」。
- 共享的 `ConfirmModal` 新增一个可选的第三操作（`secondaryLabel` 与 `onSecondary`，渲染为取消与确认之间的普通按钮），以及一个只置灰主按钮的 `confirmDisabled` 标志。两者默认关闭，原有的双按钮卡片与其余调用点均不受影响。按钮行改为可换行，因为三个长标签在手机宽度的底部弹层里排不进一行。
- 服务端的 `compacting` 错误码补上了本地化文案。
- Web App 与 Server API 双语文档记录了这套流程与新字段。
