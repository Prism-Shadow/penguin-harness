# 完善 Agent Tuning 的执行与结果记录约定

- **Date:** 2026-10-03
- **Type:** process
- **Scope:** `skills`, `docs`

[English](2026-10-03-agent-tuning-validation.md)

通过 Penguin Agent 实际运行 benchmark 复现与 RSI 实验后，更新了 Agent Tuning 指令。

## 细节

- 明确任务访问范围、每次执行的私有临时目录和显式 thinking 配置；越界或被中止的执行记为无效。
- 补充评估期间冻结 benchmark 材料的要求，以及保留原始评分、精确换算、各次尝试和数据划分证据的约定。
- 明确 Optimizer 的反馈权限、轨迹读取、记分板并发写入、真实时间戳和费用统计范围。
- 将 AWM 的实时 workflow 索引集中到一个文件，并在 GDPevo recipe 中记录导入依赖和逐题评分要求。
- 补充按角色声明反馈权限、规则与工作流步骤的证据、实际加载与应用检查，以及补测记录要求。
- 补充快照发布前校验、完整 State 检查、限定 trace 绑定范围、明确接口探索权限和核对控制证据路径的约定。
- 将 Supervisor 定义为可由 General Agent 创建的独立监管角色，不要求位于会话树顶层。
