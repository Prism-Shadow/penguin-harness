# 按需复现 benchmark

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `skills`, `docs`

[English](2026-10-03-benchmark-reproduction.md)

在 Agent Tuning 中新增 `benchmark-reproduction`：从仓库或本地源码复现已有 benchmark，
保留原始评估协议，完成冒烟运行与评估中心可见性检查，再询问是否跑全量。

## 细节

- 提供 reference、通用和自定义构造路径，并在 GDPevo 配方中记录环境与评分器适配经验。
- 原始划分生成 train/test benchmark；长程任务保留相同定义，明确时间／trial 切点及状态交接。
- Agent Evaluation 读取 benchmark 自己的 Runtime 说明，无需平台增加专用代码；数据和适配器按需生成。
- 在当前 main 上重建 RSI 工作，不带入此前的 GDPevo 数据包、默认初始化及 Python runtime，不删除已有用户数据。
