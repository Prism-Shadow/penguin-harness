# 可组合的模块 pass 与延后 instrument

- **Date:** 2026-11-13
- **Type:** feature
- **Scope:** `core`, `server`

[English](2026-11-13-module-pass-operators.md)

模块树在装配与 boot 之间进入 compile 阶段，pass 以 manifest 数据注册到 `CompileModule.passes`。新增可用 pipe 组合的模块添加、删除、替换、条件编辑与槽贡献过滤 operator。Decoration 规则在结构改写结束后选择 provider，覆盖后续 pass 加入的节点。

## 细节

- 新增有类型的接口 handle 与保留原型方法、私有字段接收者的成员包装工具，以服务接口上的 telemetry 演示作者写法。
- 通过不可变快照保护原始 manifest，为最终错误附加 operator 来源，包括被删除的 provider。
- 按每代实际保留的插件集合解析 pass 工厂，best-effort 排除后从原始声明重建。
- 将最终结构接口比较生成为 TypeScript 赋值检查，并在 boot 时复用结果。
- 无依赖关系的 pass 按 id 确定顺序，重复注册在执行前被拒绝。
- 通过 `PENGUIN_MODULE_COMPILE_DEBUG=1` 开启每个 pass 与最终验证阶段的计时。
