# 原生活动编辑与规格生成

Date: 2026-09-19
Type: feature
Scope: server, web
PR: [#3](https://github.com/nicolaepocroianu/penguin-harness/pull/3)

[English](2026-09-19-activity-workspace.md)

活动页面支持 Project 所有者按产品代码和引用编号创建活动、保存描述，并通过 Harness Session 生成规格。

## 生成与审核

每次尝试都会保存输入快照、Session 引用、状态和收集到的输出。只有已保存草稿仍与输入修订一致时，有效输出才会被应用。冲突或无效的候选结果会保留供审核。所有者可以取消运行或发起新的尝试；中断的运行会被记录，不会自动重试。

## 草稿编辑

描述和经过验证的规格在页面重新加载后仍会保留。修订检查可防止过期编辑覆盖较新的内容。Project 成员可以查看活动；编辑和生成需要 Project 所有者权限。导航和控件支持英文和中文。
