# 按 Session 管理终端与浏览器资源

- **Date:** 2026-11-23
- **Type:** feat
- **Scope:** server, browser automation

[English](2026-11-23-session-resource-management.md)

在有权访问的 Project 中，终端与内置浏览器 API 可按 Session 查询活跃资源数量。关闭所选 Session 的资源后，其他组继续运行。终端只统计当前用户的终端，浏览器只统计桌面端管理的页面。子智能体的资源归属于它自己的 Session，归档后仍可管理。
