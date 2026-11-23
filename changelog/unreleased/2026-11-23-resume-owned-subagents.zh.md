# 恢复对话原先派生的子智能体

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** Session runtime and subagent history

[English](2026-11-23-resume-owned-subagents.md)

重新进入对话后，已经发出的子智能体句柄可以继续给原子会话发消息。智能体面板可以按稳定游标读取父会话在各轮中派生的子会话。子会话缺失或句柄无法核实时，保留现有会话。
