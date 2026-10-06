# 提案显示所属的路线图

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `company-proposals`, `company-roadmaps`, `server`, `web`

[English](2026-10-07-proposal-roadmaps.md)

提案的列表行与详情会列出由其条目引向该提案的路线图，提案页逐一链接过去。

## 细节

- 提案的读取接口（`GET …/proposals` 与 `GET …/proposals/:number`）带上 `roadmaps: { number, name, itemKey }[]`：凡有条目的委托指向该提案的路线图——由条目的批准创建、或由条目采纳或关联——都会列出。company-roadmaps 运行期间向 company-proposals 提供这一查询（`provideProposalRoadmaps`）；未装该插件时列表为空。写操作的应答不带此字段。
- 提案页在标题下方每个路线图一行——`路线图 #n «名称» / 条目 <key>`——链接到该路线图，以及筛选出其全部提案的队列。
- 队列搜索支持 `roadmap:<n>`（也可写 `roadmap:#<n>`，取反写 `-roadmap:<n>`）。
