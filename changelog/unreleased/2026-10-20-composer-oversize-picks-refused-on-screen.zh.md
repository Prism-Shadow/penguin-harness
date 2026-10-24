# 会话输入框里超限的选中文件在页面上被告知，不再无声消失

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `web`

[English](2026-10-20-composer-oversize-picks-refused-on-screen.md)

在对话输入框里选中超过上传上限的文件或图片，本就在读取之前被拒——对上传来说这是正确的选择——但说明这一点的只有一条几秒后自行离开的 toast，且它所在的区域没有任何 `role`。看得晚的人只看到空的输入框、页面各处无一字，就像那次选择从未发生过；而文件面板对超限的措辞是一直留在页面上的。现在输入框也把拒绝留在页面上：紧贴输入卡上方的列里出现一条 danger 色的 `role="alert"` 提示，每个被拒文件一句，各自点名文件与拒收它的上限（`qa.bin 超过 100MB 上限，未添加。` / `qa.bin exceeds the 100MB limit and was not attached.`），中英两种界面皆然。

## 细节

- 两路入口——图片按 `imageMaxMb`、文件附件按 `attachmentMaxMb`（两个上限都由管理员设置、经 `/api/me` 读得）——改发这条提示、不再发 toast。每次选中事件（图片入口、文件入口、粘贴、拖放）都从清空开始，拒绝语不会活过它所解释的那次选择；一次拖放同时拒收一张图片和一个文件时，两句都会出现。
- 提示留到下一次选中、发送成功或读者按下自己的关闭叉；未超限的文件与图片的行为不变，附件贴片照旧出现。
- 新组件 `AttachmentRejectionNotice`（`packages/web/src/features/chat/attachment-rejection-notice.tsx`）只管布局；措辞留在聊天文案里（`S.chat.attachmentTooLarge`），`packages/web/test/attachment-rejection-notice.test.ts` 钉住宣告方式、两种语言与多条拒绝的顺序。
