# 表单控件的字号统一取自同一份记录

- **Date:** 2026-09-11
- **Type:** refactor
- **Scope:** `web`, `skills`
- **PR:** [#689](https://github.com/Prism-Shadow/penguin-harness/pull/689)

[English](2026-09-11-control-size-scale.md)

Web App 的表单控件此前在四处各自书写字号，彼此已经走样；另有六个字段因为调用点没有声明档位，比相邻控件高出一档。
字号现在统一来自 `components/ui/input.tsx` 中的 `sizeTextClass`，每个控件都显式声明自己所取的档位。

## 细节

- `sizeClass` 拆为 `sizeTextClass`（字号档位）与内边距两部分。`Select` 的菜单行、`OptionMenu` 的行标题与
  `Textarea` 改为读取该档位，不再各自书写——`Textarea` 原本用的是自己的字面量，与记录一致只是巧合；如今它只
  保留内边距作为显式覆盖，因为多行文本框需要比单行输入框更宽裕的空间。
- 重命名对话、重命名 Workspace、上下文阈值与快捷指令四个对话框改为传入 `sm`，与相邻控件一致；快捷指令对话框
  原本在同一个纵向栈里，`text-base` 的 `Input` 正压在 `text-xs` 的 `Textarea` 之上。
- 登录卡片保持 `text-base`，但改为显式声明（`size="base"`），是该档位唯一的有意调用方；其提交 Button 去掉了
  冗余的 `text-sm`。
- `Input`、`Textarea`、`Select`、`OptionMenu` 与 `PasswordInput` 的默认档位由 `base` 改为 `sm`，与 `FormPicker`
  看齐：漏写 `size` 时落在相邻控件已有的档位上，而不是最宽裕的那一档——上述六个字段正是这样走样的。所有调用点
  仍逐一声明档位，默认值只决定下一次遗漏落在哪里。
- `FormPicker` 新增 `size` 属性（默认 `sm`），取代原先写死的档位；`protocol-suffix.tsx` 里手写的选项菜单改为
  引入 `OptionMenu` 的行记录，不再重复书写。
- 四处原生元素归入该字号族：机器页的搜索框（并补上应用内其余四个搜索框都带的自动填充退出项）、对话输入区弹层
  里的目标预算输入框、记忆导入的单选行，以及 Trace 导入的选文件控件。
- 所有 `Modal` 页脚按钮由 `Button` 的默认 `md` 降为 `sm`，使弹窗按钮与其上方字段读起来同样大小——`ConfirmModal`
  本就如此，两类弹窗此前并不一致。共 21 个页脚、56 个按钮，另加三个位于弹窗正文的按钮（速度测试弹窗自建的操作行、
  OAuth 弹窗的授权入口）。页面级按钮——列表页头的新建操作、空状态的操作、登录卡片的提交——保持 `md`。
- 对话输入区与 Workspace 文件编辑器仍在该字号族之外——一个承载散文，一个承载代码——现已在各自代码处写明缘由。
- `packages/web/test/control-size.test.ts` 解析 JSX，一旦 `Input`、`Textarea`、`Select`、`OptionMenu`、
  `PasswordInput` 或 `FormPicker` 的 `className` 里出现字号类，即报出文件与行号并失败（这类类名要么毫无效果，
  要么让控件不再跟随用户的字号设置，而两者在评审中都看不出来）；`Modal` 页脚按钮未声明 `sm` 时同样失败。
- `.agents/skills/penguin-harness-frontend/SKILL.md` 新增「Control sizes」一节，记录各档位、规则背后的样式表
  顺序陷阱，以及唯一一处遗留的方括号字号。
