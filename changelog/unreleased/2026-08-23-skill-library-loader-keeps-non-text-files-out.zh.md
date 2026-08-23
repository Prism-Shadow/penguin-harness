# 技能库加载器不再把非文本文件收进清单

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `skills`

[English](2026-08-23-skill-library-loader-keeps-non-text-files-out.md)

`readSkillFiles` 会以 `utf8` 编码读取库内 skill 目录下的每一个普通文件，而 `installSkill` 又以同样的
编码把这些字符串写回磁盘——于是一个非 UTF-8 文本的文件在这条链路上字节会被替换成 U+FFFD，最终被安装成
一份损坏的副本，且全程无人报错。现在辅助文件改为严格解码，非文本一律跳过，并新增测试盯住整个技能库保持
纯文本。

## 细节

- `decodeSkillFile` 使用 `fatal` 的 `TextDecoder` 解码，并拒绝 NUL 字节——UTF-16 文本的字节序列碰巧构成
  合法 UTF-8 时就是这个样子。`ignoreBOM` 让开头的 BOM 保留在字符串中，因此能通过解码的文件所携带的内容
  与此前的读取结果完全一致。
- 新增的全库测试遍历 `skills/`，连 `SKILL.md` 与 `icon.svg` 一并检查而不只是辅助文件，并列出任何非文本
  文件，使其无法悄悄进入某个发布。
- 清单只装文本是有意为之：archive 安装路由以 `Uint8Array` 承载上传文件，不受影响，因此从 zip 安装的
  Skill 仍可携带二进制资源。
