<!-- [English](README.md) | 简体中文 -->

# 示例：用一个 Agent 构建另一个 Agent（本地，经 Ollama 跑在 AMD GPU 上）

这个示例是 **“构建 Agent 的 Harness”** 支柱的可运行版本。仅用 PenguinHarness SDK，它会：

1. **构建**一个全新的 Agent（`commit-helper`）——用 `agent-creation` skill 驱动 `default_agent`，
   根据一句大白话需求把它搭建出来；然后
2. **运行**这个刚创建的 Agent，证明生成的 `AGENTS.md` 确实塑造了它的行为（它会写出一条
   Conventional Commits 提交信息）。

全程跑在一个**本地开源权重模型**上——由 Ollama 提供的 `qwen3.6:35b`——所以不用任何云端 API、
数据也不离开本机。Ollama 的 ROCm 后端能原生在 AMD GPU 上运行它（从 Radeon PRO 工作站显卡一直到
Instinct 加速卡）。

## 1. 用 Ollama 在本地提供模型

```bash
# Ollama 会自动识别 AMD GPU（ROCm）；也可以指定某张卡：
export HIP_VISIBLE_DEVICES=0
ollama serve &          # 若尚未作为服务运行
ollama pull qwen3.6:35b
```

## 2. 把 PenguinHarness 指向它（一次即可）

```bash
penguin config model add \
  --model-id qwen3.6:35b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

这会把模型写进 `~/.penguin/data/default_project/.project_config.toml`。示例使用项目的默认模型，
所以脚本里没有硬编码任何 model id。

## 3. 运行示例

从仓库根目录（先构建 workspace，好让 `@prismshadow/penguin-core` 解析到它的 `dist/`）：

```bash
pnpm install
pnpm build
pnpm --dir examples/build-agent-with-agent start
# 或直接运行：  npx tsx examples/build-agent-with-agent/build-agent.ts
```

## 你应当看到什么

- **第一阶段** —— `default_agent` 在项目下搭建出 `agents/commit-helper/`：它的目录布局、一份复制
  来的 `system_config.yaml`（含 name + description），以及一份编码了 Conventional Commits 规则的
  `AGENTS.md`。
- **第二阶段** —— 这个新的 `commit-helper` Agent，只依据那份生成的 `AGENTS.md`，产出类似这样的结果：

  ```text
  fix(payment): add retry-with-backoff for transient gateway 503 errors

  Transient 503 responses from the payment gateway were causing checkout
  failures during peak traffic. Retry with exponential backoff gives the
  gateway time to recover, preventing spurious user-facing errors.
  ```

## 说明

- 输出质量取决于模型。`qwen3.6:35b` 能很好地完成这个任务；更小的模型可能无法可靠地遵循工具调用协议。
- 有能力的模型偶尔会在重新序列化 base config 时引入一个机械性的小失误（例如非法的 YAML 转义）——
  因为每个文件都是纯文本、每次运行都被追踪，这类失误很容易被发现并修复。这正是“用 Agent 造 Agent”
  真实的样子：把需求变成 `AGENTS.md` 的重活被自动化了，而机械层面的毛刺由人类来审阅。
- 再次运行第一阶段会就地更新已存在的 `commit-helper` Agent。
